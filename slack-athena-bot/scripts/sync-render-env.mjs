#!/usr/bin/env node
// Syncs the known-good local .env values to the Render worker service and
// verifies the deploy, using Render's REST API. Secret values flow directly
// from the local files to Render over HTTPS — they are never printed.
// Output is restricted to key names, lengths, prefixes, and status lines.
//
// Requires a Render API key at <repo root>/.render-api-key (gitignored).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const SERVICE_ID = 'srv-d96rrve8bjmc73alu110'; // athena-slack-daemon worker

const RENDER_API_KEY = readFileSync(path.join(REPO_ROOT, '.render-api-key'), 'utf8').trim();
if (!RENDER_API_KEY) {
  console.error('Empty .render-api-key file.');
  process.exit(1);
}

function parseEnvFile(p) {
  const out = {};
  const raw = readFileSync(p, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

const botEnv = parseEnvFile(path.join(REPO_ROOT, 'slack-athena-bot', '.env'));
const bridgeEnv = parseEnvFile(path.join(REPO_ROOT, 'mission-os-bridge', '.env'));

const desired = {
  NODE_VERSION: '20',
  SLACK_BOT_TOKEN: botEnv.SLACK_BOT_TOKEN,
  SLACK_APP_TOKEN: botEnv.SLACK_APP_TOKEN,
  ANTHROPIC_API_KEY: botEnv.ANTHROPIC_API_KEY,
  BRIDGE_URL: bridgeEnv.BRIDGE_URL,
  BRIDGE_TOKEN: bridgeEnv.BRIDGE_TOKEN,
};

for (const [k, v] of Object.entries(desired)) {
  if (!v) {
    console.error(`Missing ${k} in local env files — aborting before touching Render.`);
    process.exit(1);
  }
}

console.log('Local values to sync (lengths/prefixes only):');
for (const [k, v] of Object.entries(desired)) {
  console.log(`  ${k}: length=${v.length} prefix=${v.slice(0, 5)}`);
}

async function api(method, urlPath, body) {
  const res = await fetch(`https://api.render.com/v1${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${RENDER_API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) {
    const msg = typeof json === 'string' ? json : JSON.stringify(json);
    throw new Error(`Render API ${method} ${urlPath} -> HTTP ${res.status}: ${msg.slice(0, 300)}`);
  }
  return json;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. Replace the service's env vars with the local truth.
await api('PUT', `/services/${SERVICE_ID}/env-vars`,
  Object.entries(desired).map(([key, value]) => ({ key, value })));
console.log('Env vars updated on Render.');

// 2. Trigger a fresh deploy.
const deploy = await api('POST', `/services/${SERVICE_ID}/deploys`, {});
const deployId = deploy.id;
console.log(`Deploy triggered: ${deployId}`);

// 3. Poll until the deploy is live (or fails).
let status = deploy.status;
for (let i = 0; i < 60 && !['live', 'build_failed', 'update_failed', 'canceled', 'deactivated'].includes(status); i++) {
  await sleep(5000);
  const d = await api('GET', `/services/${SERVICE_ID}/deploys/${deployId}`);
  status = d.status;
  process.stdout.write(`  deploy status: ${status}\n`);
}
if (status !== 'live') {
  console.error(`Deploy did not go live (final status: ${status}).`);
  process.exit(1);
}

// 4. Give the process a few seconds to start, then pull recent logs.
await sleep(15000);
const service = await api('GET', `/services/${SERVICE_ID}`);
const ownerId = service.ownerId ?? service.service?.ownerId;
try {
  const params = new URLSearchParams({ ownerId, limit: '100', direction: 'backward' });
  params.append('resource', SERVICE_ID);
  const logsResp = await api('GET', `/logs?${params}`);
  const entries = logsResp.logs ?? logsResp;
  const interesting = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const m = entry.message ?? entry.text ?? '';
    if (/startup diag|connected via Socket Mode|invalid_auth|Error:/i.test(m)) {
      interesting.push(`  [${entry.timestamp ?? ''}] ${m}`);
    }
  }
  if (interesting.length) {
    console.log('Relevant log lines (newest first):');
    for (const line of interesting.slice(0, 15)) console.log(line);
  } else {
    console.log('No matching log lines returned yet — check the dashboard Logs tab once.');
  }
} catch (err) {
  console.log(`Could not fetch logs via API (${err.message.slice(0, 120)}) — check the dashboard Logs tab once.`);
}
