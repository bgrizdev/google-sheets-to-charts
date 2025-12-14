<?php
/**
 * Plugin Name: Sheets Chart Block
 * Description: Connects to Google Sheets, fetches data, and displays it in a chart.js Gutenberg block.
 * Version: 1.8.1
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

    // Pass global badge settings to the block editor
    wp_localize_script('sheets-chart-block', 'gstcSettings', array(
        'badgeSettings' => gstc_get_badge_settings(),
        'restUrl' => rest_url('sheets-chart/v1/'),
        'nonce' => wp_create_nonce('wp_rest')
    ));

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

// Make global badge settings available to both frontend and backend
add_action('wp_footer', function() {
    $badge_settings = gstc_get_badge_settings();
    echo '<script>window.gstcGlobalBadges = ' . wp_json_encode($badge_settings) . ';</script>';
});

add_action('admin_footer', function() {
    $badge_settings = gstc_get_badge_settings();
    echo '<script>window.gstcGlobalBadges = ' . wp_json_encode($badge_settings) . ';</script>';
});

require_once __DIR__ . '/includes/sheets-api.php';

// Helper function to generate unique cache filename
function gstc_generate_cache_filename($block_id, $sheet_id, $label, $stats, $overlays) {
    $config_hash = md5($sheet_id . '|' . $label . '|' . $stats . '|' . implode(',', $overlays));
    return $block_id . '_' . $config_hash . '.json';
}

// Helper function to clean up old cache files (optional - can be called manually)
function gstc_cleanup_old_cache_files() {
    $upload_dir = wp_upload_dir();
    $cache_dir = trailingslashit($upload_dir['basedir']) . 'sheets-cache/';
    
    if (!file_exists($cache_dir)) {
        return;
    }
    
    $files = glob($cache_dir . '*.json');
    $cleaned = 0;
    
    foreach ($files as $file) {
        $filename = basename($file);
        // If filename doesn't contain underscore, it's using old naming convention
        if (strpos($filename, '_') === false) {
            unlink($file);
            $cleaned++;
        }
    }
    
    return $cleaned;
}

// Automatic cleanup disabled to prevent accidental deletion
// Use the manual cleanup endpoint instead: POST /wp-json/sheets-chart/v1/cleanup-cache

// Helper function to extract block IDs from post content
function gstc_extract_block_ids_from_content($content) {
    $block_ids = [];
    
    // Parse blocks from content
    $blocks = parse_blocks($content);
    
    foreach ($blocks as $block) {
        if ($block['blockName'] === 'create-block/sheets-chart') {
            if (isset($block['attrs']['blockId'])) {
                $block_ids[] = $block['attrs']['blockId'];
            }
        }
        
        // Handle nested blocks recursively
        if (!empty($block['innerBlocks'])) {
            $block_ids = array_merge($block_ids, gstc_extract_block_ids_from_nested_blocks($block['innerBlocks']));
        }
    }
    
    return array_unique($block_ids);
}

// Helper function to recursively extract block IDs from nested blocks
function gstc_extract_block_ids_from_nested_blocks($blocks) {
    $block_ids = [];
    
    foreach ($blocks as $block) {
        if ($block['blockName'] === 'create-block/sheets-chart') {
            if (isset($block['attrs']['blockId'])) {
                $block_ids[] = $block['attrs']['blockId'];
            }
        }
        
        if (!empty($block['innerBlocks'])) {
            $block_ids = array_merge($block_ids, gstc_extract_block_ids_from_nested_blocks($block['innerBlocks']));
        }
    }
    
    return $block_ids;
}

// Add admin menu and settings
add_action('admin_menu', 'gstc_add_admin_menu');
add_action('admin_init', 'gstc_settings_init');

function gstc_add_admin_menu() {
    add_options_page(
        'Sheets Chart Settings',
        'Sheets Chart',
        'manage_options',
        'sheets-chart-settings',
        'gstc_settings_page'
    );
}

function gstc_settings_init() {
    register_setting('gstc_settings', 'gstc_settings');

    add_settings_section(
        'gstc_badges_section',
        'Badge Settings',
        'gstc_badges_section_callback',
        'gstc_settings'
    );

    add_settings_field(
        'budget_badge_text',
        'Budget Badge Text',
        'gstc_budget_badge_text_render',
        'gstc_settings',
        'gstc_badges_section'
    );

    add_settings_field(
        'budget_badge_image',
        'Budget Badge Image URL',
        'gstc_budget_badge_image_render',
        'gstc_settings',
        'gstc_badges_section'
    );

    add_settings_field(
        'editor_pick_badge_text',
        'Editor Pick Badge Text',
        'gstc_editor_pick_badge_text_render',
        'gstc_settings',
        'gstc_badges_section'
    );

    add_settings_field(
        'editor_pick_badge_image',
        'Editor Pick Badge Image URL',
        'gstc_editor_pick_badge_image_render',
        'gstc_settings',
        'gstc_badges_section'
    );

    add_settings_section(
        'gstc_cache_section',
        'Cache Management',
        'gstc_cache_section_callback',
        'gstc_settings'
    );

    add_settings_field(
        'cache_cleanup',
        'Cache Cleanup',
        'gstc_cache_cleanup_render',
        'gstc_settings',
        'gstc_cache_section'
    );
}

function gstc_badges_section_callback() {
    echo '<p>Configure global badge settings that will be used as defaults for new chart blocks.</p>';
}

function gstc_cache_section_callback() {
    echo '<p>Manage cached chart data files. Cleanup will only remove cache files for blocks that no longer exist in your content.</p>';
}

function gstc_cache_cleanup_render() {
    $upload_dir = wp_upload_dir();
    $cache_dir = trailingslashit($upload_dir['basedir']) . 'sheets-cache/';
    
    $cache_count = 0;
    $cache_size = 0;
    
    if (file_exists($cache_dir)) {
        $files = glob($cache_dir . '*.json');
        $cache_count = count($files);
        foreach ($files as $file) {
            $cache_size += filesize($file);
        }
    }
    
    $cache_size_mb = round($cache_size / 1024 / 1024, 2);
    
    echo '<div class="gstc-cache-info">';
    echo '<p><strong>Current cache status:</strong></p>';
    echo '<ul>';
    echo '<li>Cache files: ' . $cache_count . '</li>';
    echo '<li>Total size: ' . $cache_size_mb . ' MB</li>';
    echo '<li>Location: ' . $cache_dir . '</li>';
    echo '</ul>';
    echo '</div>';
    
    echo '<div style="background: #fff3cd; border: 1px solid #ffeaa7; color: #856404; padding: 15px; border-radius: 4px; margin: 15px 0;">';
    echo '<h4 style="margin-top: 0;">⚠️ Automatic Cache Cleanup Disabled</h4>';
    echo '<p>Automatic cache cleanup has been disabled because your content appears to be in HTML format rather than WordPress block format. ';
    echo 'This prevents the system from safely detecting which cache files are still in use.</p>';
    echo '<p><strong>To manually clean up cache files:</strong></p>';
    echo '<ol>';
    echo '<li>Identify cache files you want to remove from the location above</li>';
    echo '<li>Delete them manually via FTP or file manager</li>';
    echo '<li>Or contact your developer for assistance</li>';
    echo '</ol>';
    echo '</div>';
    
    echo '<p class="description">Cache files are automatically created when you fetch chart data and are safe to leave in place.</p>';
}

function gstc_budget_badge_text_render() {
    $options = get_option('gstc_settings');
    $value = isset($options['budget_badge_text']) ? $options['budget_badge_text'] : '';
    echo '<input type="text" name="gstc_settings[budget_badge_text]" value="' . esc_attr($value) . '" class="regular-text" />';
    echo '<p class="description">Default text for budget badge (e.g., "Budget Buy")</p>';
}

function gstc_budget_badge_image_render() {
    $options = get_option('gstc_settings');
    $value = isset($options['budget_badge_image']) ? $options['budget_badge_image'] : '';
    $image_url = $value ? wp_get_attachment_url($value) : '';
    
    echo '<div class="gstc-media-upload">';
    echo '<input type="hidden" name="gstc_settings[budget_badge_image]" id="budget_badge_image" value="' . esc_attr($value) . '" />';
    echo '<input type="button" class="button gstc-upload-button" data-target="budget_badge_image" value="Select Image" />';
    echo '<input type="button" class="button gstc-remove-button" data-target="budget_badge_image" value="Remove" style="margin-left: 10px;" />';
    echo '<div class="gstc-image-preview" style="margin-top: 10px;">';
    if ($image_url) {
        echo '<img src="' . esc_url($image_url) . '" style="max-width: 150px; height: auto;" />';
    }
    echo '</div>';
    echo '</div>';
    echo '<p class="description">Select an image for the budget badge</p>';
}

function gstc_editor_pick_badge_text_render() {
    $options = get_option('gstc_settings');
    $value = isset($options['editor_pick_badge_text']) ? $options['editor_pick_badge_text'] : '';
    echo '<input type="text" name="gstc_settings[editor_pick_badge_text]" value="' . esc_attr($value) . '" class="regular-text" />';
    echo '<p class="description">Default text for editor pick badge (e.g., "Editor\'s Pick")</p>';
}

function gstc_editor_pick_badge_image_render() {
    $options = get_option('gstc_settings');
    $value = isset($options['editor_pick_badge_image']) ? $options['editor_pick_badge_image'] : '';
    $image_url = $value ? wp_get_attachment_url($value) : '';
    
    echo '<div class="gstc-media-upload">';
    echo '<input type="hidden" name="gstc_settings[editor_pick_badge_image]" id="editor_pick_badge_image" value="' . esc_attr($value) . '" />';
    echo '<input type="button" class="button gstc-upload-button" data-target="editor_pick_badge_image" value="Select Image" />';
    echo '<input type="button" class="button gstc-remove-button" data-target="editor_pick_badge_image" value="Remove" style="margin-left: 10px;" />';
    echo '<div class="gstc-image-preview" style="margin-top: 10px;">';
    if ($image_url) {
        echo '<img src="' . esc_url($image_url) . '" style="max-width: 150px; height: auto;" />';
    }
    echo '</div>';
    echo '</div>';
    echo '<p class="description">Select an image for the editor pick badge</p>';
}

function gstc_settings_page() {
    // Enqueue media uploader
    wp_enqueue_media();
    ?>
    <div class="wrap">
        <h1>Sheets Chart Settings</h1>
        <form action="options.php" method="post">
            <?php
            settings_fields('gstc_settings');
            do_settings_sections('gstc_settings');
            submit_button();
            ?>
        </form>
    </div>
    
    <script>
    jQuery(document).ready(function($) {
        $('.gstc-upload-button').click(function(e) {
            e.preventDefault();
            var button = $(this);
            var targetId = button.data('target');
            
            // Create a new media uploader instance for each button click
            var mediaUploader = wp.media({
                title: 'Select Badge Image',
                button: {
                    text: 'Use this image'
                },
                multiple: false,
                library: {
                    type: 'image'
                }
            });
            
            mediaUploader.on('select', function() {
                var attachment = mediaUploader.state().get('selection').first().toJSON();
                $('#' + targetId).val(attachment.id);
                button.siblings('.gstc-image-preview').html('<img src="' + attachment.url + '" style="max-width: 150px; height: auto;" />');
            });
            
            mediaUploader.open();
        });
        
        $('.gstc-remove-button').click(function(e) {
            e.preventDefault();
            var button = $(this);
            var targetId = button.data('target');
            
            $('#' + targetId).val('');
            button.siblings('.gstc-image-preview').html('');
        });

        // Cache cleanup functionality disabled
    });
    </script>
    <?php
}

// Function to get global badge settings
function gstc_get_badge_settings() {
    $options = get_option('gstc_settings', array());
    
    // Get image URLs from attachment IDs
    $budget_image_id = isset($options['budget_badge_image']) ? $options['budget_badge_image'] : '';
    $editor_image_id = isset($options['editor_pick_badge_image']) ? $options['editor_pick_badge_image'] : '';
    
    $budget_image_url = $budget_image_id ? wp_get_attachment_url($budget_image_id) : '';
    $editor_image_url = $editor_image_id ? wp_get_attachment_url($editor_image_id) : '';
    
    return array(
        'budget_badge_text' => isset($options['budget_badge_text']) ? $options['budget_badge_text'] : '',
        'budget_badge_image' => $budget_image_url,
        'budget_badge_image_id' => $budget_image_id,
        'editor_pick_badge_text' => isset($options['editor_pick_badge_text']) ? $options['editor_pick_badge_text'] : '',
        'editor_pick_badge_image' => $editor_image_url,
        'editor_pick_badge_image_id' => $editor_image_id,
    );
}

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

    // Create unique filename based on sheet configuration
    $cache_filename = gstc_generate_cache_filename($block_id, $sheet_id, $label, $stats, $overlays);
    $filename = $dir . $cache_filename;

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
    } else {
        // if file does not exist make it 
        $data = get_google_sheet_data_batch($sheet_id, $label, $stats, $overlays);
        if (is_wp_error($data)) {
            return new WP_Error('google_fetch_error', 'Failed to fetch Google Sheet data', ['status' => 500]);
        }
        file_put_contents($filename, wp_json_encode($data), LOCK_EX);
    }

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

    // Create unique filename based on sheet configuration
    $cache_filename = gstc_generate_cache_filename($block_id, $sheet_id, $label, $stats, $overlays);
    $filename = $dir . $cache_filename;


    $data = get_google_sheet_data_batch($sheet_id, $label, $stats, $overlays);
    if (is_wp_error($data)) {
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

// add endpoint for global badge settings
add_action('rest_api_init', function () {
    register_rest_route('sheets-chart/v1', '/badge-settings', [
        'methods'             => 'GET',
        'callback'            => 'gstc_get_badge_settings_rest',
        'permission_callback' => function () {
            return current_user_can('edit_posts');
        }
    ]);
});

// Cache cleanup endpoint disabled - not safe with HTML content format

function sheets_chart_fetch_cached_data( WP_REST_Request $req ) {
    $block_id = sanitize_text_field( $req->get_param('blockId') );
    $sheet_id = sanitize_text_field( $req->get_param('sheetId') );
    $label = sanitize_text_field( $req->get_param('label') );
    $stats = sanitize_text_field( $req->get_param('stats') );
    $overlays_param = $req->get_param('overlays');

    if ( is_array( $overlays_param ) ) {
        $overlays = array_values( array_filter( array_map( 'sanitize_text_field', $overlays_param ), 'strlen' ) );
    } elseif ( is_string( $overlays_param ) && $overlays_param !== '' ) {
        $overlays = [ sanitize_text_field( $overlays_param ) ];
    } else {
        $overlays = [];
    }

    // Create unique filename based on sheet configuration
    $cache_filename = gstc_generate_cache_filename($block_id, $sheet_id, $label, $stats, $overlays);
    $upload_dir = wp_upload_dir();
    $file = trailingslashit($upload_dir['basedir']) . 'sheets-cache/' . $cache_filename;
    
    if ( ! file_exists($file) ) {
      return new WP_Error('no_cache', 'No cached file', ['status' => 404]);
    }
    $data = json_decode(file_get_contents($file), true);
    return rest_ensure_response($data);
}

function gstc_get_badge_settings_rest() {
    return rest_ensure_response(gstc_get_badge_settings());
}

function gstc_manual_cache_cleanup() {
    $upload_dir = wp_upload_dir();
    $cache_dir = trailingslashit($upload_dir['basedir']) . 'sheets-cache/';
    
    if (!file_exists($cache_dir)) {
        return rest_ensure_response([
            'success' => true,
            'message' => 'Cache directory does not exist',
            'deleted_count' => 0
        ]);
    }
    
    // Get all posts and pages (including drafts) that might contain blocks
    $posts = get_posts([
        'post_type' => ['post', 'page'],
        'post_status' => ['publish', 'draft', 'private', 'future'],
        'numberposts' => -1,
        'fields' => 'ids'
    ]);
    
    // Collect all active block IDs
    $active_block_ids = [];
    $debug_info = [];
    
    foreach ($posts as $post_id) {
        $post = get_post($post_id);
        if ($post && $post->post_content) {
            $block_ids = gstc_extract_block_ids_from_content($post->post_content);
            if (!empty($block_ids)) {
                $debug_info[] = [
                    'post_id' => $post_id,
                    'post_title' => $post->post_title,
                    'post_status' => $post->post_status,
                    'block_ids' => $block_ids
                ];
            }
            $active_block_ids = array_merge($active_block_ids, $block_ids);
        }
    }
    
    $active_block_ids = array_unique($active_block_ids);
    
    // Get all cache files and check which ones are orphaned
    $files = glob($cache_dir . '*.json');
    $deleted_count = 0;
    $orphaned_files = [];
    $kept_files = [];
    
    foreach ($files as $file) {
        $filename = basename($file);
        
        // Extract block ID from filename
        if (preg_match('/^([a-f0-9\-]+)_[a-f0-9]+\.json$/', $filename, $matches)) {
            $block_id = $matches[1];
            
            // If this block ID is not active anywhere, it's orphaned
            if (!in_array($block_id, $active_block_ids)) {
                $orphaned_files[] = [
                    'filename' => $filename,
                    'block_id' => $block_id,
                    'reason' => 'Block ID not found in any active posts'
                ];
                // DISABLE DELETION FOR DEBUGGING
                // unlink($file);
                // $deleted_count++;
            } else {
                $kept_files[] = [
                    'filename' => $filename,
                    'block_id' => $block_id,
                    'found_in_posts' => array_filter($debug_info, function($post) use ($block_id) {
                        return in_array($block_id, $post['block_ids']);
                    })
                ];
            }
        }
    }
    
    return rest_ensure_response([
        'success' => true,
        'message' => "DEBUG: Found " . count($orphaned_files) . " files that would be deleted",
        'deleted_count' => 0, // Disabled for debugging
        'would_delete' => $orphaned_files,
        'kept_files' => $kept_files,
        'active_blocks' => $active_block_ids,
        'debug_posts' => $debug_info,
        'total_files' => count($files),
        'posts_scanned' => count($posts),
        'block_name_looking_for' => 'create-block/sheets-chart'
    ]);
}

