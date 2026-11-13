// Minimal M-Pesa Daraja client used throughout the docs. Node.js 18+ (uses built-in fetch).
// No dependencies, so you can copy any function into your own project.
import crypto from 'node:crypto';

const HOSTS = {
  sandbox: 'https://sandbox.safaricom.co.ke',
  production: 'https://api.safaricom.co.ke',
};

export function baseUrl(env = process.env.DARAJA_ENV || 'sandbox') {
  return process.env.DARAJA_BASE_URL || HOSTS[env];
}

// YYYYMMDDHHmmss in Kenya time (EAT, UTC+3), whatever the server's time zone.
export function timestamp(date = new Date()) {
  const eat = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    eat.getUTCFullYear() +
    pad(eat.getUTCMonth() + 1) +
    pad(eat.getUTCDate()) +
    pad(eat.getUTCHours()) +
    pad(eat.getUTCMinutes()) +
    pad(eat.getUTCSeconds())
  );
}

// Password = base64(BusinessShortCode + Passkey + Timestamp)
export function stkPassword(shortcode, passkey, ts) {
  return Buffer.from(`${shortcode}${passkey}${ts}`).toString('base64');
}

// Accepts 0712345678, +254712345678, 254712345678, or 712345678. Returns 254712345678.
export function normalizePhone(input) {
  const digits = String(input).replace(/\D/g, '');
  const local = digits.replace(/^(254|0)/, '');
  if (!/^[17]\d{8}$/.test(local)) {
    throw new Error(`Not a Kenyan mobile number: ${input}`);
  }
  return `254${local}`;
}

// Tokens last 3600 seconds. Keep one cached token per app and refresh it shortly before it expires;
// requesting a token per call wastes requests and can hit Daraja's rate limits.
let cached = { token: null, expiresAt: 0 };

export async function getToken({
  key = process.env.DARAJA_CONSUMER_KEY,
  secret = process.env.DARAJA_CONSUMER_SECRET,
  now = Date.now(),
} = {}) {
  if (cached.token && now < cached.expiresAt - 60_000) return cached.token;
  const auth = Buffer.from(`${key}:${secret}`).toString('base64');
  const res = await fetch(`${baseUrl()}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new DarajaError(res.status, body);
  }
  cached = { token: body.access_token, expiresAt: now + Number(body.expires_in) * 1000 };
  return cached.token;
}

export function clearTokenCache() {
  cached = { token: null, expiresAt: 0 };
}

export class DarajaError extends Error {
  constructor(status, body) {
    super(`${body.errorCode || status}: ${body.errorMessage || JSON.stringify(body)}`);
    this.status = status;
    this.errorCode = body.errorCode;
    this.body = body;
  }
}

async function post(path, payload) {
  const token = await getToken();
  const res = await fetch(`${baseUrl()}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.errorCode) throw new DarajaError(res.status, body);
  return body;
}

// Sends an M-Pesa Express (STK Push) prompt to the customer's phone.
// Use type 'CustomerBuyGoodsOnline' and the till number as partyB for a till.
export async function stkPush({
  amount,
  phone,
  accountReference,
  description = 'Payment',
  callbackUrl = process.env.DARAJA_CALLBACK_URL,
  shortcode = process.env.DARAJA_SHORTCODE,
  passkey = process.env.DARAJA_PASSKEY,
  type = 'CustomerPayBillOnline',
  partyB = shortcode,
}) {
  const ts = timestamp();
  const msisdn = normalizePhone(phone);
  return post('/mpesa/stkpush/v1/processrequest', {
    BusinessShortCode: shortcode,
    Password: stkPassword(shortcode, passkey, ts),
    Timestamp: ts,
    TransactionType: type,
    Amount: Math.round(amount),
    PartyA: msisdn,
    PartyB: partyB,
    PhoneNumber: msisdn,
    CallBackURL: callbackUrl,
    AccountReference: String(accountReference).slice(0, 12),
    TransactionDesc: description.slice(0, 13),
  });
}

// Asks M-Pesa for the result of an STK Push you started.
export async function stkQuery({
  checkoutRequestId,
  shortcode = process.env.DARAJA_SHORTCODE,
  passkey = process.env.DARAJA_PASSKEY,
}) {
  const ts = timestamp();
  return post('/mpesa/stkpushquery/v1/query', {
    BusinessShortCode: shortcode,
    Password: stkPassword(shortcode, passkey, ts),
    Timestamp: ts,
    CheckoutRequestID: checkoutRequestId,
  });
}

// Turns the STK callback body into a flat object.
// CallbackMetadata is present only when ResultCode is 0.
export function parseStkCallback(body) {
  const cb = body?.Body?.stkCallback;
  if (!cb) throw new Error('Not an STK callback: missing Body.stkCallback');
  const items = Object.fromEntries(
    (cb.CallbackMetadata?.Item ?? []).map((item) => [item.Name, item.Value]),
  );
  return {
    paid: Number(cb.ResultCode) === 0,
    resultCode: Number(cb.ResultCode),
    resultDesc: cb.ResultDesc,
    merchantRequestId: cb.MerchantRequestID,
    checkoutRequestId: cb.CheckoutRequestID,
    amount: items.Amount,
    receipt: items.MpesaReceiptNumber,
    transactionDate: items.TransactionDate != null ? String(items.TransactionDate) : undefined,
    phone: items.PhoneNumber != null ? String(items.PhoneNumber) : undefined,
  };
}

// SecurityCredential for B2C, Transaction Status, Account Balance, and Reversal:
// RSA-encrypt the initiator password with M-Pesa's public key certificate,
// using PKCS #1 v1.5 padding (not OAEP), then base64-encode the result.
export function securityCredential(initiatorPassword, certificatePem) {
  const encrypted = crypto.publicEncrypt(
    { key: certificatePem, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(initiatorPassword),
  );
  return encrypted.toString('base64');
}

// Sends money from a B2C shortcode to a customer.
export async function b2cPayment({
  amount,
  phone,
  originatorConversationId,
  commandId = 'BusinessPayment',
  remarks = 'Payout',
  occasion,
  shortcode = process.env.DARAJA_B2C_SHORTCODE,
  initiatorName = process.env.DARAJA_INITIATOR_NAME,
  securityCredential: credential = process.env.DARAJA_SECURITY_CREDENTIAL,
  resultUrl = process.env.DARAJA_RESULT_URL,
  timeoutUrl = process.env.DARAJA_TIMEOUT_URL,
}) {
  const payload = {
    OriginatorConversationID: originatorConversationId,
    InitiatorName: initiatorName,
    SecurityCredential: credential,
    CommandID: commandId,
    Amount: Math.round(amount),
    PartyA: shortcode,
    PartyB: normalizePhone(phone),
    Remarks: remarks,
    QueueTimeOutURL: timeoutUrl,
    ResultURL: resultUrl,
  };
  // The B2C API spells this field "Occassion".
  if (occasion) payload.Occassion = occasion;
  return post('/mpesa/b2c/v3/paymentrequest', payload);
}

// Turns a B2C, Transaction Status, or other "Result" callback into a flat object.
export function parseResult(body) {
  const r = body?.Result;
  if (!r) throw new Error('Not a result callback: missing Result');
  const params = [].concat(r.ResultParameters?.ResultParameter ?? []);
  return {
    ok: Number(r.ResultCode) === 0,
    resultCode: Number(r.ResultCode),
    resultDesc: r.ResultDesc,
    originatorConversationId: r.OriginatorConversationID,
    conversationId: r.ConversationID,
    transactionId: r.TransactionID,
    parameters: Object.fromEntries(params.map((p) => [p.Key, p.Value])),
  };
}
