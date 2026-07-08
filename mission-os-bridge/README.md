# Mission OS Bridge (v0)

Connects Mission OS (Lovable) to the Claude Code AI Employees running on this Mac (`~/.claude/agents/`).

Mission OS and Claude Code can't talk to each other directly — Mission OS runs in the cloud, Claude Code runs locally. Lovable built a small HTTP endpoint (a TanStack server route, backed by its Supabase `agent_messages` table) as the bridge between them:

1. A message to an AI Employee gets inserted into `agent_messages` with `role='user'`, `status='pending'` (today: via Mission OS's chat UI once it's wired, or a manual insert by Rob/Lovable for testing).
2. In a Claude Code session, you say something like "check the queue" -> Claude Code calls `queue list`, `queue claim`, dispatches the matching subagent (e.g. Cassia), then `queue reply` posts the answer back through the same bridge.
3. Mission OS displays the reply and updates that employee's task counts.

This is **v0**: no daemon, no automation. Claude Code processes the queue on request, during a live session. v1 (later) would run this same idea as an always-on background process.

**Security note:** this script never touches the database directly and never holds a Supabase service-role key. It only holds `BRIDGE_TOKEN`, a narrow credential scoped to exactly the actions below (list/claim/reply/fail/check_session/create_task) — the powerful database credential stays inside Lovable's server route, never on this Mac.

## Setup

```bash
cd mission-os-bridge
npm install
cp .env.example .env
```

Then open `.env` and paste in the `BRIDGE_TOKEN` value yourself (Lovable: **Cloud -> Secrets -> BRIDGE_TOKEN**). Don't paste that token into chat or commit it anywhere — `.env` is gitignored. `BRIDGE_URL` is already filled in with the stable-production URL (rename-proof, survives project renames).

## Commands

```bash
node src/queue.mjs list [--limit 20]
```
Lists pending user messages (employee slug, client, content preview, timestamp), oldest first.

```bash
node src/queue.mjs claim <id>
```
Atomically flips a row `pending` -> `processing` (returns `null`/exits 1 if another process already claimed it, or it's not pending). Prints the claimed row as JSON — raw `ai_employee_id`/`client_id` only, not the joined slug/company name, so cross-reference with the last `list` output for those.

```bash
node src/queue.mjs reply <id> --content "..." [--metadata '{"tokens": 512}']
```
(or pipe content via stdin) Posts the agent's reply — inserted as a new row, and the original is marked `done`. `--metadata` is optional, for structured extras (token counts, tool traces, etc).

```bash
node src/queue.mjs fail <id> --detail "..."
```
(or pipe stdin; `error` also works as an alias) Marks a message `error` with a reason — used when the subagent can't complete the task (e.g. no dossier exists yet for that client).

```bash
node src/queue.mjs check-session
```
Prints `active` (exit 0) or `inactive` (exit 1) — reflects Mission OS's Chat page "live mode" toggle. `active` requires the toggle to be on AND a heartbeat within the last 15 minutes (staleness handled server-side). Used to drive the self-rescheduling wake loop: while active, keep checking the queue and re-scheduling every ~90s; the moment this goes inactive, stop rescheduling.

```bash
node src/queue.mjs create-task --title "..." --assignee-type ai_employee|human [--ai-employee <slug>] [--assignee-name "..."] [--client "..."] [--project "..."] [--due YYYY-MM-DD] [--description "..."]
```
Creates a real task in Mission OS — reuses the exact same `createTaskCore` code path as the app's own "New Task" UI, so assigning to an AI employee auto-queues an `agent_messages` row exactly as it would from the UI. `--client`/`--project` are fuzzy-matched against `clients.company_name`/`projects.title`; the bridge errors (rather than silently creating an orphaned task) if either doesn't resolve. Prints the resolved client/project ids on success. Used whenever Rob asks (in Slack, Chat, or a live session) to create a task — no more just handing him the fields to enter manually.

## The role of Claude Code in this loop

This script has no intelligence — it only calls the bridge. The actual work (loading a client's dossier from Drive, writing in their voice, etc.) happens when Claude Code's main session dispatches to the matching subagent (via the Agent tool) after `claim` and before `reply`.

## Creating test messages

There's no generic `insert` action for `agent_messages` in the bridge's contract on purpose — it's worker-facing only (list/claim/reply/fail). New pending messages come from Mission OS's own chat UI, from `create-task` (above, when a task is assigned to an AI employee), or, for testing, by asking Lovable to insert one directly.
