// Tests every Node.js example in the docs. Run: node --test
// Unit tests use the official sample payloads from the Daraja 3.0 docs.
// End-to-end tests run against the local mock in ../mock-daraja, not Safaricom's sandbox.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import crypto from 'node:crypto';
import {
  timestamp, stkPassword, normalizePhone, parseStkCallback, parseResult, securityCredential,
  getToken, clearTokenCache, stkPush, stkQuery, b2cPayment, DarajaError,
} from './daraja.js';
import { createCallbackServer } from './callback-server.js';
import { createMockDaraja, MOCK } from '../mock-daraja/server.js';

// Official sample: the STK Push request's Password decodes to shortcode + passkey + timestamp.
const OFFICIAL_PASSWORD =
  'MTc0Mzc5YmZiMjc5ZjlhYTliZGJjZjE1OGU5N2RkNzFhNDY3Y2QyZTBjODkzMDU5YjEwZjc4ZTZiNzJhZGExZWQyYzkxOTIwMjEwNjI4MDkyNDA4';

test('stkPassword reproduces the official sample Password', () => {
  assert.equal(stkPassword('174379', MOCK.passkey, '20210628092408'), OFFICIAL_PASSWORD);
});

test('timestamp is YYYYMMDDHHmmss in Kenya time', () => {
  // 21:30:05 UTC is 00:30:05 the next day in Nairobi (UTC+3).
  assert.equal(timestamp(new Date('2026-11-13T21:30:05Z')), '20261114003005');
  assert.match(timestamp(), /^\d{14}$/);
});

test('normalizePhone accepts common Kenyan formats', () => {
  for (const input of ['0712345678', '+254712345678', '254712345678', '712345678', '0712 345 678']) {
    assert.equal(normalizePhone(input), '254712345678');
  }
  assert.equal(normalizePhone('0110123456'), '254110123456');
  assert.throws(() => normalizePhone('0812345678'));
  assert.throws(() => normalizePhone('25471234567'));
});

test('parseStkCallback reads the official successful callback', () => {
  const payment = parseStkCallback({
    Body: {
      stkCallback: {
        MerchantRequestID: '29115-34620561-1',
        CheckoutRequestID: 'ws_CO_191220191020363925',
        ResultCode: 0,
        ResultDesc: 'The service request is processed successfully.',
        CallbackMetadata: {
          Item: [
            { Name: 'Amount', Value: 1.0 },
            { Name: 'MpesaReceiptNumber', Value: 'NLJ7RT61SV' },
            { Name: 'TransactionDate', Value: 20191219102115 },
            { Name: 'PhoneNumber', Value: 254708374149 },
          ],
        },
      },
    },
  });
  assert.equal(payment.paid, true);
  assert.equal(payment.receipt, 'NLJ7RT61SV');
  assert.equal(payment.amount, 1);
  assert.equal(payment.transactionDate, '20191219102115');
  assert.equal(payment.phone, '254708374149');
});

test('parseStkCallback reads the official cancelled callback', () => {
  const payment = parseStkCallback({
    Body: {
      stkCallback: {
        MerchantRequestID: 'f1e2-4b95-a71d-b30d3cdbb7a7942864',
        CheckoutRequestID: 'ws_CO_21072024125243250722943992',
        ResultCode: 1032,
        ResultDesc: 'Request cancelled by user',
      },
    },
  });
  assert.equal(payment.paid, false);
  assert.equal(payment.resultCode, 1032);
  assert.equal(payment.receipt, undefined);
});

test('parseResult reads the official B2C failure callback', () => {
  const result = parseResult({
    Result: {
      ResultType: 0,
      ResultCode: 2001,
      ResultDesc: 'The initiator information is invalid.',
      OriginatorConversationID: '53e3-4aa8-9fe0-8fb5e4092cdd3544366',
      ConversationID: 'AG_20240707_201062f6f6f5804f7a33',
      TransactionID: 'SG722NMVXQ',
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.resultCode, 2001);
  assert.deepEqual(result.parameters, {});
});

test('securityCredential uses RSA with PKCS #1 v1.5 padding', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  const credential = securityCredential('Safaricom999!*!', pem);
  const decrypted = crypto.privateDecrypt(
    { key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(credential, 'base64'),
  );
  assert.equal(decrypted.toString(), 'Safaricom999!*!');
});

// ---- End-to-end against the mock ----

let mock;
let callbacks;
const received = [];
let waiters = [];

function nextCallback() {
  if (received.length) return Promise.resolve(received.shift());
  return new Promise((resolve) => waiters.push(resolve));
}
function deliver(item) {
  const w = waiters.shift();
  if (w) w(item); else received.push(item);
}

before(async () => {
  mock = createMockDaraja({ callbackDelayMs: 100 });
  mock.server.listen(0);
  await once(mock.server, 'listening');
  callbacks = createCallbackServer({
    onStk: (p) => deliver({ kind: 'stk', ...p }),
    onC2bValidate: (body) => body.BillRefNumber !== 'UNKNOWN',
    onC2bConfirm: (body) => deliver({ kind: 'c2b', ...body }),
    onResult: (r) => deliver({ kind: 'result', ...r }),
  });
  callbacks.listen(0);
  await once(callbacks, 'listening');

  process.env.DARAJA_BASE_URL = `http://localhost:${mock.server.address().port}`;
  process.env.DARAJA_CONSUMER_KEY = MOCK.consumerKey;
  process.env.DARAJA_CONSUMER_SECRET = MOCK.consumerSecret;
  process.env.DARAJA_SHORTCODE = MOCK.shortcode;
  process.env.DARAJA_PASSKEY = MOCK.passkey;
  const cb = `http://localhost:${callbacks.address().port}`;
  process.env.DARAJA_CALLBACK_URL = `${cb}/payments/stk-callback`;
  process.env.DARAJA_RESULT_URL = `${cb}/payments/b2c/result`;
  process.env.DARAJA_TIMEOUT_URL = `${cb}/payments/b2c/timeout`;
  process.env.CALLBACK_BASE = cb;
});

after(() => {
  mock.server.close();
  callbacks.close();
});

test('getToken caches one token and reuses it', async () => {
  clearTokenCache();
  const first = await getToken();
  const second = await getToken();
  assert.equal(first, second);
});

test('an earlier token keeps working after a new one is issued (as observed in the sandbox)', async () => {
  clearTokenCache();
  const old = await getToken();
  clearTokenCache();
  await getToken(); // Another server instance asks for a token.
  const res = await fetch(`${process.env.DARAJA_BASE_URL}/mpesa/stkpushquery/v1/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${old}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ BusinessShortCode: MOCK.shortcode, Password: stkPassword(MOCK.shortcode, MOCK.passkey, '20261113203000'), Timestamp: '20261113203000', CheckoutRequestID: 'ws_CO_000' }),
  });
  const body = await res.json();
  assert.notEqual(body.errorCode, '404.001.03');
  assert.equal(body.errorMessage, 'The transaction does not Exist');
});

test('a wrong consumer secret gives HTTP 400 with an empty body', async () => {
  clearTokenCache();
  await assert.rejects(getToken({ secret: 'wrong' }), (err) => err.status === 400);
  clearTokenCache();
});

test('STK Push succeeds, the callback arrives, and STK Query agrees', async () => {
  const ack = await stkPush({ amount: 1, phone: '0712345678', accountReference: 'INV-1001' });
  assert.equal(ack.ResponseCode, '0');
  assert.match(ack.CheckoutRequestID, /^ws_CO_/);

  const payment = await nextCallback();
  assert.equal(payment.kind, 'stk');
  assert.equal(payment.paid, true);
  assert.equal(payment.checkoutRequestId, ack.CheckoutRequestID);
  assert.ok(payment.receipt);

  const status = await stkQuery({ checkoutRequestId: ack.CheckoutRequestID });
  assert.equal(status.ResultCode, '0');
});

test('a cancelled STK Push reports ResultCode 1032', async () => {
  const ack = await stkPush({ amount: 1032, phone: '0722000001', accountReference: 'INV-1002' });
  const payment = await nextCallback();
  assert.equal(payment.checkoutRequestId, ack.CheckoutRequestID);
  assert.equal(payment.paid, false);
  assert.equal(payment.resultCode, 1032);
});

test('STK Query before the customer answers says the transaction is being processed', async () => {
  const ack = await stkPush({ amount: 1, phone: '0722000002', accountReference: 'INV-1003' });
  await assert.rejects(stkQuery({ checkoutRequestId: ack.CheckoutRequestID }), (err) => {
    assert.ok(err instanceof DarajaError);
    assert.equal(err.errorCode, '500.001.1001');
    assert.equal(err.body.errorMessage, 'The transaction is being processed');
    return true;
  });
  await nextCallback();
});

test('a wrong passkey gives 500.001.1001 Wrong credentials', async () => {
  await assert.rejects(
    stkPush({ amount: 1, phone: '0722000003', accountReference: 'X', passkey: 'not-the-passkey' }),
    (err) => err.errorCode === '500.001.1001' && err.body.errorMessage === 'Wrong credentials',
  );
});

test('a second push to the same phone too soon gives "Unable to lock subscriber"', async () => {
  await stkPush({ amount: 1, phone: '0722000004', accountReference: 'A' });
  await assert.rejects(
    stkPush({ amount: 1, phone: '0722000004', accountReference: 'B' }),
    (err) => err.body.errorMessage.startsWith('Unable to lock subscriber'),
  );
  await nextCallback();
});

test('a callback URL containing "mpesa" is rejected', async () => {
  await assert.rejects(
    stkPush({ amount: 1, phone: '0722000005', accountReference: 'X', callbackUrl: 'https://example.com/mpesa/callback' }),
    (err) => err.errorCode === '400.002.02' && /CallBackURL/.test(err.body.errorMessage),
  );
});

test('C2B: register URLs, then a validated payment reaches the confirmation URL', async () => {
  const token = await getToken();
  const call = (path, body) => fetch(`${process.env.DARAJA_BASE_URL}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());

  const reg = await call('/mpesa/c2b/v2/registerurl', {
    ShortCode: '600984',
    ResponseType: 'Completed',
    ConfirmationURL: `${process.env.CALLBACK_BASE}/payments/c2b/confirm`,
    ValidationURL: `${process.env.CALLBACK_BASE}/payments/c2b/validate`,
  });
  assert.equal(reg.ResponseCode, '0');
  // The official response spells this field "OriginatorCoversationID".
  assert.ok(reg.OriginatorCoversationID);

  const sim = await call('/mpesa/c2b/v2/simulate', {
    ShortCode: 600984, CommandID: 'CustomerPayBillOnline', Amount: 10, Msisdn: 254708374149, BillRefNumber: 'ACC-42',
  });
  assert.equal(sim.ResponseCode, '0');
  const confirmation = await nextCallback();
  assert.equal(confirmation.kind, 'c2b');
  assert.equal(confirmation.BillRefNumber, 'ACC-42');
  assert.equal(confirmation.TransAmount, '10.00');
});

test('B2C: the right credential pays; a wrong one returns 2001 in the result callback', async () => {
  const pem = await fetch(`${process.env.DARAJA_BASE_URL}/mock/certificate`).then((r) => r.text());
  const base = {
    amount: 10, phone: '0712345678', shortcode: MOCK.b2cShortcode, initiatorName: MOCK.initiatorName,
  };

  const good = await b2cPayment({
    ...base,
    originatorConversationId: crypto.randomUUID(),
    securityCredential: securityCredential(MOCK.initiatorPassword, pem),
    occasion: 'Refund',
  });
  assert.equal(good.ResponseCode, '0');
  const paid = await nextCallback();
  assert.equal(paid.ok, true);
  assert.equal(paid.parameters.TransactionAmount, 10);

  const bad = await b2cPayment({
    ...base,
    originatorConversationId: crypto.randomUUID(),
    securityCredential: securityCredential('wrong-password', pem),
  });
  // The request is accepted; the failure arrives later, at the ResultURL.
  assert.equal(bad.ResponseCode, '0');
  const failed = await nextCallback();
  assert.equal(failed.ok, false);
  assert.equal(failed.resultCode, 2001);
});
