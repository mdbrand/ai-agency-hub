#!/usr/bin/env node
// Posts to Slack directly via the Web API, authenticated as the Athena bot
// (a dedicated Bot User OAuth token), instead of Rob's own personal Slack
// connection. This is ONLY for sending — reading/polling the channel still
// goes through the existing Slack MCP connector, since identity doesn't
// matter for reads.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnv();

const { SLACK_BOT_TOKEN } = process.env;
if (!SLACK_BOT_TOKEN) {
  console.error('Missing SLACK_BOT_TOKEN. Add it to slack-athena-bot/.env.');
  process.exit(1);
}

async function slackApi(method, body) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) {
    throw new Error(`Slack API error (${method}): ${json.error}`);
  }
  return json;
}

async function cmdAuthTest() {
  const info = await slackApi('auth.test', {});
  console.log(`Authenticated as: ${info.user} (bot user id ${info.user_id}) in workspace ${info.team}`);
}

async function cmdPost(channel, text) {
  if (!channel || !text) {
    console.error('Usage: node src/post.mjs post <channel_id> "message"');
    process.exit(1);
  }
  const result = await slackApi('chat.postMessage', { channel, text });
  console.log(`Posted as bot. ts=${result.ts} channel=${result.channel}`);
}

const [, , cmd, ...rest] = process.argv;

try {
  switch (cmd) {
    case 'auth-test':
      await cmdAuthTest();
      break;
    case 'post':
      await cmdPost(rest[0], rest.slice(1).join(' '));
      break;
    default:
      console.log('Usage: node src/post.mjs <auth-test|post> [channel_id] ["message"]');
      process.exit(1);
  }
} catch (err) {
  console.error('Error:', err.message ?? err);
  process.exit(1);
}
