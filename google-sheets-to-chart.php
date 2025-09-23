<?php
/**
 * Plugin Name: Sheets Chart Block
 * Description: Connects to Google Sheets, fetches data, and displays it in a chart.js Gutenberg block.
 * Version: 1.0
 * Author: Ben G
 */

// Exit if accessed directly
if (!defined('ABSPATH')) exit;

// register block
add_action('init', function () {
    $asset_file = include plugin_dir_path(__FILE__) . 'build/index.asset.php';

    wp_register_script(
        'sheets-chart-block',
        plugin_dir_url(__FILE__) . 'build/index.js',
        $asset_file['dependencies'],
        $asset_file['version'],
        true
    );

    register_block_type(__DIR__ . '/build');
});

// enqueue styles
define( 'GSTC_PLUGIN_PATH', plugin_dir_path( __FILE__ ) );
define( 'GSTC_PLUGIN_URL',  plugin_dir_url( __FILE__ ) );

add_action( 'enqueue_block_assets', function () {
    $rel_path = 'assets/css/gstc.css';
    $path     = GSTC_PLUGIN_PATH . $rel_path;
    $url      = GSTC_PLUGIN_URL  . $rel_path;

    // Only enqueue if the file exists
    if ( file_exists( $path ) ) {
        wp_enqueue_style(
            'gstc-styles',
            $url,
            [],
            filemtime( $path ) // cache-bust on change
        );
    }
} );

require_once __DIR__ . '/includes/sheets-api.php';

// add endpoint for sheet data v2
add_action('rest_api_init', function () {
    register_rest_route('sheets-chart/v1', '/fetch-data', [
        'methods' => 'POST',
        'callback' => 'sheets_chart_fetch_and_cache_data',
        'permission_callback' => function () {
            return current_user_can('edit_posts'); 
        }
    ]);
});

// add endpoint for sheet data refresh button
add_action('rest_api_init', function () {
    register_rest_route('sheets-chart/v1', '/refresh-fetch-data', [
        'methods' => 'POST',
        'callback' => 'refresh_sheets_chart_fetch_and_cache_data',
        'permission_callback' => function () {
            return current_user_can('edit_posts'); 
        }
    ]);
});

function sheets_chart_fetch_and_cache_data(WP_REST_Request $request) {
    $sheet_id = sanitize_text_field($request->get_param('sheetId'));
    $label    = sanitize_text_field($request->get_param('label'));
    $stats    = sanitize_text_field($request->get_param('stats'));
    $block_id = sanitize_text_field($request->get_param('blockId'));
    $overlays_param = $request->get_param('overlays');


    if ( is_array( $overlays_param ) ) {
        $overlays = array_values( array_filter( array_map( 'sanitize_text_field', $overlays_param ), 'strlen' ) );
    } elseif ( is_string( $overlays_param ) && $overlays_param !== '' ) {
        // if sent as a single string, normalize to array
        $overlays = [ sanitize_text_field( $overlays_param ) ];
    } else {
        $overlays = [];
    }

    $ranges = array_values( array_filter( array_unique( array_merge(
        array_filter( [$label, $stats], 'strlen' ),
        $overlays
    ) ) ) );

    // Uploads cache directory
    $upload_dir = wp_upload_dir();
    $dir = trailingslashit( $upload_dir['basedir'] ) . 'sheets-cache/';
    if ( ! file_exists( $dir ) ) {
        wp_mkdir_p( $dir );
    }

    $filename = $dir . "{$block_id}.json";

    // check if file already exists 
    if ( file_exists( $filename ) ) {
        error_log('cache used');
        $cached = file_get_contents( $filename );
        $json   = json_decode( $cached, true );
        if ( $json !== null ) {
            return rest_ensure_response([
                'success' => true,
                'cached'  => true,
                'data'    => $json,
                'path'    => $filename
            ]);
        }
    }

    // if file does not exist make it 
    //$data = get_google_sheet_data_batch($sheet_id, $ranges);
    error_log('data fetched');
    $data = get_google_sheet_data_batch($sheet_id, $label, $stats, $overlays);
    if (is_wp_error($data)) {
        error_log('error fetching data: ' . $data->get_error_message());
        return new WP_Error('google_fetch_error', 'Failed to fetch Google Sheet data', ['status' => 500]);
    }
    file_put_contents($filename, wp_json_encode($data), LOCK_EX);
    return rest_ensure_response(['success' => true, 'message' => 'Data saved.', 'path' => $filename]);
}

function refresh_sheets_chart_fetch_and_cache_data(WP_REST_Request $request) {
    $sheet_id = sanitize_text_field($request->get_param('sheetId'));
    $label    = sanitize_text_field($request->get_param('label'));
    $stats    = sanitize_text_field($request->get_param('stats'));
    $block_id = sanitize_text_field($request->get_param('blockId'));
    $overlays_param = $request->get_param('overlays');

    if ( is_array( $overlays_param ) ) {
        $overlays = array_values( array_filter( array_map( 'sanitize_text_field', $overlays_param ), 'strlen' ) );
    } elseif ( is_string( $overlays_param ) && $overlays_param !== '' ) {
        // if sent as a single string, normalize to array
        $overlays = [ sanitize_text_field( $overlays_param ) ];
    } else {
        $overlays = [];
    }

    $ranges = array_values( array_filter( array_unique( array_merge(
        array_filter( [$label, $stats], 'strlen' ),
        $overlays
    ) ) ) );


    // Uploads cache directory
    $upload_dir = wp_upload_dir();
    $dir = trailingslashit( $upload_dir['basedir'] ) . 'sheets-cache/';
    if ( ! file_exists( $dir ) ) {
        wp_mkdir_p( $dir );
    }

    $filename = $dir . "{$block_id}.json";

    $data = get_google_sheet_data_batch($sheet_id, $label, $stats, $overlays);
    if (is_wp_error($data)) {
        error_log('error fetching data: ' . $data->get_error_message());
        return new WP_Error('google_fetch_error', 'Failed to fetch Google Sheet data', ['status' => 500]);
    }
    file_put_contents($filename, wp_json_encode($data), LOCK_EX);
    return rest_ensure_response(['success' => true, 'message' => 'Data saved.', 'path' => $filename]);

}

// add endpoint for cached data
add_action('rest_api_init', function () {
    register_rest_route('sheets-chart/v1', '/cached', [
        'methods'             => 'GET',
        'callback'            => 'sheets_chart_fetch_cached_data',
        'permission_callback' => '__return_true',
    ]);
});

function sheets_chart_fetch_cached_data( WP_REST_Request $req ) {
    $block_id = sanitize_text_field( $req->get_param('blockId') );
    $upload_dir = wp_upload_dir();
    $file = trailingslashit($upload_dir['basedir']) . 'sheets-cache/' . $block_id . '.json';
    if ( ! file_exists($file) ) {
      return new WP_Error('no_cache', 'No cached file', ['status' => 404]);
    }
    $data = json_decode(file_get_contents($file), true);
    return rest_ensure_response($data);
}   