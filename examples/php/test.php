<?php
// Tests every PHP example in the docs. Run: php test.php
// Unit tests use the official sample payloads from the Daraja 3.0 docs.
// End-to-end tests start the local mock in ../mock-daraja (needs Node.js 18+), not Safaricom's sandbox.
require __DIR__ . '/Daraja.php';

$passed = 0;
function check(string $name, bool $ok): void
{
    global $passed;
    if (!$ok) {
        fwrite(STDERR, "FAIL: {$name}\n");
        exit(1);
    }
    $passed++;
    echo "ok - {$name}\n";
}

const PASSKEY = 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919';

check('stkPassword reproduces the official sample', Daraja::stkPassword('174379', PASSKEY, '20210628092408') ===
    'MTc0Mzc5YmZiMjc5ZjlhYTliZGJjZjE1OGU5N2RkNzFhNDY3Y2QyZTBjODkzMDU5YjEwZjc4ZTZiNzJhZGExZWQyYzkxOTIwMjEwNjI4MDkyNDA4');
check('timestamp is Kenya time', Daraja::timestamp(new DateTimeImmutable('2026-11-13T21:30:05Z')) === '20261114003005');
foreach (['0712345678', '+254712345678', '254712345678', '712345678'] as $input) {
    check("normalizePhone({$input})", Daraja::normalizePhone($input) === '254712345678');
}

$official = json_decode('{"Body":{"stkCallback":{"MerchantRequestID":"29115-34620561-1","CheckoutRequestID":"ws_CO_191220191020363925","ResultCode":0,"ResultDesc":"The service request is processed successfully.","CallbackMetadata":{"Item":[{"Name":"Amount","Value":1.0},{"Name":"MpesaReceiptNumber","Value":"NLJ7RT61SV"},{"Name":"TransactionDate","Value":20191219102115},{"Name":"PhoneNumber","Value":254708374149}]}}}}', true);
$payment = Daraja::parseStkCallback($official);
check('parse official success callback', $payment['paid'] && $payment['receipt'] === 'NLJ7RT61SV'
    && $payment['transactionDate'] === '20191219102115' && $payment['phone'] === '254708374149');

$key = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
$pem = openssl_pkey_get_details($key)['key'];
openssl_private_decrypt(base64_decode(Daraja::securityCredential('Safaricom999!*!', $pem)), $plain, $key, OPENSSL_PKCS1_PADDING);
check('securityCredential round trip (PKCS #1 v1.5)', $plain === 'Safaricom999!*!');

// ---- End-to-end against the mock ----
function freePort(): int
{
    $s = stream_socket_server('tcp://127.0.0.1:0');
    $port = (int) explode(':', stream_socket_get_name($s, false))[1];
    fclose($s);
    return $port;
}

$mockPort = freePort();
$cbPort = freePort();
$log = tempnam(sys_get_temp_dir(), 'stk');
$mock = proc_open(['node', __DIR__ . '/../mock-daraja/server.js'], [1 => ['pipe', 'w']], $pipes, null, ['PORT' => (string) $mockPort] + getenv());
fgets($pipes[1]);
$cb = proc_open([PHP_BINARY, '-S', "127.0.0.1:{$cbPort}", __DIR__ . '/stk-callback.php'], [1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']], $p2, null, ['DARAJA_CALLBACK_LOG' => $log] + getenv());
usleep(500000);

function waitForCallback(string $log): array
{
    for ($i = 0; $i < 50; $i++) {
        $lines = array_filter(explode("\n", (string) file_get_contents($log)));
        if ($lines) {
            file_put_contents($log, '');
            return json_decode(end($lines), true);
        }
        usleep(100000);
    }
    return [];
}

try {
    $daraja = new Daraja('mock-consumer-key', 'mock-consumer-secret', baseUrl: "http://127.0.0.1:{$mockPort}");
    $callbackUrl = "http://127.0.0.1:{$cbPort}/payments/stk-callback";

    $ack = $daraja->stkPush('174379', PASSKEY, 1, '0712345678', 'INV-3001', $callbackUrl);
    check('STK Push accepted', $ack['ResponseCode'] === '0');
    $payment = waitForCallback($log);
    check('callback received and parsed', ($payment['checkoutRequestId'] ?? null) === $ack['CheckoutRequestID'] && $payment['paid']);
    check('STK Query agrees', $daraja->stkQuery('174379', PASSKEY, $ack['CheckoutRequestID'])['ResultCode'] === '0');

    $daraja->stkPush('174379', PASSKEY, 1032, '0722000021', 'INV-3002', $callbackUrl);
    check('cancelled push returns 1032', (waitForCallback($log)['resultCode'] ?? null) === 1032);

    try {
        $daraja->stkPush('174379', 'wrong', 1, '0722000022', 'X', $callbackUrl);
        check('wrong passkey throws', false);
    } catch (DarajaError $e) {
        check('wrong passkey gives 500.001.1001 Wrong credentials',
            $e->errorCode() === '500.001.1001' && $e->body['errorMessage'] === 'Wrong credentials');
    }

    $cert = file_get_contents("http://127.0.0.1:{$mockPort}/mock/certificate");
    $b2c = $daraja->b2cPayment([
        'originatorConversationId' => uniqid('php-'), 'initiatorName' => 'testapi',
        'securityCredential' => Daraja::securityCredential('Safaricom999!*!', $cert),
        'amount' => 10, 'shortcode' => '600999', 'phone' => '0712345678',
        'resultUrl' => "http://127.0.0.1:{$cbPort}/payments/b2c/result",
        'timeoutUrl' => "http://127.0.0.1:{$cbPort}/payments/b2c/timeout", 'occasion' => 'Refund',
    ]);
    check('B2C request accepted', $b2c['ResponseCode'] === '0');
} finally {
    proc_terminate($mock);
    proc_terminate($cb);
    @unlink($log);
}

echo "{$passed} passed\n";
