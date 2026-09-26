# DryRun: demo guide

DryRun is a flight simulator for database migrations. An AI agent on TrueForge practises every database change on a
copy of production, and a human must approve before anything real changes.

- 2-page documentation: [DryRun-Documentation.pdf](../DryRun-Documentation.pdf)
- Write-up: [SOLUTION.md](../SOLUTION.md)

## What DryRun is

**The problem:**
- A migration is a change to a database's structure, such as "every student must have a guardian phone".
- If existing data clashes with that rule, the change can fail halfway, silently cut or round data, or freeze the app.
- Most teams run migrations on production and hope.

**The analogy:** pilots practise risky moves in a flight simulator, where a crash hurts no one. DryRun's simulator is
the sandbox:
- a throwaway copy of the hostel database (49 tables, 125,828 rows, 1,438 students)
- deleted after about 45 minutes

**Pitch line:** "DryRun rehearses every migration on a copy of production, shows exactly which rows would break, and
never touches the real database until a second person approves."

## How to start

If the app is already running, open http://localhost:3000. Otherwise, run the one-click start file and wait about 40
seconds:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start-demo.ps1
```

It starts the demo database and opens 3 windows. Keep them open during the demo.

| Part | Address | What it is |
| --- | --- | --- |
| DryRun website | http://localhost:3000 | The only page you show and click |
| DryRun backend | http://localhost:8001 | Engine + the 12 MCP tools |
| TrueForge | http://localhost:8790 | Runs the AI agent (model key saved in its settings) |
| Demo database | port 5499 | Hostel OS data + sandbox copies |

Before you begin, check that the avatar (top right) shows **Arjun Mehta (Engineer)**.

## Demo script (about 6 minutes)

Start the live rehearsal early, because it takes about 2 minutes. Show the finished examples while it runs.

| # | Click | Say |
| --- | --- | --- |
| 1 | Overview page | "Changing a database's structure is risky. DryRun is a flight simulator for migrations: an AI agent on TrueForge practises every change on a copy first." |
| 2 | Rehearsals → New rehearsal → hostel-os-prod → paste the SQL below → Start rehearsal | "It copies 125,000 rows into a sandbox, runs the change there and compares everything." |
| 3 | A blocked report (unique student phone) | "Blocked, risk 100. 12 students share a parent's phone, and they have payments and allocations." |
| 4 | Inspect rows | "The exact students, with private data masked." |
| 5 | AI fix | "The AI wrote a safer fix: deletes nothing, keeps a backup table, and has an exact undo." |
| 6 | TrueForge agent page | "The agent runs on TrueForge, with OpenAI as its brain and our 12 tools." |
| 7 | Open in TrueForge ↗ → Agent steps | "Every step it took: tool calls, parallel sub-agents, and its verdict card." |
| 8 | The live run's report | "Our live run is blocked too: 8 new students have no guardian phone." |
| 9 | A safe report → Request production approval → Send | "The AI tries to apply it, and TrueForge pauses it." |
| 10 | Avatar → Meera Iyer → type the database name → Approve & execute | "A different person must approve. Backup, apply, verify." |
| 11 | Audit Log | "Every action is recorded, and the history cannot be secretly edited." |

```sql
ALTER TABLE "Student" ALTER COLUMN "guardianPhone" SET NOT NULL;
```

**Closing line:** "DryRun: rehearse every migration, before production does it for you."

## TrueForge walkthrough

**Agent page:** http://localhost:8790 → Agents → `dryrun-rehearsal-agent`

| Show | Where on screen | Say |
| --- | --- | --- |
| Instructions | Left, big text box | "The agent's rulebook: copy, migrate, compare, check, undo, report, never touch production." |
| Model gpt-5-5 | Right panel → Model Configuration | "The brain is OpenAI gpt-5.5, connected through TrueForge." |
| 12 tools | Right panel → MCP Servers & Tools → "dryrun · 12 tools" | "DryRun's engine, served to the agent as MCP tools." |
| 2 tools need approval | Same row, ✋2 badge; click to see read / write / destructive | "Only apply_to_production and restore can touch production, and both pause for a human." |
| Sub-agents, Generative UI, Ask user questions | Right panel → Capabilities | "It spawns helpers, draws verdict cards, and asks a human when unsure." |
| Schedule | Tab "Schedules" | "A nightly drift check re-tests approved changes on fresh data." |

**Session page:** in DryRun, open a report and click "◇ Open in TrueForge ↗". Then:
1. Expand **Agent steps** to see the tool calls.
2. Point out the lines starting **Sub-agent:**.
3. Scroll to the **verdict card** at the bottom.

**Connectors:** Settings → Connectors → `dryrun`. This is our own MCP server, the only connector the agent uses.

## MCP tools

MCP (Model Context Protocol) is a standard plug for AI tools. The agent can act only through DryRun's 12 MCP tools,
defined in `api/dryrun/mcp_tools.py`.

| # | Tool | What it does | Safety |
| --- | --- | --- | --- |
| 1 | get_rehearsal_brief | Reads the change and the relevant schema | read |
| 2 | create_sandbox | Copies production into the sandbox and snapshots every table | copy only |
| 3 | apply_migration_in_sandbox | Runs the change on the copy, measures locks, collects evidence on failure | copy only |
| 4 | compare_before_after | Row counts, values, NULLs, broken links, schema diff | read |
| 5 | run_sandbox_check | Runs a check the AI wrote (single read-only SELECT) | read |
| 6 | test_rollback | Runs the undo and proves the data is identical | copy only |
| 7 | submit_report | Risk score and plain-English verdict | read |
| 8 | propose_fix | Saves the AI's safer migration for a human to review | read |
| 9 | list_pending_approvals | Lists approved changes not yet applied (nightly check) | read |
| 10 | rerun_rehearsal | Re-tests a change on today's data (nightly check) | copy only |
| 11 | apply_to_production | Backs up, applies, verifies on the real database | destructive, human approval |
| 12 | restore_production_backup | Restores the real database from backup | destructive, human approval |

## How the agent connects to the website

The website never talks to the agent directly. Everything goes through DryRun's backend:

1. **Website → backend (REST):** `POST /api/rehearsals` starts a rehearsal.
2. **Backend → TrueForge (HTTP API):** the backend opens a session and sends a turn: "rehearse migration X".
3. **TrueForge → backend (MCP):** the agent calls DryRun's tools at `/mcp/`, protected by a secret header.
4. **Backend → website (SSE):** every step, log line and check is streamed live to the browser.
5. **Human → agent:** questions and approvals go from the website to the backend, which resumes the paused TrueForge
   turn.

## Judge Q&A

| Question | Answer |
| --- | --- |
| What is real? | Everything shown: real Postgres copies, real migrations, the real TrueForge agent with OpenAI, real approvals and backups. Only the login is a demo role switcher. |
| Can the AI break production? | No. Its SQL must be a single read-only SELECT and runs only in the sandbox. Production writes need TrueForge approval plus a second person. |
| How is the agent built? | It's a TrueForge agent: OpenAI as the brain, our procedure as instructions, and DryRun's engine as 12 MCP tools, with tool approval on the 2 production tools. |
| Why not just run tests? | Tests use fake data. DryRun uses a real copy of production, so it finds the real problem rows. |
| What if the agent stops midway? | DryRun finishes the remaining steps itself and always proves the rollback, so there is always a verdict. |
| How is access controlled? | DryRun checks roles and the two-person rule on the server, and TrueForge gates the production tools. Real SSO would use TrueForge's OIDC in hosted mode. |
| Limits? | PostgreSQL only. Very large databases take longer to copy. Lock times are measured on the copy. |

## Troubleshooting

| Problem | Do this |
| --- | --- |
| Live run is slow | Show the finished examples instead |
| Purple "Agent needs your input" box | Click an answer and say "the AI asks a human when unsure" |
| Page is blank | Press F5 |
| Nothing loads | Run `scripts\start-demo.ps1` again and wait 40 seconds |
| Safe example already approved | Rehearse a new, safe `ADD COLUMN` migration to get a fresh one |
| TrueForge says "outbound URL blocked" | TrueForge was started without the allow-list; restart it with the start script |
