# Publish the Daraja docs: your steps

Everything is built and tested locally. Nothing is committed. These steps need your accounts, so you do them.

## 1. Create the GitHub repo and push

From the `daraja-docs` folder:

```bash
git init -b main
git add .
git commit -m "Daraja for Developers: unofficial, task-based docs for the M-Pesa Daraja 3.0 API"
gh repo create isaactony/daraja-docs --public --source . --push --description "Unofficial, AI-ready, task-based docs for Safaricom's M-Pesa Daraja 3.0 API (built with Mintlify). Not affiliated with Safaricom."
```

Check that `.env` isn't in the commit (`git status` shouldn't list it; `.gitignore` excludes it).

The push starts the **Test code examples** workflow. It checks that the page snippets match the example files, then runs the Node.js, Python, and PHP tests against the local mock. Check that it passes in the repo's **Actions** tab, and take a screenshot for your portfolio.

## 2. Add the site in Mintlify

1. In the Mintlify dashboard, add a new project and connect the `daraja-docs` repo. The docs are at the repo root.
2. Choose the subdomain `daraja-docs` if it's available. The pages already use `https://daraja-docs.mintlify.site`.

This is your third Mintlify site. If your plan doesn't allow another one, upgrade, or tell me and we'll look at alternatives.

If you get a different subdomain, replace it everywhere, then commit and push:

```bash
grep -rl 'daraja-docs.mintlify.site' --include='*.mdx' --include='*.md' --include='*.json' . \
  | xargs sed -i '' 's#daraja-docs.mintlify.site#<your-subdomain>.mintlify.site#g'
git commit -am "Use the live docs URL" && git push
```

## 3. Run the live sandbox check

This is what turns "tested against a mock" into "tested against Safaricom".

1. Create a free account at https://developer.safaricom.co.ke and a sandbox app with **M-Pesa Express**.
2. Copy `.env.example` to `.env` and fill in the consumer key, consumer secret, and passkey from the portal, and your own phone number.
3. Run the token check, which doesn't touch your phone:

   ```bash
   node --env-file=.env scripts/live-sandbox-check.mjs
   ```

4. If you want the full test, run it with `--push`. **This sends a real Ksh 1 prompt to your phone**, which Safaricom reverses at 6 AM the next day:

   ```bash
   node --env-file=.env scripts/live-sandbox-check.mjs --push
   ```

Then tell me it's done. I can run the script and read its output without seeing your keys, and I'll update `portfolio/verify-in-sandbox.md` and the pages it lists.

## 4. Check the live AI features

| Check | Expected |
| :-- | :-- |
| `<site>/llms.txt` | 35 pages plus 7 API endpoint pages, each with a description |
| `<site>/quickstart.md` | Markdown with an "Agent Instructions" block |
| `<site>/skill.md` | The custom Daraja skill from this repo |
| `<site>/mcp` | Responds to MCP clients |
| Menu at the top of any page | Copy page, View as Markdown, ChatGPT, Claude, Perplexity, MCP, Cursor, VS Code, download spec |

Send me the live URL and I'll run the MCP retrieval test, as for Mailpit.

## 5. Optional: share findings with Safaricom

The [Known doc discrepancies](../reference/known-doc-discrepancies.mdx) page lists problems in the official docs, such as the corrupted STK Query sample password. Reporting them to apisupport@safaricom.co.ke, politely, with the page link, is a good portfolio story if they fix any.
