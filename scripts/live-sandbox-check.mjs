// Checks the docs' Node.js client against Safaricom's real Daraja sandbox.
// Needs a .env file (copy .env.example). Never prints your keys.
//
// WARNING: a sandbox STK Push sends a real prompt to DARAJA_TEST_PHONE and moves real money.
// Safaricom reverses sandbox test payments automatically at 6 AM the next day. This script sends Ksh 1.
//
// Run from the repo root: node --env-file=.env scripts/live-sandbox-check.mjs [--push]
import { getToken, stkPush, stkQuery, DarajaError } from '../examples/node/daraja.js';

const push = process.argv.includes('--push');
const required = ['DARAJA_CONSUMER_KEY', 'DARAJA_CONSUMER_SECRET'];
if (push) required.push('DARAJA_PASSKEY', 'DARAJA_TEST_PHONE', 'DARAJA_CALLBACK_URL');
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing in .env: ${missing.join(', ')}`);
  process.exit(1);
}

const log = (label, value) => console.log(`${label.padEnd(28)} ${value}`);

const token = await getToken();
log('OAuth token', `received (${token.length} characters)`);

if (!push) {
  console.log('\nToken check passed. Add --push to send a Ksh 1 STK Push to DARAJA_TEST_PHONE.');
  process.exit(0);
}

const ack = await stkPush({ amount: 1, phone: process.env.DARAJA_TEST_PHONE, accountReference: 'DocsTest', description: 'Docs test' });
log('STK Push ResponseCode', ack.ResponseCode);
log('ResponseDescription', ack.ResponseDescription);
log('CheckoutRequestID', ack.CheckoutRequestID);
console.log('\nCheck the phone, then wait. Querying every 10 seconds for up to 2 minutes...\n');

for (let i = 0; i < 12; i++) {
  await new Promise((r) => setTimeout(r, 10_000));
  try {
    const status = await stkQuery({ checkoutRequestId: ack.CheckoutRequestID });
    log('STK Query ResultCode', status.ResultCode);
    log('ResultDesc', status.ResultDesc);
    process.exit(0);
  } catch (err) {
    if (err instanceof DarajaError) {
      // Rate limiting returns HTTP 429 with a "fault" object instead of errorCode.
      const detail = err.body.fault?.faultstring ?? err.body.errorMessage ?? JSON.stringify(err.body);
      log(`Query ${i + 1}`, `HTTP ${err.status} ${err.errorCode ?? ''} ${detail || '(empty message)'}`);
    } else {
      throw err;
    }
  }
}
console.log('\nNo final result after 2 minutes.');
