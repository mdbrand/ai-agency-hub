#!/usr/bin/env node
// v0 queue utility: lets a live Claude Code session read/write Mission OS's
// agent_messages queue over its HTTP bridge (a TanStack server route backed
// by Supabase). Claude Code is the "worker" — this script is just its hands
// into that bridge. No direct database access; the bridge holds the
// powerful credentials, this script only ever holds the narrow BRIDGE_TOKEN.
import dotenv from 'dotenv';

dotenv.config({ path: new URL('../.env', import.meta.url).pathname });

const { BRIDGE_URL, BRIDGE_TOKEN } = process.env;
if (!BRIDGE_URL || !BRIDGE_TOKEN) {
  console.error('Missing BRIDGE_URL or BRIDGE_TOKEN. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

async function callBridge(action, body = {}) {
  const res = await fetch(BRIDGE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${BRIDGE_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, ...body }),
  });

  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error(`Bridge returned non-JSON response (status ${res.status})`);
  }

  if (!res.ok) {
    throw new Error(`Bridge error (${res.status}): ${json.error ?? JSON.stringify(json)}`);
  }
  return json;
}

function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
      flags[key] = value;
    }
  }
  return flags;
}

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function cmdList(flags) {
  const limit = flags.limit ? Number(flags.limit) : undefined;
  const { messages } = await callBridge('list_pending', limit ? { limit } : {});

  if (!messages.length) {
    console.log('No pending messages.');
    return;
  }
  for (const m of messages) {
    const employee = m.ai_employees?.slug ?? 'unknown';
    const client = m.clients?.company_name ?? '(no client / internal)';
    const preview = m.content.length > 80 ? m.content.slice(0, 77) + '...' : m.content;
    console.log(`${m.id}  [${employee}]  ${client}\n  "${preview}"\n  created ${m.created_at}\n`);
  }
}

async function cmdClaim(id) {
  const { claimed } = await callBridge('claim', { message_id: id });
  if (!claimed) {
    console.error(`Row ${id} was not pending (already claimed, done, or doesn't exist).`);
    process.exit(1);
  }
  // Note: claimed only includes raw ai_employee_id/client_id, not the joined
  // slug/company_name — cross-reference with the last `list` output for those.
  console.log(JSON.stringify(claimed, null, 2));
}

async function cmdReply(id, flags) {
  const content = typeof flags.content === 'string' ? flags.content : await readStdin();
  if (!content) {
    console.error('No reply content provided. Use --content "..." or pipe text via stdin.');
    process.exit(1);
  }
  let metadata = {};
  if (typeof flags.metadata === 'string') {
    try {
      metadata = JSON.parse(flags.metadata);
    } catch {
      console.error('--metadata must be valid JSON.');
      process.exit(1);
    }
  }
  const { reply_id } = await callBridge('reply', { message_id: id, content, metadata });
  console.log(`Reply ${reply_id} written; original message ${id} marked done.`);
}

async function cmdFail(id, flags) {
  const detail = typeof flags.detail === 'string' ? flags.detail : await readStdin();
  const { ok } = await callBridge('fail', { message_id: id, error: detail || 'unspecified error' });
  console.log(ok ? `Message ${id} marked error.` : `Unexpected response marking ${id} as error.`);
}

async function cmdCheckSession() {
  const { active } = await callBridge('check_session');
  console.log(active ? 'active' : 'inactive');
  process.exit(active ? 0 : 1);
}

async function cmdCreateTask(flags) {
  const title = flags.title;
  if (!title) {
    console.error('Usage: queue create-task --title "..." --assignee-type ai_employee|human [--ai-employee <slug>] [--assignee-name "..."] [--client "..."] [--project "..."] [--due YYYY-MM-DD] [--description "..."]');
    process.exit(1);
  }
  const assigneeType = flags['assignee-type'];
  if (assigneeType !== 'ai_employee' && assigneeType !== 'human') {
    console.error('--assignee-type must be "ai_employee" or "human"');
    process.exit(1);
  }
  if (assigneeType === 'ai_employee' && !flags['ai-employee']) {
    console.error('--ai-employee <slug> is required when --assignee-type is ai_employee');
    process.exit(1);
  }
  if (assigneeType === 'human' && !flags['assignee-name']) {
    console.error('--assignee-name "..." is required when --assignee-type is human');
    process.exit(1);
  }

  const body = {
    title,
    assignee_type: assigneeType,
  };
  if (flags.description) body.description = flags.description;
  if (flags['ai-employee']) body.ai_employee_slug = flags['ai-employee'];
  if (flags['assignee-name']) body.assignee_name = flags['assignee-name'];
  if (flags.client) body.client_name = flags.client;
  if (flags.project) body.project_name = flags.project;
  if (flags.due) body.due_date = flags.due;

  const { task_id, resolved_client_id, resolved_project_id } = await callBridge('create_task', body);
  console.log(`Task ${task_id} created.`);
  if (resolved_client_id) console.log(`  client: ${resolved_client_id}`);
  if (resolved_project_id) console.log(`  project: ${resolved_project_id}`);
}

async function cmdCreateLead(flags) {
  if (!flags.name) {
    console.error('Usage: queue create-lead --name "..." [--email ...] [--phone ...] [--company "..."] [--campaign "..."] [--stage "..."] [--value N] [--notes "..."]');
    process.exit(1);
  }
  const body = { name: flags.name };
  for (const key of ['email', 'phone', 'company', 'campaign', 'stage', 'notes']) {
    if (typeof flags[key] === 'string') body[key] = flags[key];
  }
  if (flags.value) body.value = Number(flags.value);
  const { lead_id } = await callBridge('create_lead', body);
  console.log(`Lead ${lead_id} created in the Pipeline Tracker.`);
}

const [, , cmd, ...rest] = process.argv;
const flags = parseFlags(rest);
const id = rest.find((a) => !a.startsWith('--'));

try {
  switch (cmd) {
    case 'list':
      await cmdList(flags);
      break;
    case 'claim':
      if (!id) throw new Error('Usage: queue claim <id>');
      await cmdClaim(id);
      break;
    case 'reply':
      if (!id) throw new Error('Usage: queue reply <id> --content "..." [--metadata \'{"...json"}\'] (or pipe stdin)');
      await cmdReply(id, flags);
      break;
    case 'fail':
    case 'error': // alias, matches the old local-name for this action
      if (!id) throw new Error('Usage: queue fail <id> --detail "..." (or pipe stdin)');
      await cmdFail(id, flags);
      break;
    case 'check-session':
      await cmdCheckSession();
      break;
    case 'create-task':
      await cmdCreateTask(flags);
      break;
    case 'create-lead':
      await cmdCreateLead(flags);
      break;
    default:
      console.log('Usage: node src/queue.mjs <list|claim|reply|fail|check-session|create-task|create-lead> [id] [--content|--detail "..."] [--metadata \'{...}\']');
      process.exit(1);
  }
} catch (err) {
  console.error('Error:', err.message ?? err);
  process.exit(1);
}
