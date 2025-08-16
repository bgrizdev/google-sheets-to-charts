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
add_action('rest_api_init', function () {
    register_rest_route('sheets-chart/v1', '/data', [
        'methods' => 'GET',
        'callback' => function () {
            $spreadsheetId = '1ocQtGKwZRr_Fk_o-CjTu7cP3Tp4cTlVcq457POVg23o';
            $range = 'Sheet1'; // adjust to match your sheet - grabs the whole sheet

            $data = get_google_sheet_data($spreadsheetId, $range);
            return rest_ensure_response($data);
        },
        'permission_callback' => '__return_true'
    ]);
});


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
