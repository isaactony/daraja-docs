// A local stand-in for the Daraja sandbox, used to test the docs' examples in CI.
// It is NOT Safaricom's sandbox. Error codes and messages copy the official
// Daraja 3.0 docs, or behavior observed in the real sandbox on 13 November 2026 (marked
// "observed"). Codes starting with "MOCK" exist only here.
//
// The real sandbox almost always succeeds. This mock lets you trigger failures:
// the STK Push Amount picks the result (1032 = cancelled, 1037 = timeout,
// 1001 = insufficient balance (result code 1), 2001 = wrong PIN), and anything else succeeds.
//
// Run: node examples/mock-daraja/server.js   (listens on http://localhost:4010)
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

export const MOCK = {
  consumerKey: 'mock-consumer-key',
  consumerSecret: 'mock-consumer-secret',
  shortcode: '174379',
  // The publicly known sandbox passkey for shortcode 174379.
  passkey: 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919',
  b2cShortcode: '600999',
  initiatorName: 'testapi',
  initiatorPassword: 'Safaricom999!*!',
};

const BANNED_URL_WORDS = ['mpesa', 'm-pesa', 'safaricom', 'exe', 'exec', 'cmd', 'sql', 'query'];
// Amount -> [ResultCode, ResultDesc]
const STK_RESULTS = {
  1032: [1032, 'Request cancelled by user'],
  1037: [1037, 'DS timeout user cannot be reached'],
  1001: [1, 'The balance is insufficient for the transaction.'],
  2001: [2001, 'The initiator information is invalid.'],
};

export function createMockDaraja({ callbackDelayMs = 150 } = {}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const state = {
    tokens: new Map(), // token -> expiry time
    stk: new Map(), // CheckoutRequestID -> { result, phone, done }
    lockedPhones: new Map(), // phone -> unlock time
    c2bUrls: new Map(),
    certificatePem: publicKey.export({ type: 'spki', format: 'pem' }),
  };

  const id = (prefix) => `${prefix}${Date.now()}${crypto.randomInt(1e6)}`;

  async function sendCallback(url, payload) {
    await new Promise((r) => setTimeout(r, callbackDelayMs));
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      // Like the real gateway, drop the result if your server can't be reached.
    }
  }

  function badUrl(url) {
    if (!/^https?:\/\//.test(url || '')) return true;
    return BANNED_URL_WORDS.some((w) => url.toLowerCase().includes(w));
  }

  function checkBearer(req) {
    const auth = req.headers.authorization || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    return token && (state.tokens.get(token) ?? 0) > Date.now();
  }

  const routes = {
    'GET /oauth/v1/generate': (req, url) => {
      if (url.searchParams.get('grant_type') !== 'client_credentials') {
        return [400, { errorCode: '400.008.02', errorMessage: 'Invalid grant type passed' }];
      }
      const auth = req.headers.authorization || '';
      if (!auth.startsWith('Basic ')) {
        return [400, { errorCode: '400.008.01', errorMessage: 'Invalid authentication type passed' }];
      }
      const [key, secret] = Buffer.from(auth.slice(6), 'base64').toString().split(':');
      if (key !== MOCK.consumerKey || secret !== MOCK.consumerSecret) {
        return [400, ''];  // Observed: HTTP 400 with an empty body.
      }
      // The official FAQ says a new token invalidates the previous one, but in the sandbox
      // the earlier token kept working (observed), so the mock keeps both valid.
      const token = crypto.randomBytes(14).toString('base64url');
      state.tokens.set(token, Date.now() + 3599 * 1000);
      return [200, { access_token: token, expires_in: '3599' }];
    },

    'POST /mpesa/stkpush/v1/processrequest': (req, url, b) => {
      const invalid = (field) => [400, {
        requestId: id(''), errorCode: '400.002.02', errorMessage: `Bad Request - Invalid ${field}`,
      }];
      if (!/^\d{5,7}$/.test(String(b.BusinessShortCode))) return invalid('BusinessShortCode');
      if (!/^\d{14}$/.test(String(b.Timestamp))) return invalid('Timestamp');
      if (!['CustomerPayBillOnline', 'CustomerBuyGoodsOnline'].includes(b.TransactionType)) {
        return invalid('TransactionType');
      }
      if (!(Number(b.Amount) >= 1)) return invalid('Amount');
      const phone = String(b.PhoneNumber);
      if (!/^254(7|1)\d{8}$/.test(phone)) return invalid('PhoneNumber');
      if (!/^254(7|1)\d{8}$/.test(String(b.PartyA))) return invalid('PartyA');
      if (badUrl(b.CallBackURL)) return invalid('CallBackURL');
      const expected = Buffer.from(`${b.BusinessShortCode}${MOCK.passkey}${b.Timestamp}`).toString('base64');
      if (String(b.BusinessShortCode) !== MOCK.shortcode) {
        return [500, { requestId: id(''), errorCode: '500.001.1001', errorMessage: 'Merchant does not exist' }];
      }
      if (b.Password !== expected) {
        return [500, { requestId: id(''), errorCode: '500.001.1001', errorMessage: 'Wrong credentials' }];
      }
      if ((state.lockedPhones.get(phone) ?? 0) > Date.now()) {
        return [500, {
          requestId: id(''),
          errorCode: '500.001.1001',
          errorMessage: 'Unable to lock subscriber, a transaction is already in process for the current subscriber',
        }];
      }
      state.lockedPhones.set(phone, Date.now() + callbackDelayMs + 50);

      const merchantRequestId = id('mock-');
      const checkoutRequestId = id('ws_CO_');
      const [code, desc] = STK_RESULTS[Number(b.Amount)] ?? [0, 'The service request is processed successfully.'];
      const stkCallback = {
        MerchantRequestID: merchantRequestId,
        CheckoutRequestID: checkoutRequestId,
        ResultCode: code,
        ResultDesc: desc,
      };
      if (code === 0) {
        stkCallback.CallbackMetadata = {
          Item: [
            { Name: 'Amount', Value: Number(b.Amount) },
            { Name: 'MpesaReceiptNumber', Value: `MCK${crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 7)}` },
            { Name: 'TransactionDate', Value: Number(b.Timestamp) },
            { Name: 'PhoneNumber', Value: Number(phone) },
          ],
        };
      }
      const record = { stkCallback, done: false };
      state.stk.set(checkoutRequestId, record);
      sendCallback(b.CallBackURL, { Body: { stkCallback } }).finally(() => { record.done = true; });

      return [200, {
        MerchantRequestID: merchantRequestId,
        CheckoutRequestID: checkoutRequestId,
        ResponseCode: '0',
        ResponseDescription: 'Success. Request accepted for processing',
        CustomerMessage: 'Success. Request accepted for processing',
      }];
    },

    'POST /mpesa/stkpushquery/v1/query': (req, url, b) => {
      const expected = Buffer.from(`${b.BusinessShortCode}${MOCK.passkey}${b.Timestamp}`).toString('base64');
      if (b.Password !== expected) {
        return [500, { requestId: id(''), errorCode: '500.001.1001', errorMessage: 'Wrong credentials' }];
      }
      const record = state.stk.get(b.CheckoutRequestID);
      if (!record) {
        // Observed in the sandbox.
        return [500, { requestId: b.CheckoutRequestID, errorCode: '500.001.1001', errorMessage: 'The transaction does not Exist' }];
      }
      if (!record.done) {
        // Community-reported response while the customer hasn't answered yet.
        return [500, { requestId: id(''), errorCode: '500.001.1001', errorMessage: 'The transaction is being processed' }];
      }
      const cb = record.stkCallback;
      return [200, {
        ResponseCode: '0',
        ResponseDescription: 'The service request has been accepted successfully',
        MerchantRequestID: cb.MerchantRequestID,
        CheckoutRequestID: cb.CheckoutRequestID,
        ResultCode: String(cb.ResultCode),
        ResultDesc: cb.ResultDesc,
      }];
    },

    'POST /mpesa/c2b/v2/registerurl': (req, url, b) => {
      if (!['Completed', 'Cancelled'].includes(b.ResponseType)) {
        return [400, { requestId: id(''), errorCode: '400.002.02', errorMessage: 'Bad Request - Invalid ResponseType' }];
      }
      for (const field of ['ConfirmationURL', 'ValidationURL']) {
        if (badUrl(b[field])) {
          return [400, { requestId: id(''), errorCode: '400.002.02', errorMessage: `Bad Request - Invalid ${field}` }];
        }
      }
      state.c2bUrls.set(String(b.ShortCode), b); // Sandbox lets you re-register.
      return [200, { OriginatorCoversationID: id(''), ResponseCode: '0', ResponseDescription: 'Success' }];
    },

    'POST /mpesa/c2b/v2/simulate': (req, url, b) => {
      const urls = state.c2bUrls.get(String(b.ShortCode));
      if (!urls) {
        return [400, { requestId: id(''), errorCode: 'MOCK.400.02', errorMessage: 'No URLs registered for this short code (mock only)' }];
      }
      const notification = {
        TransactionType: b.CommandID === 'CustomerBuyGoodsOnline' ? 'Buy Goods' : 'Pay Bill',
        TransID: `MCK${crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 7)}`,
        TransTime: '20261113120000',
        TransAmount: Number(b.Amount).toFixed(2),
        BusinessShortCode: String(b.ShortCode),
        BillRefNumber: b.BillRefNumber ?? '',
        InvoiceNumber: '',
        OrgAccountBalance: '',
        ThirdPartyTransID: '',
        MSISDN: `${String(b.Msisdn).slice(0, 4)} ***** ${String(b.Msisdn).slice(-3)}`,
        FirstName: 'JOHN',
        MiddleName: '',
        LastName: '',
      };
      (async () => {
        // External validation is off by default on real shortcodes; the mock always asks,
        // so the docs' validation handler can be tested.
        let accepted = true;
        try {
          await new Promise((r) => setTimeout(r, callbackDelayMs));
          const res = await fetch(urls.ValidationURL, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(notification),
          });
          const reply = await res.json();
          accepted = String(reply.ResultCode) === '0';
        } catch {
          accepted = urls.ResponseType === 'Completed';
        }
        if (accepted) await sendCallback(urls.ConfirmationURL, { ...notification, OrgAccountBalance: '1000.00' });
      })();
      return [200, { OriginatorCoversationID: id(''), ResponseCode: '0', ResponseDescription: 'Accept the service request successfully.' }];
    },

    'POST /mpesa/b2c/v3/paymentrequest': (req, url, b) => {
      for (const field of ['OriginatorConversationID', 'InitiatorName', 'SecurityCredential', 'CommandID', 'PartyA', 'PartyB', 'ResultURL', 'QueueTimeOutURL']) {
        if (!b[field]) return [400, { requestId: id(''), errorCode: '400.002.02', errorMessage: `Bad Request - Invalid ${field}` }];
      }
      if (!/^254(7|1)\d{8}$/.test(String(b.PartyB))) {
        return [400, { requestId: id(''), errorCode: '400.002.02', errorMessage: 'Bad Request - Invalid PartyB' }];
      }
      let password = null;
      try {
        password = crypto.privateDecrypt(
          { key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING },
          Buffer.from(b.SecurityCredential, 'base64'),
        ).toString();
      } catch {
        password = null;
      }
      const conversationId = id('AG_MOCK_');
      const ok = b.InitiatorName === MOCK.initiatorName && password === MOCK.initiatorPassword;
      const Result = {
        ResultType: 0,
        ResultCode: ok ? 0 : 2001,
        ResultDesc: ok ? 'The service request is processed successfully.' : 'The initiator information is invalid.',
        OriginatorConversationID: b.OriginatorConversationID,
        ConversationID: conversationId,
        TransactionID: `MCK${crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 7)}`,
      };
      if (ok) {
        Result.ResultParameters = {
          ResultParameter: [
            { Key: 'TransactionAmount', Value: Number(b.Amount) },
            { Key: 'TransactionReceipt', Value: Result.TransactionID },
            { Key: 'ReceiverPartyPublicName', Value: `${b.PartyB} - JOHN DOE` },
            { Key: 'TransactionCompletedDateTime', Value: '13.11.2026 12:00:00' },
            { Key: 'B2CRecipientIsRegisteredCustomer', Value: 'Y' },
          ],
        };
      }
      sendCallback(b.ResultURL, { Result });
      return [200, {
        ConversationID: conversationId,
        OriginatorConversationID: b.OriginatorConversationID,
        ResponseCode: '0',
        ResponseDescription: 'Accept the service request successfully.',
      }];
    },
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const send = ([status, body]) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(body === '' ? '' : JSON.stringify(body));
    };

    if (url.pathname === '/mock/certificate') {
      res.writeHead(200, { 'Content-Type': 'application/x-pem-file' });
      return res.end(state.certificatePem);
    }
    const route = routes[`${req.method} ${url.pathname}`];
    if (!route) {
      const known = Object.keys(routes).some((r) => r.endsWith(` ${url.pathname}`));
      // The official docs say 405.001; the sandbox actually returned this (observed).
      return send(known
        ? [500, { requestId: id(''), errorCode: '500.002.1001', errorMessage: 'Service is temporarily unavailable. Please try again later' }]
        : [404, { requestId: id(''), errorCode: '404.001.01', errorMessage: 'Resource not found' }]);
    }
    if (req.method === 'POST' && !req.headers.authorization) {
      return send([404, { requestId: '', errorCode: '404.001.04', errorMessage: 'Invalid Authentication Header' }]); // Observed.
    }
    if (req.method === 'POST' && !checkBearer(req)) {
      return send([404, { requestId: id(''), errorCode: '404.001.03', errorMessage: 'Invalid Access Token' }]);
    }
    let body = {};
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        return send([400, { requestId: id(''), errorCode: '400.002.05', errorMessage: 'Invalid Request Payload' }]);
      }
    }
    send(await route(req, url, body));
  });

  return { server, state, certificatePem: state.certificatePem };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4010);
  createMockDaraja().server.listen(port, () => {
    console.log(`Mock Daraja listening on http://localhost:${port}`);
    console.log(`Consumer key: ${MOCK.consumerKey}  Consumer secret: ${MOCK.consumerSecret}`);
  });
}
