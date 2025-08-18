<?php
/**
 * Plugin Name: Sheets Chart Block
 * Description: Connects to Google Sheets, fetches data, and displays it in a chart.js Gutenberg block.
 * Version: 0.1
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

    error_log('register block');

    register_block_type(__DIR__ . '/build');
});

require_once __DIR__ . '/includes/sheets-api.php';

// add endpoint for sheet data
//add_action('rest_api_init', function () {
//    register_rest_route('sheets-chart/v1', '/data', [
//        'methods' => 'GET',
//        'callback' => function () {
//            $spreadsheetId = '1ocQtGKwZRr_Fk_o-CjTu7cP3Tp4cTlVcq457POVg23o';
//            $range = 'Sheet1'; // adjust to match your sheet - grabs the whole sheet
//
//            $data = get_google_sheet_data($spreadsheetId, $range);
//            return rest_ensure_response($data);
//        },
//        'permission_callback' => '__return_true'
//    ]);
//});

// add endpoint for sheet data v2
add_action('rest_api_init', function () {
    register_rest_route('sheets-chart/v1', '/fetch-data', [
        'methods' => 'POST',
        'callback' => 'sheets_chart_fetch_and_cache_data',
        'permission_callback' => function () {
            return current_user_can('edit_posts'); // only allow editors/admins
        }
    ]);
});

function sheets_chart_fetch_and_cache_data(WP_REST_Request $request) {
    $sheet_id = sanitize_text_field($request->get_param('sheetId'));
    $label    = sanitize_text_field($request->get_param('label'));
    $stats    = sanitize_text_field($request->get_param('stats'));
    $overlay  = sanitize_text_field($request->get_param('overlay'));

    $ranges = array_filter([$label, $stats, $overlay]);

    //$data = get_google_sheet_data_batch($sheet_id, [$label, $stats, $overlay]);

    // Uploads cache directory
    $upload_dir = wp_upload_dir();
    $dir = trailingslashit( $upload_dir['basedir'] ) . 'sheets-cache/';
    if ( ! file_exists( $dir ) ) {
        wp_mkdir_p( $dir );
    }

    $filename = $dir . "{$sheet_id}.json";

    // check if file already exists 
    if ( file_exists( $filename ) ) {
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
    $data = get_google_sheet_data_batch($sheet_id, $ranges);

    if (is_wp_error($data)) {
        return new WP_Error('google_fetch_error', 'Failed to fetch Google Sheet data', ['status' => 500]);
    }

    file_put_contents($filename, wp_json_encode($data));

    return rest_ensure_response(['success' => true, 'message' => 'Data saved.', 'path' => $filename]);

}


// add CDN support for chart.js
add_action('wp_enqueue_scripts', function () {
    wp_enqueue_script(
        'chartjs',
        'https://cdn.jsdelivr.net/npm/chart.js',
        [],
        null,
        true
    );
    
    wp_enqueue_script(
        'sheets-chart-render',
        plugin_dir_url(__FILE__) . 'build/frontend.js',
        [],
        filemtime(plugin_dir_path(__FILE__) . 'build/frontend.js'),
        true
    );
});
