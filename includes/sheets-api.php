<?php
function get_google_sheet_data_batch( string $spreadsheetId, string $labelRange, string $statsRange, array $overlayRanges ): array {
    require_once __DIR__ . '/../vendor/autoload.php';

    $credPath = __DIR__ . '/credentials/service-account.json';

    $client = new \Google_Client();
    $client->setAuthConfig($credPath);
    $client->addScope(\Google_Service_Sheets::SPREADSHEETS_READONLY);
    $service = new \Google_Service_Sheets($client);

    // Helper: get column letters (and ignore sheet names if present)
    $colFromRange = function (string $range): ?string {
        if (strpos($range, '!') !== false) {
            [, $range] = explode('!', $range, 2);
        }
        if (preg_match('/^([A-Za-z]+)\d+/', $range, $m)) {
            return strtoupper($m[1]);
        }
        error_log('failed at colFromRange');
        return null;
    };

    // Helper: get row numbers from range
    $getRowsFromRange = function (string $range): array {
        if (strpos($range, '!') !== false) {
            [, $range] = explode('!', $range, 2);
        }
        if (preg_match('/^[A-Za-z]+(\d+):[A-Za-z]+(\d+)$/', $range, $m)) {
            return [(int)$m[1], (int)$m[2]];
        }
        return [2, 13]; // default fallback
    };

    // Get row range from the label range to determine badge column range
    // This ensures badges align with the product data
    [$startRow, $endRow] = $getRowsFromRange($labelRange);
    $badgeRange = "B{$startRow}:B{$endRow}"; // Always use column B for badges

    // Build one batch: label + stats + badge + each overlay + each overlay's header cell in row 1
    $headerRanges = [];
    foreach ($overlayRanges as $r) {
        $col = $colFromRange($r);
        if ($col) {
            $headerRanges[] = $col . '1'; // assumes headers in row 1
        }
    }
    
    // Add badge header
    $headerRanges[] = 'B1';

    $allRanges = array_values(array_filter(array_merge([$labelRange, $statsRange, $badgeRange], $overlayRanges, $headerRanges)));



    $resp = $service->spreadsheets_values->batchGet($spreadsheetId, ['ranges' => $allRanges]);

    // Map returned ranges -> values (keys include sheet name; we’ll match by suffix)
    $rangeMap = [];
    foreach ($resp->getValueRanges() as $vr) {
        $rangeMap[$vr->getRange()] = $vr->getValues() ?: [];
    }

    // Helper: find values by suffix (handles "'Sheet'!A2:A13" vs "A2:A13")
    $getBySuffix = function (string $needle) use ($rangeMap) {
        // First try exact match
        foreach ($rangeMap as $k => $v) {
            if (str_ends_with($k, $needle) || str_ends_with($k, '!' . $needle)) {
                return $v;
            }
        }
        
        // If no exact match, try partial match for overlays (e.g., C2:CB13 should match C2:AG13)
        if (preg_match('/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/', $needle, $needleMatches)) {
            $needleStartCol = $needleMatches[1];
            $needleStartRow = $needleMatches[2];
            $needleEndRow = $needleMatches[4];
            
            foreach ($rangeMap as $k => $v) {
                $cleanKey = $k;
                if (strpos($k, '!') !== false) {
                    [, $cleanKey] = explode('!', $k, 2);
                }
                
                if (preg_match('/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/', $cleanKey, $keyMatches)) {
                    $keyStartCol = $keyMatches[1];
                    $keyStartRow = $keyMatches[2];
                    $keyEndRow = $keyMatches[4];
                    
                    // Match if start column and rows match (end column can be different)
                    if ($keyStartCol === $needleStartCol && $keyStartRow === $needleStartRow && $keyEndRow === $needleEndRow) {
                        return $v;
                    }
                }
            }
        }
        
        return [];
    };

    // Helper: flatten first column
    $colValues = function (array $matrix): array {
        $out = [];
        foreach ($matrix as $row) {
            if (isset($row[0])) { $out[] = $row[0]; }
        }
        return $out;
    };

    // Helper: flatten first column but preserve empty rows for proper alignment
    $colValuesWithEmpties = function (array $matrix, int $expectedCount): array {
        $out = [];
        for ($i = 0; $i < $expectedCount; $i++) {
            if (isset($matrix[$i][0]) && $matrix[$i][0] !== '') {
                $out[] = $matrix[$i][0];
            } else {
                $out[] = ''; // Preserve empty cells to maintain row alignment
            }
        }
        return $out;
    };

    // Assemble
    $labels = $colValues($getBySuffix($labelRange));
    $stats  = $colValues($getBySuffix($statsRange));
    
    // For badges, we need to preserve empty cells to maintain row alignment
    // Use labels count as the expected count since that's our baseline
    $expectedCount = count($labels);
    
    $badgeMatrix = $getBySuffix($badgeRange);
    $badges = $colValuesWithEmpties($badgeMatrix, $expectedCount);



    $overlaysOut = [];
    foreach ($overlayRanges as $r) {
        $col = $colFromRange($r);
        $overlayMatrix = $getBySuffix($r);
        $values = $colValues($overlayMatrix);
        $header = $col ? ($getBySuffix($col . '1')[0][0] ?? $col) : '';
        $overlaysOut[] = [
            'range'  => $r,
            'header' => $header,
            'values' => $values,
        ];
    }

    return [
        'labels'   => $labels,
        'stats'    => $stats,
        'badges'   => $badges,
        'overlays' => $overlaysOut,
    ];
}

