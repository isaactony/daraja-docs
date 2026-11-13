# Daraja for Developers (unofficial)

Unofficial, task-based, AI-ready documentation for Safaricom's **M-Pesa Daraja 3.0 API**, built with [Mintlify](https://mintlify.com).

Created by [Isaac Tony](https://github.com/isaactony), technical writer. Not affiliated with or endorsed by Safaricom. Official docs: https://developer.safaricom.co.ke/apis

## What's here

| Path | Contents |
| :-- | :-- |
| `*.mdx`, `concepts/`, `guides/`, `reference/`, `troubleshooting/`, `resources/` | The documentation pages |
| `api-reference/openapi.json` | An unofficial OpenAPI 3.1 description of the covered APIs, built by `scripts/build-openapi.py` |
| `examples/node`, `examples/python`, `examples/php` | Complete, tested client code used in the docs |
| `examples/mock-daraja` | A local mock of the Daraja API for testing, including failure results |
| `scripts/live-sandbox-check.mjs` | Runs the Node.js client against Safaricom's real sandbox with your own keys |
| `skill.md` | An agent skill for coding assistants |
| `portfolio/` | Case study and notes |

## Preview locally

```bash
npm i -g mint
mint dev
```

## Run the example tests

```bash
cd examples/node && node --test
cd examples/python && pip install -r requirements.txt && pytest -q
cd examples/php && php test.php
```

The tests run against the local mock, not Safaricom's sandbox. To check against the real sandbox, copy `.env.example` to `.env`, fill it in, and run:

```bash
node --env-file=.env scripts/live-sandbox-check.mjs          # token only
node --env-file=.env scripts/live-sandbox-check.mjs --push   # sends a real Ksh 1 prompt
```

## License

Text and code: MIT. M-Pesa and Safaricom are trademarks of Safaricom PLC.
