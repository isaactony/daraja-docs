<?php
// Minimal M-Pesa Daraja client used throughout the docs. PHP 8.1+ with the curl and openssl extensions.
// No Composer packages, so you can copy any method into a Laravel service or plain PHP app.

final class DarajaError extends RuntimeException
{
    public function __construct(public readonly int $status, public readonly array $body)
    {
        $code = $body['errorCode'] ?? $status;
        parent::__construct("{$code}: " . ($body['errorMessage'] ?? json_encode($body)));
    }

    public function errorCode(): ?string
    {
        return $this->body['errorCode'] ?? null;
    }
}

final class Daraja
{
    private const HOSTS = [
        'sandbox' => 'https://sandbox.safaricom.co.ke',
        'production' => 'https://api.safaricom.co.ke',
    ];

    // Tokens last 3600 seconds. Keep one cached token per app and refresh it before it expires.
    // In Laravel, use Cache::remember() instead.
    private ?string $token = null;
    private int $tokenExpiresAt = 0;

    public function __construct(
        private string $consumerKey,
        private string $consumerSecret,
        private string $env = 'sandbox',
        private ?string $baseUrl = null,
    ) {
        $this->baseUrl ??= getenv('DARAJA_BASE_URL') ?: self::HOSTS[$env];
    }

    /** YYYYMMDDHHmmss in Kenya time (EAT, UTC+3), whatever the server's time zone. */
    public static function timestamp(?DateTimeInterface $now = null): string
    {
        $now = DateTimeImmutable::createFromInterface($now ?? new DateTimeImmutable('now'));
        return $now->setTimezone(new DateTimeZone('Africa/Nairobi'))->format('YmdHis');
    }

    /** Password = base64(BusinessShortCode + Passkey + Timestamp) */
    public static function stkPassword(string $shortcode, string $passkey, string $timestamp): string
    {
        return base64_encode($shortcode . $passkey . $timestamp);
    }

    /** Accepts 0712345678, +254712345678, 254712345678, or 712345678. Returns 254712345678. */
    public static function normalizePhone(string $value): string
    {
        $digits = preg_replace('/\D/', '', $value);
        $local = preg_replace('/^(254|0)/', '', $digits);
        if (!preg_match('/^[17]\d{8}$/', $local)) {
            throw new InvalidArgumentException("Not a Kenyan mobile number: {$value}");
        }
        return '254' . $local;
    }

    public function token(): string
    {
        if ($this->token && time() < $this->tokenExpiresAt - 60) {
            return $this->token;
        }
        [$status, $body] = $this->request('GET', '/oauth/v1/generate?grant_type=client_credentials', null, [
            'Authorization: Basic ' . base64_encode("{$this->consumerKey}:{$this->consumerSecret}"),
        ]);
        if ($status !== 200 || empty($body['access_token'])) {
            throw new DarajaError($status, $body);
        }
        $this->token = $body['access_token'];
        $this->tokenExpiresAt = time() + (int) $body['expires_in'];
        return $this->token;
    }

    /**
     * Sends an M-Pesa Express (STK Push) prompt to the customer's phone.
     * For a till, pass $type = 'CustomerBuyGoodsOnline' and the till number as $partyB.
     */
    public function stkPush(
        string $shortcode,
        string $passkey,
        int $amount,
        string $phone,
        string $accountReference,
        string $callbackUrl,
        string $description = 'Payment',
        string $type = 'CustomerPayBillOnline',
        ?string $partyB = null,
    ): array {
        $timestamp = self::timestamp();
        $msisdn = self::normalizePhone($phone);
        return $this->post('/mpesa/stkpush/v1/processrequest', [
            'BusinessShortCode' => $shortcode,
            'Password' => self::stkPassword($shortcode, $passkey, $timestamp),
            'Timestamp' => $timestamp,
            'TransactionType' => $type,
            'Amount' => $amount,
            'PartyA' => $msisdn,
            'PartyB' => $partyB ?? $shortcode,
            'PhoneNumber' => $msisdn,
            'CallBackURL' => $callbackUrl,
            'AccountReference' => substr($accountReference, 0, 12),
            'TransactionDesc' => substr($description, 0, 13),
        ]);
    }

    /** Asks M-Pesa for the result of an STK Push you started. */
    public function stkQuery(string $shortcode, string $passkey, string $checkoutRequestId): array
    {
        $timestamp = self::timestamp();
        return $this->post('/mpesa/stkpushquery/v1/query', [
            'BusinessShortCode' => $shortcode,
            'Password' => self::stkPassword($shortcode, $passkey, $timestamp),
            'Timestamp' => $timestamp,
            'CheckoutRequestID' => $checkoutRequestId,
        ]);
    }

    /** Turns the STK callback body into a flat array. CallbackMetadata exists only when ResultCode is 0. */
    public static function parseStkCallback(array $body): array
    {
        $cb = $body['Body']['stkCallback'] ?? throw new InvalidArgumentException('Not an STK callback');
        $items = [];
        foreach ($cb['CallbackMetadata']['Item'] ?? [] as $item) {
            $items[$item['Name']] = $item['Value'] ?? null;
        }
        return [
            'paid' => (int) $cb['ResultCode'] === 0,
            'resultCode' => (int) $cb['ResultCode'],
            'resultDesc' => $cb['ResultDesc'] ?? null,
            'merchantRequestId' => $cb['MerchantRequestID'] ?? null,
            'checkoutRequestId' => $cb['CheckoutRequestID'] ?? null,
            'amount' => $items['Amount'] ?? null,
            'receipt' => $items['MpesaReceiptNumber'] ?? null,
            // json_decode turns large numbers into floats, so format them back to digits.
            'transactionDate' => isset($items['TransactionDate']) ? number_format($items['TransactionDate'], 0, '', '') : null,
            'phone' => isset($items['PhoneNumber']) ? number_format($items['PhoneNumber'], 0, '', '') : null,
        ];
    }

    /**
     * SecurityCredential for B2C, Transaction Status, Account Balance, and Reversal:
     * RSA-encrypt the initiator password with M-Pesa's public key certificate,
     * PKCS #1 v1.5 padding (not OAEP), then base64-encode the result.
     */
    public static function securityCredential(string $initiatorPassword, string $certificatePem): string
    {
        $key = openssl_pkey_get_public($certificatePem);
        if ($key === false || !openssl_public_encrypt($initiatorPassword, $encrypted, $key, OPENSSL_PKCS1_PADDING)) {
            throw new RuntimeException('Could not encrypt with this certificate: ' . openssl_error_string());
        }
        return base64_encode($encrypted);
    }

    /** Sends money from a B2C shortcode to a customer. */
    public function b2cPayment(array $p): array
    {
        $payload = [
            'OriginatorConversationID' => $p['originatorConversationId'],
            'InitiatorName' => $p['initiatorName'],
            'SecurityCredential' => $p['securityCredential'],
            'CommandID' => $p['commandId'] ?? 'BusinessPayment',
            'Amount' => (int) $p['amount'],
            'PartyA' => $p['shortcode'],
            'PartyB' => self::normalizePhone($p['phone']),
            'Remarks' => $p['remarks'] ?? 'Payout',
            'QueueTimeOutURL' => $p['timeoutUrl'],
            'ResultURL' => $p['resultUrl'],
        ];
        if (!empty($p['occasion'])) {
            $payload['Occassion'] = $p['occasion']; // The B2C API spells it "Occassion".
        }
        return $this->post('/mpesa/b2c/v3/paymentrequest', $payload);
    }

    private function post(string $path, array $payload): array
    {
        [$status, $body] = $this->request('POST', $path, $payload, [
            'Authorization: Bearer ' . $this->token(),
            'Content-Type: application/json',
        ]);
        if ($status !== 200 || isset($body['errorCode'])) {
            throw new DarajaError($status, $body);
        }
        return $body;
    }

    private function request(string $method, string $path, ?array $payload, array $headers): array
    {
        $ch = curl_init($this->baseUrl . $path);
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 30,
        ]);
        if ($payload !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
        }
        $raw = curl_exec($ch);
        if ($raw === false) {
            throw new RuntimeException('Network error: ' . curl_error($ch));
        }
        $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        return [$status, json_decode($raw, true) ?? []];
    }
}
