# DryRun — Solution write-up

**Track:** Agents That Act · **Problem statement:** Migration Rehearsal Agent · **Title:** The Flight Simulator for Database Migrations

## Problem
Schema migrations fail in production in expensive ways: a constraint that existing rows already violate aborts the
deploy halfway, a type change silently rounds money (₹4,500.50 → ₹4,500), dropped keys orphan related rows, and an
exclusive lock freezes the app. Teams rarely rehearse against real data because it is slow and manual.

## What the agent reaches
The team's own **PostgreSQL** database — demoed on a hostel management system (students, rooms, allocations,
fees, complaints). Production is read with `pg_dump`; all writes happen in a throwaway clone. Reports go to the web
app, a downloadable Markdown report, and optionally a GitHub PR comment and Slack.

## Where it stops
The agent never changes production on its own. `apply_to_production` and `restore_production_backup` are
**approval-gated TrueForge tools**: the turn pauses until an approver — not the requester — types the database name
in DryRun. DryRun re-checks server-side (role, two-person rule, passing verdict, risk ≤ policy, unchanged SQL
fingerprint), takes a backup, applies with lock timeouts, verifies production matches the rehearsal, and keeps a
24-hour restore. AI-proposed fixes are only ever rehearsed, never applied.

## Architecture
Next.js UI → FastAPI (REST/SSE) → **TrueForge** agent harness → LLM. DryRun's engine is a remote **MCP server**
(10 tools). Engine: clone → snapshot → apply with `pg_locks` monitoring and automatic failure evidence → row-level
diff, FK integrity, schema diff → agent-written read-only checks → rollback proof by full-row checksums → risk score
and policies. Every action is written to a SHA-256 hash-chained audit log.

## How TrueForge is used
Agent spec, sessions and streamed turns via the TrueForge API; tools via its MCP connector (header auth);
**Tool Approval** (`require_approval_for_tools`) for the human-in-the-loop gate, resumed with `user.tool_approval`;
any model provider through TrueForge settings. Each rehearsal links to its TrueForge session.

## Real vs. mocked
**Real:** sandbox clones, migrations, lock timing, evidence, diffs, rollback proof, TrueForge agent and approvals,
production backup/apply/verify/restore, audit chain. **Simplified:** demo role switcher instead of real login;
sandbox is a separate database on the same server, not a separate VM; sandbox CPU sparkline is decorative.

## Known limits
PostgreSQL only; whole-database `pg_dump` clones (slow for very large databases); lock times measured on sandbox data
volume; TrueForge turns are capped at 10 minutes (DryRun finishes deterministic steps if the agent stops early).
