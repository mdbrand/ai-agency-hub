# Slack Athena Bot

Gives Athena a real, separate Slack identity — instead of posting as Rob's own account (which is what the standard Slack MCP connector does), this posts directly through Slack's Web API using a dedicated Bot User OAuth token.

This is **send-only**. Reading/polling a channel still goes through the existing Slack MCP connector (`mcp__2da248b9...`) — identity doesn't matter for reads, only for what shows up when Athena posts.

Currently reuses the old "Hermes" Slack App's bot token (bot user id `U0BCYE9AAH0`, workspace `MDBRAND`) — same app that was built for the abandoned Next.js Mission OS, just repurposed. Still displays as "hermes_rob_cos" until renamed in Slack's Display Information settings (api.slack.com/apps -> the app -> Display Information) — that's a manual step in Slack's own UI, not something this script can change.

## Setup

```bash
cd slack-athena-bot
cp .env.example .env
```

Paste the Bot User OAuth Token (`xoxb-...`, from api.slack.com/apps -> the app -> OAuth & Permissions) into `.env` yourself. Never paste this into chat — same rule as every other credential in this project.

## Commands

```bash
node src/post.mjs auth-test
```
Confirms the token is valid and prints which bot identity/workspace it's authenticated as.

```bash
node src/post.mjs post <channel_id> "message text"
```
Posts as the bot to the given channel. Returns the message `ts` and `channel`.

## Usage in the Slack polling loop

When Athena needs to reply in `#chief-of-staff` (or any channel), use this script instead of the Slack MCP connector's `slack_send_message` — that tool posts as Rob's own account, this one posts as the bot.
