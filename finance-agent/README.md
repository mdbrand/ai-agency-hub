# Finance Agent — daily cash report → Slack

Read-only morning cash report. **MVP-0** covers **Mercury → Slack**.
Chase (business + personal) via Plaid is **Phase B**, not yet built.

This agent never stores bank usernames/passwords and never logs into bank
websites. It holds a Mercury **read-only** API token and a Slack webhook URL.

## How it works

```
GitHub Actions cron (7am AZ)
        │
        ▼
  src/report.ts ──► Mercury read-only API  (GET /accounts)
        │
        └────────► Slack Incoming Webhook  (POST message)
```

If Mercury fails, the report still posts with a `⚠️ Mercury: unavailable`
line instead of going silent.

## One-time setup

### 1. Mercury read-only token
Mercury → **Settings → API tokens** → create a **read-only** token. Copy it.

### 2. Slack Incoming Webhook
- Create a Slack app at https://api.slack.com/apps → **Incoming Webhooks** → enable.
- **Add New Webhook to Workspace** → pick a **private channel only you're in**
  (your balances will be visible to everyone in the channel you choose).
- Copy the webhook URL.

### 3. Run locally to test
```bash
cd finance-agent
cp .env.example .env      # then paste your token + webhook URL into .env
npm install
npm run report            # should post a message to your Slack channel
```

### 4. Schedule it (GitHub Actions)
- Push this repo to GitHub.
- Repo **Settings → Secrets and variables → Actions** → add:
  - `MERCURY_API_TOKEN`
  - `SLACK_WEBHOOK_URL`
- The workflow in `.github/workflows/daily-report.yml` runs daily at 14:00 UTC
  (7am Arizona). Use the **Actions tab → Run workflow** to test on demand.

## Security notes
- `.env` is gitignored — never commit real secrets. Only `.env.example` is tracked.
- Mercury token is **read-only**; the webhook posts to a **private** channel.
- The code logs status/errors only — never balances or secrets.

## Roadmap
- **Phase B:** add Chase business + personal via Plaid (Balance product). Each
  Chase login becomes one Plaid Item / access token, added as a new `Section`
  in `src/report.ts`.
