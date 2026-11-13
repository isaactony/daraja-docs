---
name: daraja
description: Integrate Safaricom's M-Pesa Daraja 3.0 API in Kenya. Use when writing or debugging code that takes M-Pesa payments with STK Push (M-Pesa Express), queries STK results, receives paybill or till payments with C2B, sends money with B2C, checks transaction status, or fixes Daraja errors such as "Wrong credentials", "Invalid Access Token", "Bad Request - Invalid", callbacks not received, or result code 2001.
license: MIT
compatibility: Written for Daraja 3.0 as documented on 13 November 2026. Plain HTTPS and JSON; examples in Node.js 18+, Python 3.9+, and PHP 8.1+.
metadata:
  author: Isaac Tony
  version: "3.0"
  docs: https://safaricom-safaricom-daraja-docs.mintlify.site
  official-docs: https://developer.safaricom.co.ke/apis
---

# M-Pesa Daraja

Daraja is Safaricom's REST API for M-Pesa. Every call: get an OAuth token, POST a JSON request, get an instant acknowledgment, then receive the real result later at a callback URL.

These are unofficial community docs. Full docs: https://safaricom-safaricom-daraja-docs.mintlify.site. Page index: https://safaricom-safaricom-daraja-docs.mintlify.site/llms.txt. Official: https://developer.safaricom.co.ke/apis.

## Before you write payment code

- Ask whether the business uses a **paybill** or a **till**. Fields differ.
- Ask whether this is the **sandbox** or **production**.
- Read every secret from environment variables. Never ask the user to paste a consumer secret, passkey, initiator password, or security credential into the chat.
- Never mark an order paid from the acknowledgment. Only `ResultCode` 0 in the callback, or in STK Query, means paid.

## Endpoints

| Base URL | Sandbox `https://sandbox.safaricom.co.ke` · Production `https://api.safaricom.co.ke` |
| :-- | :-- |
| Token | `GET /oauth/v1/generate?grant_type=client_credentials`, HTTP Basic (key:secret) |
| STK Push | `POST /mpesa/stkpush/v1/processrequest` |
| STK Query | `POST /mpesa/stkpushquery/v1/query` |
| C2B register | `POST /mpesa/c2b/v2/registerurl` |
| B2C | `POST /mpesa/b2c/v3/paymentrequest` |
| Transaction Status | `POST /mpesa/transactionstatus/v1/query` |

Older tutorials use C2B `v1` and B2C `v1`; use the versions above.

## Rules that cause most bugs

- **Token:** lasts 3600 s; `expires_in` is a string. Cache one token per app in a shared cache, never one per request. The official FAQ says a new token invalidates the old one (not observed in the sandbox), so sharing is the safe design.
- **Rate limit:** the sandbox's spike arrest allowed 30 requests per minute with a burst of 3 for STK Query, and returns HTTP 429 with a `fault` object, not `errorCode`.
- **STK Password:** `base64(BusinessShortCode + Passkey + Timestamp)`. Timestamp `YYYYMMDDHHmmss`, generated once and used in both the password and the `Timestamp` field. Mismatch → `500.001.1001 Wrong credentials`. On Linux, strip newlines from `base64` output.
- **Phone:** 12 digits, `2547XXXXXXXX` or `2541XXXXXXXX`. No `+`, no leading `0`. Normalize input.
- **Paybill:** `TransactionType: CustomerPayBillOnline`, `PartyB` = paybill. **Till:** `CustomerBuyGoodsOnline`, `BusinessShortCode` = store number, `PartyB` = till number.
- **Limits:** `AccountReference` ≤ 12 chars, `TransactionDesc` ≤ 13. `Amount` whole shillings ≥ 1.
- **Callback URLs:** a server you control that accepts POST (a `*.github.io` callback caused result `9999` on every sandbox push), public, HTTPS in production, and must not contain `mpesa`, `m-pesa`, `safaricom`, `exe`, `exec`, `cmd`, `sql`, or `query` (domain or path). ngrok is "usually blocked". Exempt callback routes from CSRF.
- **STK callback:** `Body.stkCallback`. `CallbackMetadata.Item` is a name/value list and exists only when `ResultCode` is 0. `ResultCode` is a number in callbacks, a string in STK Query.
- **Lost callbacks:** store `CheckoutRequestID`, then resolve pending payments with STK Query after ~60–90 s. A query before the customer answers may return "The transaction is being processed"; treat as pending.
- **C2B:** production URL registration is one-time. Validation is off by default (email Safaricom). Reply to validation within ~8 s. Response field is spelled `OriginatorCoversationID`.
- **B2C:** `SecurityCredential` = base64(RSA encrypt initiator password with M-Pesa's certificate, **PKCS #1 v1.5**, not OAEP). Use the certificate for the right environment. Optional field is spelled `Occassion`. Failures such as `2001` arrive at `ResultURL`, not in the response. Use your own `OriginatorConversationID` to avoid paying twice.
- **Sandbox STK Push moves real money** to/from a real phone; reversed at 6 AM next day. Test with Ksh 1.
- **One app can't have both C2B and B2C.**

## Common errors

| Error | Cause |
| :-- | :-- |
| `500.001.1001` Wrong credentials | STK Password/Timestamp/shortcode mismatch or wrong passkey |
| `404.001.03` / `400.003.01` Invalid Access Token | Expired, replaced by another process, or wrong app/environment |
| `400.002.02` Bad Request - Invalid *X* | Field *X* has the wrong format |
| `400.002.05` Invalid Request Payload | Malformed JSON |
| `500.001.1001` Unable to lock subscriber | A prompt is already active on that phone; wait ≥ 1 minute |
| `500.003.1001` Urls are already registered | Delete production C2B URLs in self-service first |
| Result `1032` | Customer cancelled · `1037` phone unreachable · `1` insufficient funds · `9999` prompt never sent, caused by the callback URL in testing (undocumented) |
| Result `2001` (B2C) | Wrong initiator name/password, certificate, or padding |

For details, read the matching page from https://safaricom-safaricom-daraja-docs.mintlify.site/llms.txt.
