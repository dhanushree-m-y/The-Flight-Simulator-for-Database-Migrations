# DryRun — the flight simulator for database migrations

> **Agents That Act · Migration Rehearsal Agent.** An AI agent running on **TrueFoundry TrueForge** that
> restores a copy of your production Postgres into a sandbox, runs the schema change, compares every row, proves the
> rollback, reports a risk verdict — and **stops for a human** before anything touches production.

Demo target: a real **hostel management system** (students, rooms, allocations, fees).

---

> 📄 Two-page write-up: [SOLUTION.md](SOLUTION.md)

## The problem

Schema migrations are the scariest deploys a team ships. A single `ALTER TABLE` can fail halfway, silently cut or
round data (`₹4,500.50 → ₹4,500`), orphan related rows, or hold a lock that freezes check-in for every student.
Most teams find out in production.

## What DryRun does, end to end

1. An engineer submits a migration (Monaco editor with live static analysis: lock levels, data-loss patterns).
2. DryRun starts a **TrueForge session** with the `dryrun-rehearsal-agent`. The agent calls DryRun's MCP tools:
   1. `get_rehearsal_brief` – migration, schema, static lock analysis, active policies
   2. `create_sandbox` – `pg_dump` production → `pg_restore` into a throwaway `dryrun_sbx_*` database; snapshot every table
   3. `apply_migration_in_sandbox` – runs the migration while a monitor samples `pg_locks`; on failure DryRun
      automatically collects the exact offending rows (duplicates, NULLs, CHECK violations, truncation, orphans)
   4. `compare_before_after` – row counts, per-column value fingerprints, row-level diffs, NULLs, broken foreign keys, schema diff
   5. `run_sandbox_check` ×N – **the agent writes its own SQL checks** for this specific change; each must be a single
      read-only `SELECT` (parsed with sqlglot) and runs in a `READ ONLY` transaction with a timeout, **only in the sandbox**
   6. `test_rollback` – applies the down migration (the agent writes one if you didn't) and proves every table is
      byte-identical to the snapshot via order-independent full-row checksums
   7. `submit_report` – DryRun scores risk from the evidence (0–100) and evaluates policies; the agent writes the
      plain-English verdict
3. Blocked? **"Suggest a fix with AI"** – the agent investigates in the sandbox and calls `propose_fix`; a human
   reviews the diff and rehearses it as V2 (lineage view shows 88 → 12).
4. Passed? **Request approval.** The agent calls `apply_to_production`, which is **approval-gated in TrueForge**
   (`require_approval_for_tools`) – the turn pauses. An approver (≠ requester) types the database name in DryRun;
   DryRun answers TrueForge's paused call with `user.tool_approval: allow`. DryRun re-checks the approval
   server-side, takes a `pg_dump` backup, applies with `lock_timeout` + advisory lock, re-runs the checks on
   production, and keeps a restore button for 24 h.
5. The report is delivered where the team works: in-app, **Download report** (Markdown), a **GitHub PR comment**
   (`github_pr` on the rehearsal) and **Slack** — each optional via env vars.
6. Every action lands in a **hash-chained audit log** (`sha256(prev_hash + event)`); `/api/audit/verify` detects tampering.

### Where it stops (human in the loop)

| Action | Gate |
|---|---|
| Any write to production (`apply_to_production`) | TrueForge tool approval **and** DryRun approval: approver role, two-person rule, typed confirmation, passing rehearsal, risk ≤ policy ceiling, SQL fingerprint unchanged since rehearsal |
| Restore production from backup (`restore_production_backup`) | TrueForge tool approval + approver role |
| AI-proposed fix | Never applied — shown as a diff; a human chooses to rehearse it |
| AI-written SQL | Read-only, single statement, sandbox only |

---

## Architecture

```
 Next.js web (3000) ──REST/SSE──► DryRun API · FastAPI (8000) ──► TrueForge harness (8790) ──► LLM provider
                                   │    ▲  /mcp/ (MCP, header auth)        │  agent loop, tool approval,
                                   │    └──────────────────────────────────┘  sessions, compaction
                                   ▼
                   PostgreSQL ── hostel (production, read-only except approved apply)
                              ── dryrun_sbx_* (throwaway sandbox clones, TTL-reaped)
                              ── dryrun_meta  (rehearsals, approvals, audit chain)
```

| Path | What |
|---|---|
| `api/dryrun/engine.py` | rehearsal steps: clone, snapshot, apply + lock monitor, evidence probes, compare, rollback proof, scoring |
| `api/dryrun/mcp_tools.py` | the 10 MCP tools the TrueForge agent uses (2 destructive + gated) |
| `api/dryrun/agent.py` | TrueForge integration: registers MCP server + agent spec, streams turns, bridges approvals |
| `api/dryrun/sqlguard.py` | read-only guard for AI-written SQL |
| `api/dryrun/production.py` | approval-gated backup → apply → verify → restore |
| `api/dryrun/audit.py` | tamper-evident audit chain |
| `web/src/app/**` | 20+ screens ported from our Claude Design file (live mission control, report, evidence, approvals…) |

### How TrueForge is used (every harness capability)

| TrueForge capability | How DryRun uses it |
|---|---|
| **Agent runtime · sessions · streamed turns** | `dryrun-rehearsal-agent` (created via `POST /api/v1/agents`); every rehearsal is a session, streamed over SSE |
| **Model (any provider)** | the team's **OpenAI** model (`openai/gpt-5-5`) configured in TrueForge → Settings → Models |
| **Tools via MCP** | DryRun's engine is a remote MCP server with 12 tools (`POST /api/v1/settings/mcp-servers`, header auth) |
| **Tool approval — human in the loop** | `require_approval_for_tools: [apply_to_production, restore_production_backup]`; resumed with `user.tool_approval` after the DryRun approval |
| **Sub-agents** | integrity investigator, hostel-rules investigator and rollback author run in parallel |
| **Ask clarifying questions** | "This removes 38 rows — intended?" shown on DryRun's live page; the answer resumes the turn (`user.tool_response`) |
| **Generative UI** | the agent renders a verdict card inside the TrueForge chat |
| **Sandbox + Code Mode** | Daytona sandbox auto-enabled when configured; the agent aggregates check results in Python there |
| **Context engineering** | compaction at 80k tokens, large tool responses offloaded, deferred tool loading (only the brief is preloaded) |
| **Background execution · schedules** | `dryrun-nightly-drift-check` re-rehearses approved-but-unapplied migrations every night against fresh data |

Every live rehearsal links to its TrueForge session ("Open in TrueForge ↗").

**Other tech from the organisers:** OpenAI (team key, entered only in TrueForge) and **AWS S3** — every production
backup gets an encrypted off-site copy when `AWS_S3_BUCKET` is set (credentials via `aws configure`).

---

## Setup

Prerequisites: Node ≥ 22.14, Python ≥ 3.11, PostgreSQL 15+ with `pg_dump`/`pg_restore`, an LLM API key.

```bash
# 1. TrueForge (allow-lists localhost so it can reach DryRun's MCP server)
powershell -ExecutionPolicy Bypass -File scripts/start-trueforge.ps1
#    macOS/Linux: OUTBOUND_URL_ALLOWED_HOSTS='["localhost","127.0.0.1"]' npx @truefoundry/trueforge@latest
#    Open http://localhost:8790 → Settings → Models → add your provider key.

# 2. API
cp api/.env.example api/.env        # fill in DSNs, model name, MCP key
cd api && python -m venv .venv && .venv/Scripts/pip install -r requirements.txt   # (bin/ on macOS/Linux)
.venv/Scripts/python -m uvicorn dryrun.main:app --port 8000

# 3. Web
cd web && cp .env.example .env.local && npm install && npm run dev   # http://localhost:3000
```

On first boot the API creates `dryrun_meta`, seeds demo users/policies, registers your production connection and
registers the MCP server + agent in TrueForge. Switch demo roles (engineer / approver / viewer / admin) from the
avatar menu. Tests: `cd api && .venv/Scripts/python -m pytest`.

---

## What is real vs. mocked

**Real:** pg_dump/pg_restore sandbox clones; migrations executed in the sandbox; `pg_locks` measurement; failure
evidence probes; row-level diffs and FK checks; rollback proof by checksums; TrueForge agent sessions, MCP tools
and tool-approval pause/resume; AI-written checks and fixes; production backup/apply/verify/restore; hash-chained audit.

**Simplified / mocked:** sign-in is a demo role switcher (header `X-DryRun-User`), not real auth; the sandbox is a
separate database on the same Postgres server rather than a separate VM; the sandbox CPU sparkline is decorative;
GitHub PR comments and Slack messages are implemented but only fire when `GITHUB_TOKEN`/`GITHUB_REPO` or `SLACK_WEBHOOK_URL` are set.

## Known limits

- PostgreSQL only. Sandboxes clone the whole database with `pg_dump` — fine for the hostel DB, slow for very large
  databases (sampling is limited to skipping snapshots above `SNAPSHOT_MAX_ROWS`).
- Lock durations are measured on the sandbox's data volume; production may differ.
- A TrueForge turn is capped at 10 minutes; if the agent stops early, DryRun completes the remaining deterministic
  steps so a verdict always exists (`DRYRUN_AGENT_MODE=direct` runs without an LLM).
- TrueForge blocks localhost MCP URLs unless allow-listed (`OUTBOUND_URL_ALLOWED_HOSTS`).

---

## AI assistants used

- **Claude Code (Anthropic, Claude Opus 5.5)** — architecture, backend and frontend implementation, tests, under our direction and review.
- **Claude Design** — the UI design system and screens ("Pastel Mission Control / Bloom").
- **Claude** — problem framing and system design.

Runtime (not a coding assistant): TrueFoundry **TrueForge** agent harness with the LLM configured in its model settings.

## License

MIT — see [LICENSE](LICENSE).
