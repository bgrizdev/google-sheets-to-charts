<?php

//function get_google_sheet_data_batch($spreadsheetId, array $ranges) {
//    require_once __DIR__ . '/../vendor/autoload.php';
//
//    $client = new \Google_Client();
//    $client->setAuthConfig(__DIR__ . '/../credentials/service-account.json');
//    $client->addScope(\Google_Service_Sheets::SPREADSHEETS_READONLY);
//
//    $service = new \Google_Service_Sheets($client);
//
//    $params = ['ranges' => $ranges];
//    $response = $service->spreadsheets_values->batchGet($spreadsheetId, $params);
//
//    $result = [];
//    foreach ($response->getValueRanges() as $valueRange) {
//        $rangeName = $valueRange->getRange(); 
//        $values = $valueRange->getValues();
//        $result[$rangeName] = $values;
//    }
//
//    return $result;
//}

function get_google_sheet_data_batch( string $spreadsheetId, string $labelRange, string $statsRange, array $overlayRanges ): array {
    require_once __DIR__ . '/../vendor/autoload.php';

    $client = new \Google_Client();
    $client->setAuthConfig(__DIR__ . '/../credentials/service-account.json');
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
        return null;
    };

    // Build one batch: label + stats + each overlay + each overlay's header cell in row 1
    $headerRanges = [];
    foreach ($overlayRanges as $r) {
        $col = $colFromRange($r);
        if ($col) {
            $headerRanges[] = $col . '1'; // assumes headers in row 1
        }
    }

    $allRanges = array_values(array_filter(array_merge([$labelRange, $statsRange], $overlayRanges, $headerRanges)));

    $resp = $service->spreadsheets_values->batchGet($spreadsheetId, ['ranges' => $allRanges]);

    // Map returned ranges -> values (keys include sheet name; we’ll match by suffix)
    $rangeMap = [];
    foreach ($resp->getValueRanges() as $vr) {
        $rangeMap[$vr->getRange()] = $vr->getValues() ?: [];
    }

    // Helper: find values by suffix (handles "'Sheet'!A2:A13" vs "A2:A13")
    $getBySuffix = function (string $needle) use ($rangeMap) {
        foreach ($rangeMap as $k => $v) {
            if (str_ends_with($k, $needle) || str_ends_with($k, '!' . $needle)) {
                return $v;
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

    // Assemble
    $labels = $colValues($getBySuffix($labelRange));
    $stats  = $colValues($getBySuffix($statsRange));

    $overlaysOut = [];
    foreach ($overlayRanges as $r) {
        $col = $colFromRange($r);
        $values = $colValues($getBySuffix($r));
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
        'overlays' => $overlaysOut,
    ];
}

