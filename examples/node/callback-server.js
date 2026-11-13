// Receives Daraja callbacks. Node.js 18+, no dependencies.
// Paths avoid words Daraja rejects in URLs, such as "mpesa", "safaricom", and "query".
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { parseStkCallback, parseResult } from './daraja.js';

export function createCallbackServer({ onStk, onC2bValidate, onC2bConfirm, onResult } = {}) {
  return http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const reply = (body) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      res.writeHead(400);
      return res.end();
    }

    switch (req.url) {
      case '/payments/stk-callback':
        // Acknowledge first, then do slow work (database writes, emails) afterwards.
        reply({ ResultCode: 0, ResultDesc: 'Accepted' });
        return onStk?.(parseStkCallback(body));
      case '/payments/c2b/validate': {
        // Reply within about 8 seconds, or M-Pesa applies your default ResponseType.
        const ok = (await onC2bValidate?.(body)) ?? true;
        return reply(ok
          ? { ResultCode: '0', ResultDesc: 'Accepted' }
          : { ResultCode: 'C2B00012', ResultDesc: 'Rejected' });
      }
      case '/payments/c2b/confirm':
        reply({ ResultCode: 0, ResultDesc: 'Accepted' });
        return onC2bConfirm?.(body);
      case '/payments/b2c/result':
        reply({ ResultCode: 0, ResultDesc: 'Accepted' });
        return onResult?.(parseResult(body));
      case '/payments/b2c/timeout':
        reply({ ResultCode: 0, ResultDesc: 'Accepted' });
        return onResult?.({ ok: false, timedOut: true, body });
      default:
        res.writeHead(404);
        res.end();
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  createCallbackServer({
    onStk: (payment) => console.log('STK callback:', payment),
    onC2bConfirm: (payment) => console.log('C2B confirmation:', payment),
    onResult: (result) => console.log('Result:', result),
  }).listen(port, () => console.log(`Callbacks on http://localhost:${port}/payments/...`));
}
