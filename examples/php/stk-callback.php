<?php
// Plain-PHP endpoint for the STK Push callback, for example at https://example.com/payments/stk-callback.
// In Laravel, put the same body in a controller method and exclude the route from CSRF checks.
require __DIR__ . '/Daraja.php';

$body = json_decode(file_get_contents('php://input'), true);

header('Content-Type: application/json');
if (!is_array($body)) {
    http_response_code(400);
    exit;
}

// Acknowledge straight away. M-Pesa doesn't retry, so never fail this response.
echo json_encode(['ResultCode' => 0, 'ResultDesc' => 'Accepted']);

$payment = Daraja::parseStkCallback($body);

// Save the result against the CheckoutRequestID you stored when you sent the push.
// Here it's appended to a file so the tests can read it.
file_put_contents(
    getenv('DARAJA_CALLBACK_LOG') ?: sys_get_temp_dir() . '/stk-callbacks.jsonl',
    json_encode($payment) . "\n",
    FILE_APPEND | LOCK_EX,
);
