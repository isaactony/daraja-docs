# Claims checked against the live sandbox

Checked on 13 November 2026 with `scripts/live-sandbox-check.mjs`, a probe script, and the logged-in Daraja dashboard. No STK prompt was sent: every probe request was built to fail before a prompt could go out (fake checkout ID, wrong password, or invalid phone).

## Confirmed

| Claim | Evidence |
| :-- | :-- |
| An OAuth token is issued with HTTP Basic auth | `200`, 28-character token |
| `expires_in` is a string (`"3599"`) | Token response |
| Missing `grant_type` → `400.008.02` Invalid grant type passed | Probe |
| Wrong passkey → `500.001.1001` Wrong credentials | STK Push probe |
| `0712345678` → `400.002.02` Bad Request - Invalid PhoneNumber, checked before the password | STK Push probe |
| A JSON body with a trailing comma is rejected | Probe (message differs; see below) |
| Sandbox passkey on Test Credentials = the one decoded from the official sample | Compared in code on the dashboard |
| Test values: initiator `testapi`, Party A `600995`, Party B `600000`, phone `254708374149`, shortcode `174379` | Dashboard → Test Credentials |
| Dashboard has Test Credentials, a Security Credential generator, and Self Service → URL Management | Dashboard |

## Contradicted, and pages corrected

| Claim | What happened | Pages updated |
| :-- | :-- | :-- |
| A new token invalidates the previous one (official FAQ) | The earlier token kept working after a second was issued | get-an-access-token, invalid-access-token, how-daraja-works, discrepancies, skill, mock, tests |
| Non-POST → `405.001` Method Not Allowed (official) | `GET` on STK Push → `500.002.1001` Service is temporarily unavailable | error-codes, discrepancies, mock |

## New findings, now documented

| Finding | Pages |
| :-- | :-- |
| Wrong consumer secret → HTTP 400 with an empty body | get-an-access-token, error-codes, mock |
| Rate limit → HTTP 429 with a `fault` object: 30 requests/minute, burst 3 (STK Query) | error-codes, confirm-a-payment, unable-to-lock-subscriber, skill, OpenAPI |
| Unknown `CheckoutRequestID` → `500.001.1001` The transaction does not Exist | error-codes, confirm-a-payment, mock |
| No `Authorization` header → `404.001.04` Invalid Authentication Header | invalid-access-token, error-codes, mock |
| `400.008.01` message is "Invalid Authentication passed" | error-codes, get-an-access-token, discrepancies |
| Trailing comma → `responseDesc: "Duplicate json key detected"` | bad-request-invalid, error-codes |
| The sandbox host was intermittently unreachable (one of its IP addresses timed out) | Not documented; seen once |
| `ResultCode 9999` "Error occurred while sending push request.": all three pushes with a `*.github.io` CallBackURL (two to a real number, one to the test number) were accepted, never sent, then returned 9999. Pushes with a callback on another domain were processed (portal simulator → 1032; our script → 1032 and 2). | result-codes, callbacks, callback-not-received, quickstart, sandbox-and-production, skill |
| A callback URL containing `mpesa` (the portal simulator's own default) didn't stop the push | callbacks |
| The test number's results are simulated and inconsistent (1032, then 2 with ResultDesc = TransactionDesc) | sandbox-test-values |
| STK Query while pending returned `500.001.1001` with an empty `errorMessage` | confirm-a-payment |

## Still not verified

These need an STK Push to a real phone (`--push`), C2B URL registration, or a B2C call.

| Claim | Page |
| :-- | :-- |
| A successful STK Push to a real phone end to end (prompt, PIN, callback, STK Query `0`), with a callback on a server that accepts POST | quickstart |
| The exact "The transaction is being processed" message (observed with an empty message instead) | confirm-a-payment |
| Sandbox STK Push charges real money and is reversed at 6 AM (official FAQ); not reached, because no prompt was delivered | get-sandbox-credentials |
| Whether callbacks with blocked words are delivered (the push itself wasn't blocked) | concepts/callbacks |
| Whether callbacks arrive through an ngrok tunnel | test-callbacks-locally |
| C2B Simulate URL `/mpesa/c2b/v2/simulate` | receive-paybill-and-till-payments, OpenAPI |
| C2B response field spelled `OriginatorCoversationID` | receive-paybill-and-till-payments |
| B2C with a credential from the real sandbox certificate | encrypt-the-security-credential |
