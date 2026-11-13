# AI question test

**Date:** 13 November 2026
**Method:** A separate AI agent (Claude Sonnet) received the full text of the 35 documentation pages in one file, like `llms-full.txt`, and was told to answer only from it, with no web search or prior knowledge. It answered 10 questions written the way developers ask them in GitHub issues and forums, and listed anything confusing it noticed.

## Results: 10/10 correct, all high confidence

| # | Question | Correct | Pages cited |
| --: | :-- | :-- | :-- |
| 1 | STK Push returns `500.001.1001 Wrong credentials` but the token works | Yes | troubleshooting/wrong-credentials |
| 2 | ngrok callback at `/api/mpesa/callback` never arrives | Yes: blocked word `mpesa`, and tunnels may be blocked | concepts/callbacks, troubleshooting/callback-not-received |
| 3 | Till number: `TransactionType`, `BusinessShortCode`, `PartyB` | Yes | concepts/paybill-till-and-shortcodes |
| 4 | B2C `SecurityCredential` in Python, and which padding | Yes: PKCS #1 v1.5, with code | guides/encrypt-the-security-credential |
| 5 | Four servers, random `Invalid Access Token` | Yes: each new token invalidates the last; share one | troubleshooting/invalid-access-token |
| 6 | Customer cancelled: result code, and is there a receipt? | Yes: `1032`, no `CallbackMetadata` | guides/handle-the-stk-callback |
| 7 | `Urls are already registered` after go-live | Yes: delete in URL management, then register | troubleshooting/urls-already-registered |
| 8 | Does the sandbox take real money, and how do I get it back? | Yes: reversed at 6 AM, or email support | reference/sandbox-test-values |
| 9 | `0712345678` gives `Invalid PhoneNumber` | Yes: `2547XXXXXXXX`, with a normalizer | troubleshooting/bad-request-invalid |
| 10 | B2C `ResponseCode 0`, then `ResultCode 2001` | Yes: initiator, password, certificate, padding | troubleshooting/initiator-information-is-invalid |

## Confusing spots it found, and fixes

| Found | Fix |
| :-- | :-- |
| STK result code `2001` had a description that reads like B2C's | Reworded the row to say it means a wrong PIN in an STK callback |
| "The transaction is being processed" appeared in a guide but not in the error-code table | Added it, labeled as developer-reported |
| No clear answer on whether the sandbox blocks ngrok | Said plainly that it's unconfirmed, and added it to `verify-in-sandbox.md` |

**Later correction:** question 5's answer relied on the official claim that a new token invalidates the old one. A live sandbox test contradicted that, so the troubleshooting page now presents it as an official claim that wasn't observed, and still recommends one shared token.

The other items it listed were discrepancies in the official docs that these docs already flag on purpose, such as field spellings and overloaded error codes.
