<?php

function get_google_sheet_data($spreadsheetId, $range) {
    require_once __DIR__ . '/../vendor/autoload.php';

    $client = new \Google_Client();
    $client->setAuthConfig(__DIR__ . '/../credentials/service-account.json');
    $client->addScope(\Google_Service_Sheets::SPREADSHEETS_READONLY);

    $service = new \Google_Service_Sheets($client);
    $response = $service->spreadsheets_values->get($spreadsheetId, $range);

    return $response->getValues();
}
