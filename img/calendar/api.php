<?php
require_once __DIR__ . '/config.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$body = file_get_contents('php://input');
if (!$body) {
    http_response_code(400);
    echo json_encode(['error' => 'Empty request']);
    exit;
}

// 混雑時に自動で別モデルへフォールバック
$models = [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
];

$response = '';
$httpCode = 500;

foreach ($models as $model) {
    $url = 'https://generativelanguage.googleapis.com/v1beta/models/' . $model . ':generateContent?key=' . GEMINI_API_KEY;

    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 30);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    // 成功、またはクォータ超過以外のエラーならそのまま返す
    if ($httpCode === 200) break;

    $decoded = json_decode($response, true);
    $errMsg = $decoded['error']['message'] ?? '';
    // 混雑・クォータ系エラーなら次のモデルを試す
    if (strpos($errMsg, 'high demand') !== false || strpos($errMsg, 'quota') !== false || strpos($errMsg, 'RESOURCE_EXHAUSTED') !== false) {
        continue;
    }
    break; // その他のエラーはそのまま返す
}

http_response_code($httpCode);
echo $response;
