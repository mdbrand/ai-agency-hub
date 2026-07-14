#!/usr/bin/env node
// Standalone, always-on Athena daemon. Unlike the Claude Code
// ScheduleWakeup/CronCreate polling approach (rejected — re-reading a huge
// conversation transcript on every wake-up costs real money even while
// idle), this process holds a live push connection to Slack (Socket Mode)
// and only calls the Anthropic API when a real message actually arrives.
// Idle cost is ~$0: nothing calls any model until someone talks to Athena.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import pkg from '@slack/bolt';
const { App } = pkg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Loads this project's own .env, then fills in any keys still missing from
// the sibling mission-os-bridge/.env (BRIDGE_URL/BRIDGE_TOKEN) — so Rob
// doesn't have to paste the bridge token a second time in a second place.
function loadEnvFile(envPath) {
  if (!existsSync(envPath)) return;
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
loadEnvFile(path.join(__dirname, '..', '.env'));
loadEnvFile(path.join(__dirname, '..', '..', 'mission-os-bridge', '.env'));

const { SLACK_BOT_TOKEN, SLACK_APP_TOKEN, ANTHROPIC_API_KEY, BRIDGE_URL, BRIDGE_TOKEN } = process.env;
for (const [name, val] of Object.entries({ SLACK_BOT_TOKEN, SLACK_APP_TOKEN, ANTHROPIC_API_KEY, BRIDGE_URL, BRIDGE_TOKEN })) {
  if (!val) {
    console.error(`Missing ${name}. Check slack-athena-bot/.env and mission-os-bridge/.env.`);
    process.exit(1);
  }
}
console.log(`[startup diag] SLACK_APP_TOKEN length=${SLACK_APP_TOKEN.length} prefix=${SLACK_APP_TOKEN.slice(0, 6)} SLACK_BOT_TOKEN length=${SLACK_BOT_TOKEN.length} prefix=${SLACK_BOT_TOKEN.slice(0, 6)}`);

const TARGET_CHANNEL = 'C0BFA6D9WMS'; // #chief-of-staff
const MODEL = 'claude-sonnet-5';
const HISTORY_IDLE_RESET_MS = 30 * 60 * 1000; // fresh context after 30min silence
const MAX_HISTORY_MESSAGES = 20;

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

async function callBridge(action, body = {}) {
  const res = await fetch(BRIDGE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${BRIDGE_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...body }),
  });
  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error(`Bridge returned non-JSON response (status ${res.status})`);
  }
  if (!res.ok) throw new Error(`Bridge error (${res.status}): ${json.error ?? JSON.stringify(json)}`);
  return json;
}

const TOOLS = [
  {
    name: 'create_task',
    description: 'Create a task in Mission OS, optionally assigned to an AI employee (auto-queues them to act on it) or a human. Most tasks are just for a client with no project — that is the default and normal case, not an edge case.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        assignee_type: { type: 'string', enum: ['ai_employee', 'human'] },
        ai_employee_slug: { type: 'string', description: 'Required if assignee_type is ai_employee, e.g. "cassia", "mira", "ellis"' },
        assignee_name: { type: 'string', description: 'Required if assignee_type is human' },
        client_name: { type: 'string', description: 'The client this task is for, fuzzy-matched against existing clients. If Rob says a task is "for <client>" or "for <client>\'s <thing>", that client name goes here.' },
        project_name: { type: 'string', description: 'ONLY set this if Rob names an actual project distinct from the client itself (e.g. a specific campaign or initiative name). Do NOT put the client\'s own name here — a task "for Cooley Brothers Painting" with no separate project mentioned means client_name="Cooley Brothers Painting" and project_name left unset entirely. Leaving this unset is the normal case, not a fallback.' },
        due_date: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['title', 'assignee_type'],
    },
  },
  {
    name: 'list_pending',
    description: 'List pending items in the Mission OS agent_messages queue.',
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'number' } },
    },
  },
  {
    name: 'create_lead',
    description: 'Add a lead/deal to the Mission OS Pipeline Tracker (the same as the "Add a Deal" button). Use this for new prospects — business cards, referrals, people Rob met — NOT for internal work items (those are tasks).',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Contact or business name (required)' },
        email: { type: 'string' },
        phone: { type: 'string', description: 'Phone number if known — Rob uses this for click-to-call' },
        company: { type: 'string' },
        campaign: { type: 'string', description: 'How the lead came in, e.g. "Networking", "Postcard"' },
        stage: { type: 'string', description: 'Pipeline stage — omit for a brand-new lead (defaults to New Lead)' },
        value: { type: 'number', description: 'Deal value in dollars, if known' },
        notes: { type: 'string' },
      },
      required: ['name'],
    },
  },
  {
    name: 'get_calendar_availability',
    description: "Check Rob's Google Calendar and return busy blocks for a date range, so you can tell him which requested times are free. Use when he asks what's open or to compare offered meeting slots against his schedule.",
    input_schema: {
      type: 'object',
      properties: {
        start: { type: 'string', description: 'ISO 8601 start, e.g. 2026-07-16T00:00:00-07:00' },
        end: { type: 'string', description: 'ISO 8601 end' },
      },
      required: ['start', 'end'],
    },
  },
  {
    name: 'list_email_accounts',
    description: "List every email inbox connected in Mission OS, with the client each is tied to. Call this first when Rob refers to a client's inbox by name (e.g. \"the Cooley inbox\") so you know which email address to search.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'search_emails',
    description: "Search connected email inboxes and return matching messages (from, subject, date, snippet). Use for 'did I hear back from X', 'any new email about Y', 'what's in the Cooley inbox'. Returns snippets only — call get_email for the full body of a specific message.",
    input_schema: {
      type: 'object',
      properties: {
        account_email: { type: 'string', description: "Which inbox to search (from list_email_accounts). Omit to search ALL connected inboxes." },
        query: { type: 'string', description: "Gmail-style search, e.g. 'from:larry subject:estimate'. Omit for most recent." },
        newer_than: { type: 'string', description: "Time window, e.g. '7d' or '24h'." },
        limit: { type: 'number', description: 'Max messages (default 10).' },
      },
    },
  },
  {
    name: 'get_email',
    description: "Fetch the full plain-text body of one email by its id (from search_emails). Use when Rob wants the details of a specific message, not just the snippet.",
    input_schema: {
      type: 'object',
      properties: {
        account_email: { type: 'string', description: 'The inbox the message is in.' },
        message_id: { type: 'string', description: 'The id from search_emails.' },
      },
      required: ['account_email', 'message_id'],
    },
  },
  {
    name: 'mark_emails_read',
    description: "Mark specific emails as read (clears their unread flag) in a connected inbox. Use to clear out notifications/automated mail after triaging — e.g. Rob says 'mark the notifications as read'. Pass the message ids from a prior search_emails call. This is the ONLY email change you can make: it cannot delete, archive, move, or send anything. If it returns needs_reconnect, tell Rob that inbox must be reconnected in Mission OS to grant mark-as-read permission.",
    input_schema: {
      type: 'object',
      properties: {
        account_email: { type: 'string', description: 'The inbox the messages are in.' },
        message_ids: { type: 'array', items: { type: 'string' }, description: 'Message ids from search_emails to mark read.' },
      },
      required: ['account_email', 'message_ids'],
    },
  },
];

async function executeTool(name, input) {
  try {
    if (name === 'create_task') {
      const result = await callBridge('create_task', input);
      return { content: JSON.stringify(result) };
    }
    if (name === 'list_pending') {
      const result = await callBridge('list_pending', input.limit ? { limit: input.limit } : {});
      return { content: JSON.stringify(result) };
    }
    if (name === 'create_lead') {
      const result = await callBridge('create_lead', input);
      return { content: JSON.stringify(result) };
    }
    if (name === 'get_calendar_availability') {
      // The bridge has several Google accounts connected (Rob's own + per-client
      // inboxes) and requires disambiguation. Availability is always Rob's own
      // calendar, so pin it here rather than letting the model guess.
      const result = await callBridge('get_calendar_availability', { account_email: 'missiondrivenbrand@gmail.com', ...input });
      return { content: JSON.stringify(result) };
    }
    if (name === 'list_email_accounts') {
      const result = await callBridge('list_email_accounts', {});
      return { content: JSON.stringify(result) };
    }
    if (name === 'search_emails') {
      const result = await callBridge('search_emails', input);
      return { content: JSON.stringify(result) };
    }
    if (name === 'get_email') {
      const result = await callBridge('get_email', input);
      return { content: JSON.stringify(result) };
    }
    if (name === 'mark_emails_read') {
      const result = await callBridge('mark_read', input);
      return { content: JSON.stringify(result) };
    }
    return { content: `Unknown tool: ${name}`, isError: true };
  } catch (err) {
    return { content: `Error: ${err.message ?? err}`, isError: true };
  }
}

const SYSTEM_PROMPT_BASE = `You are Athena, Rob's chief-of-staff assistant for Mission Driven Brand, talking with him directly in Slack. Be concise — this is chat, not a doc. Via tools you can: create tasks in Mission OS, add leads/deals to the Pipeline Tracker, check the pending work queue, check Rob's Google Calendar availability, read his connected email inboxes, and mark emails as read. Only use tools when Rob is actually asking you to do one of those things; otherwise just reply conversationally. Never fabricate task/lead IDs, queue contents, calendar data, or email contents — only report what a tool call actually returns.

Choosing the right tool: new prospects and contacts (business cards, referrals, people Rob met) go into the Pipeline as leads via create_lead. Internal work items and to-dos go into Tasks via create_task. If Rob shares several business cards at once, create one lead per card.

Email: Rob has several inboxes connected, one per client plus his own. When he names a client's inbox ("the Cooley inbox", "did Publicity for Good hear back"), call list_email_accounts first to map the client name to the right email address, then search_emails. search_emails returns snippets; call get_email for the full body of a specific message. Email access is read-only — you cannot send or draft; if Rob asks you to send/reply, say you can read but not send yet.
For triage-style questions ("how many are notifications vs real people", "what needs my attention", "summarize my inbox"), do it EFFICIENTLY: pull a batch with search_emails using a higher limit (e.g. 25-50) and judge each message from its sender and snippet alone — notifications/automated mail are obvious from the sender (no-reply@, notifications@, automated services, receipts, alerts) vs. a real person writing to Rob. Do NOT open every message with get_email; only use get_email for the few that actually matter or when Rob asks for a specific message's details. Then give counts plus a short list of the real ones worth his attention.
You can also mark emails as read via mark_emails_read (clears the unread flag only — no delete/archive/send). Typical flow: Rob asks to "clear out the notifications" → you already have the notification message ids from your search → call mark_emails_read with those ids. Only mark mail you're confident is automated/notification; never mark a real person's email read without Rob saying so. If mark_emails_read returns needs_reconnect/missing_scope, tell Rob plainly that the inbox needs to be reconnected in Mission OS to grant mark-as-read permission.

Formatting rules, important:
- You are writing in Slack, which does NOT use Markdown. Never use Markdown syntax: no ** for bold, no ## headings, no [label](url) links. If you must emphasize, Slack bold is a SINGLE asterisk (*like this*). Prefer clean plain text with simple labels (e.g. "From: ...", "Subject: ...") over any markup. Keep it tidy and readable.
- Write plain, natural chat replies. Never prefix your reply with a Slack user ID, mention token, or any bracketed/angle-bracketed ID like "[U12345]" or "<@U12345>" — just answer directly, no ID tags of any kind.
- You only have exactly eight tools: create_task, create_lead, list_pending, get_calendar_availability, list_email_accounts, search_emails, get_email, and mark_emails_read. Never simulate, role-play, or fake-format a call to a terminal, shell, or any other tool you don't have — if you don't have a real way to answer something (e.g. you don't have a live clock), just say so plainly instead of inventing fake command output.
- When Rob attaches photos (business cards, screenshots, documents), they are included in the message — read them directly and transcribe exactly what you see. Never invent details that aren't legible; say when something is unreadable.`;

function stripSlackMentions(text) {
  return text.replace(/<@[A-Z0-9]+>/g, '').trim();
}

// Slack uses its own "mrkdwn", not standard Markdown — **bold**, ## headings,
// and [label](url) links all render as literal junk. Convert the model's
// Markdown output to Slack-native formatting before posting, as a safety net
// on top of the system-prompt instruction.
function toSlackMrkdwn(text) {
  if (!text) return text;
  let t = text;
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<$2|$1>'); // [label](url) -> <url|label>
  t = t.replace(/\*\*(.+?)\*\*/gs, '*$1*'); // **bold** -> *bold*
  t = t.replace(/__(.+?)__/gs, '*$1*'); // __bold__ -> *bold*
  t = t.replace(/^#{1,6}\s+(.*)$/gm, '*$1*'); // # Heading -> *Heading*
  t = t.replace(/^(\s*)[-*]\s+/gm, '$1• '); // - bullet / * bullet -> • bullet
  return t;
}

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 4.5 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

// Downloads image attachments from Slack (requires the files:read bot scope)
// and converts them to Anthropic image blocks. Prefers Slack's 1024px JPEG
// thumbnail — smaller payloads, and it sidesteps unsupported formats like
// HEIC from iPhone photos.
async function fetchSlackImages(files) {
  const blocks = [];
  for (const f of files ?? []) {
    if (blocks.length >= MAX_IMAGES) break;
    if (!f.mimetype?.startsWith('image/')) continue;
    const url = f.thumb_1024 ?? f.url_private;
    if (!url) continue;
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` } });
      const type = res.headers.get('content-type')?.split(';')[0] ?? f.mimetype;
      if (!res.ok || !type.startsWith('image/')) {
        console.error(`[files] download failed for ${f.name}: HTTP ${res.status} type=${type}`);
        continue;
      }
      if (!SUPPORTED_IMAGE_TYPES.has(type)) {
        console.error(`[files] skipping ${f.name}: unsupported type ${type}`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_IMAGE_BYTES) {
        console.error(`[files] skipping ${f.name}: too large (${buf.length} bytes)`);
        continue;
      }
      blocks.push({ type: 'image', source: { type: 'base64', media_type: type, data: buf.toString('base64') } });
    } catch (err) {
      console.error(`[files] error fetching ${f.name}: ${err.message}`);
    }
  }
  return blocks;
}

const channelState = new Map(); // channel -> { messages: [], lastTs: number }

function getHistory(channel) {
  const now = Date.now();
  const state = channelState.get(channel);
  if (!state || now - state.lastTs > HISTORY_IDLE_RESET_MS) {
    const fresh = { messages: [], lastTs: now };
    channelState.set(channel, fresh);
    return fresh;
  }
  state.lastTs = now;
  return state;
}

async function runAthenaTurn(channel, userContent, messageTs) {
  const state = getHistory(channel);
  state.messages.push({ role: 'user', content: userContent });

  let messages = state.messages;
  let finalText = '';

  const sentAt = messageTs ? new Date(parseFloat(messageTs) * 1000) : new Date();
  const systemPrompt = `${SYSTEM_PROMPT_BASE}\n\nThis message was sent at: ${sentAt.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'long' })}. Use this if Rob asks what time/day it is — don't fabricate a way to look it up.`;

  for (let iterations = 0; iterations < 12; iterations++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      tools: TOOLS,
      messages,
    });

    // Branch on the actual content, not stop_reason: a max_tokens cutoff can
    // still carry complete tool_use blocks, and storing a tool_use without
    // executing it corrupts the history (the API rejects every later turn).
    const toolUses = response.content.filter((b) => b.type === 'tool_use');
    if (toolUses.length === 0) {
      finalText = response.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      messages = [...messages, { role: 'assistant', content: response.content }];
      break;
    }

    messages = [...messages, { role: 'assistant', content: response.content }];
    const toolResults = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      const { content, isError } = await executeTool(block.name, block.input);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content,
        ...(isError ? { is_error: true } : {}),
      });
    }
    messages = [...messages, { role: 'user', content: toolResults }];
  }

  // If the loop ran out of tool-call rounds while still wanting tools, force
  // one final text-only answer (no tools passed) so Rob always gets a real
  // reply built from whatever was gathered — never a bare placeholder.
  if (!finalText) {
    try {
      const finalResp = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: `${systemPrompt}\n\nYou have gathered enough information and must stop calling tools now. Answer Rob directly in plain Slack text using what you already have. If the picture is only partial (e.g. you couldn't scan every email), give your best summary so far and say plainly what was incomplete and why — do not apologize excessively or return nothing.`,
        messages,
      });
      finalText = finalResp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      messages = [...messages, { role: 'assistant', content: finalResp.content }];
      console.log('[loop] forced final text-only answer after hitting tool-round cap');
    } catch (err) {
      console.error('[loop] final no-tools call failed:', err.message ?? err);
    }
  }

  // Keep history text-only: replace image blocks with placeholders so
  // follow-up turns don't re-send megabytes of base64 every 90 seconds.
  // Athena's transcription of the image lives in her reply text anyway.
  state.messages = messages.slice(-MAX_HISTORY_MESSAGES).map((m) => ({
    ...m,
    content: Array.isArray(m.content)
      ? m.content.map((b) => (b.type === 'image' ? { type: 'text', text: '[image was attached here and already analyzed]' } : b))
      : m.content,
  }));
  return finalText || "(no reply generated — check the daemon logs)";
}

const app = new App({
  token: SLACK_BOT_TOKEN,
  appToken: SLACK_APP_TOKEN,
  socketMode: true,
});

app.message(async ({ message, say }) => {
  console.log(`[recv] channel=${message.channel} ts=${message.ts} thread_ts=${message.thread_ts ?? '-'} subtype=${message.subtype ?? '-'} bot_id=${message.bot_id ?? '-'} text=${JSON.stringify(message.text)}`);

  if (message.channel !== TARGET_CHANNEL) {
    console.log('[skip] different channel');
    return;
  }
  if (message.subtype === 'bot_message' || message.bot_id) {
    console.log('[skip] bot message');
    return;
  }
  if (!message.text && !message.files?.length) {
    console.log('[skip] no text or files');
    return;
  }

  try {
    const cleanText = stripSlackMentions(message.text ?? '');
    const threadTs = message.thread_ts || message.ts;
    const imageBlocks = await fetchSlackImages(message.files);
    if (imageBlocks.length) console.log(`[files] attached ${imageBlocks.length} image(s) to the message`);
    const content = imageBlocks.length
      ? [...imageBlocks, { type: 'text', text: cleanText || 'Please analyze the attached image(s).' }]
      : cleanText;
    console.log('[processing] calling Anthropic...');
    const reply = await runAthenaTurn(`${message.channel}:${threadTs}`, content, message.ts);
    console.log(`[reply] ${JSON.stringify(reply)}`);
    await say({ text: toSlackMrkdwn(reply), thread_ts: threadTs });
    console.log('[posted] reply sent to Slack');
  } catch (err) {
    console.error('Error handling message:', err);
    const threadTs = message.thread_ts || message.ts;
    await say({ text: `(Athena hit an error: ${err.message ?? err})`, thread_ts: threadTs });
  }
});

(async () => {
  await app.start();
  console.log('Athena daemon connected via Socket Mode (vision enabled). Listening on #chief-of-staff. Idle cost: $0 — nothing runs until a message arrives.');
})();
