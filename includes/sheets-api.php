<?php

function get_google_sheet_data_batch($spreadsheetId, array $ranges) {
    require_once __DIR__ . '/../vendor/autoload.php';

    $client = new \Google_Client();
    $client->setAuthConfig(__DIR__ . '/../credentials/service-account.json');
    $client->addScope(\Google_Service_Sheets::SPREADSHEETS_READONLY);

    $service = new \Google_Service_Sheets($client);

    $params = ['ranges' => $ranges];
    $response = $service->spreadsheets_values->batchGet($spreadsheetId, $params);

    $result = [];
    foreach ($response->getValueRanges() as $valueRange) {
        $rangeName = $valueRange->getRange();  // includes full sheet!A2:A13
        $values = $valueRange->getValues();
        $result[$rangeName] = $values;
    }

    return $result;
}
