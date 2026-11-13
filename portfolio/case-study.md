# Case study: AI-ready, tested docs for Kenya's most-used payments API

**Project:** Daraja for Developers, unofficial docs for Safaricom's M-Pesa Daraja 3.0 API
**Author:** Isaac Tony, technical writer
**Live site:** https://safaricom-daraja-docs.mintlify.site/ (pending publication)
**Source:** https://github.com/isaactony/daraja-docs
**Tools:** Mintlify, OpenAPI 3.1, Node.js, Python, PHP, GitHub Actions

## The problem

Almost every Kenyan app that takes payments integrates M-Pesa through Safaricom's Daraja API. Developers struggle with it:

- **The same errors for years.** On Safaricom's own sample-code repositories, the issue for "Wrong credentials" has about 100 comments going back to 2017, "No response at the callback URL" has 41, and "Invalid Access Token" has 29.
- **Docs AI tools can't read.** The official portal builds its pages with JavaScript. A plain request, which is what many AI crawlers make, gets back only the page skeleton. There's no `llms.txt` and no OpenAPI file, and the Postman collection requires a login.
- **Samples that fail when copied.** The official STK Query sample has a corrupted password and invalid JSON.
- **A sandbox that hides failures.** It almost always succeeds, so error handling first runs in production.

## What I did

### 1. Research

- Read every relevant official page (Authorization, M-Pesa Express, Query, C2B, B2C, Transaction Status, Getting Started, FAQ) as published on 13 November 2026, and saved copies to check facts against.
- Reviewed GitHub issues on Safaricom's sample repositories and popular community libraries, plus Stack Overflow and developer articles, to find the problems developers hit most.
- Caught and corrected a research error: an early brief said the docs required a login. Checking the live portal showed they're public, and that the real AI problem is JavaScript rendering.

### 2. Information architecture

| Section | Pages | Purpose |
| :-- | --: | :-- |
| Get started | 4 | What Daraja does, a curl quickstart, sandbox credentials, AI tools |
| Concepts | 5 | Request flow, paybill vs till, callbacks, environments, security credentials |
| How-to guides | 10 | Complete tasks, from the token to going live |
| Reference | 5 | Endpoints, result codes, error codes, test values, known doc discrepancies |
| Troubleshooting | 7 | One page per error, titled with the exact error message |
| Resources | 3 | FAQ, glossary, about these docs |
| API reference | 8 | An overview plus 7 endpoints from a hand-written OpenAPI file |

### 3. Findings that changed the docs

| Finding | Where it's documented |
| :-- | :-- |
| The official STK Query sample password doesn't decode to shortcode + passkey + timestamp, so copying it fails | Known doc discrepancies, Wrong credentials |
| The official STK Push sample password **does** decode correctly, so it's a test vector: readers can check their password code against it | Wrong credentials; it's also a unit test in all three languages |
| Field spellings differ across APIs: `Occassion` vs `Occasion`, `OriginatorCoversationID`, `QueueTimeOutURL` vs `QueueTimeoutURL` | Known doc discrepancies, each guide |
| "Invalid Access Token" has two codes, and `500.001.1001` has three meanings | Error codes |
| The current STK pages document only result codes 0 and 1032 | Result codes, with each code's source labeled |
| Getting Started recommends ngrok; the C2B page says ngrok is "usually blocked" | Test callbacks locally |
| Requesting a token invalidates the previous one, which breaks multi-server apps at random | Invalid Access Token |
| A sandbox STK Push moves real money from a real phone | Quickstart, sandbox values, FAQ |
| One Daraja app can't have both C2B and B2C | Get sandbox credentials, B2C |
| **Live sandbox:** the official FAQ says a new token invalidates the old one, but the old token kept working | Get an access token, Invalid Access Token |
| **Live sandbox:** the rate limit is stated in the 429 error itself: 30 STK Queries a minute, burst 3, in a `fault` format that `errorCode` handlers miss | Error codes, Confirm a payment |
| **Live sandbox:** a wrong secret returns HTTP 400 with an empty body; a `GET` returns "Service is temporarily unavailable", not 405 | Get an access token, Error codes |
| Linux `base64` wraps the password onto two lines | Quickstart, Wrong credentials |

### 4. Docs as code

- **A tested client in three languages.** Node.js, Python, and PHP, with no Daraja-specific dependencies, in `examples/`.
- **46 tests in CI**: 18 Node.js, 14 Python, and 14 PHP. They include unit tests against the official sample payloads, and end-to-end tests of push → callback → query, C2B validation and confirmation, and B2C with a real RSA credential.
- **A local mock of Daraja** that copies the official error codes and messages and can produce failures the sandbox can't, such as a cancelled prompt or insufficient funds.
- **A snippet check** in CI that fails if code on a page drifts from the tested files.
- **Quickstart shell commands** run in both bash and zsh.
- **Checked against the live sandbox** with my own probe requests, built so no payment prompt was ever sent. This confirmed 9 claims, contradicted 2, and found 9 new behaviors, including an undocumented result code, `9999`. I traced it with a series of controlled tests: it wasn't the phone or the app, but the callback URL's host. Every GitHub Pages callback failed, and every other domain worked. The mock was then changed to match reality. Everything still unverified is listed in `verify-in-sandbox.md`.

### 5. AI readiness

- Mintlify's `llms.txt`, `llms-full.txt`, Markdown pages, MCP server, and AI menu.
- Agent instructions that encode the rules AI tools most often get wrong: the password format, the paybill vs till fields, blocked callback words, and never asking users to paste secrets.
- A custom `skill.md` for coding agents.
- An unofficial OpenAPI 3.1 file, which Safaricom doesn't publish, validated with Mintlify's OpenAPI check.

## Results

| Measure | Result |
| :-- | :-- |
| AI question test: 10 real developer questions, docs-only | **10/10 correct, all high confidence** |
| Code tests | 46 passing in Node.js, Python, and PHP |
| Live sandbox | 9 claims confirmed, 2 contradicted and corrected, 9 new behaviors documented, including an undocumented result code, `9999` |
| Snippet drift check | 16 snippets match the tested files |
| Broken links | 0 (Mintlify broken-links check) |
| OpenAPI | Valid (Mintlify openapi-check) |
| Accessibility | No issues; primary color contrast 5.36:1 |

The AI test also found three confusing spots, which I fixed: the double meaning of result code `2001`, a missing "transaction is being processed" entry in the error table, and an unclear statement about tunnels in the sandbox.

## What I'd do next

- Finish the live checks that need a phone, C2B registration, or B2C (`verify-in-sandbox.md`).
- Add Account Balance, Reversal, Dynamic QR, and Ratiba.
- Report the documented discrepancies to Safaricom.
