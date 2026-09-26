"""DryRun's remote MCP server — the tools the TrueForge agent uses. Every tool is a thin wrapper around
engine.py; the only tools that can touch production are approval-gated in the agent spec
(require_approval_for_tools) AND re-checked server-side in production.assert_releasable()."""

from __future__ import annotations

import asyncio
import traceback
from typing import Any, Callable

from mcp.server.mcpserver import MCPServer
from mcp.types import ToolAnnotations

from . import audit, engine, production, service, store

mcp = MCPServer(
    name="dryrun",
    instructions="Migration rehearsal tools. Production is read-only except apply_to_production, which requires human approval.",
)

READ = ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False)
SANDBOX_WRITE = ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=True, openWorldHint=False)
PROD_WRITE = ToolAnnotations(readOnlyHint=False, destructiveHint=True, idempotentHint=False, openWorldHint=True)


async def _call(fn: Callable[..., Any], *args: Any, **kwargs: Any) -> dict[str, Any]:
    try:
        return await asyncio.to_thread(fn, *args, **kwargs)
    except engine.StepError as e:
        return {"error": str(e)}
    except production.ApplyRefused as e:
        return {"refused": True, "reason": str(e)}
    except Exception as e:  # noqa: BLE001 - surface to the agent instead of crashing the MCP session
        traceback.print_exc()
        return {"error": f"{type(e).__name__}: {str(e)[:400]}"}


@mcp.tool(annotations=READ)
async def get_rehearsal_brief(rehearsal_id: str) -> dict[str, Any]:
    """Read the migration to rehearse: SQL statements, affected tables, static lock analysis, production schema
    (tables, columns, row counts, foreign keys) and active safety policies. Call this first."""
    return await _call(engine.brief, rehearsal_id)


@mcp.tool(annotations=SANDBOX_WRITE)
async def create_sandbox(rehearsal_id: str) -> dict[str, Any]:
    """Clone production into an isolated throwaway sandbox database and snapshot every table (the 'before'
    photo). Production is only read. Call after get_rehearsal_brief."""
    return await _call(engine.create_sandbox, rehearsal_id)


@mcp.tool(annotations=SANDBOX_WRITE)
async def apply_migration_in_sandbox(rehearsal_id: str) -> dict[str, Any]:
    """Run the migration inside the sandbox while measuring table locks. If PostgreSQL rejects it, returns the
    error plus automatically collected evidence (e.g. the duplicate or violating rows)."""
    return await _call(engine.apply_migration, rehearsal_id)


@mcp.tool(annotations=READ)
async def compare_before_after(rehearsal_id: str) -> dict[str, Any]:
    """Compare the sandbox after the migration with the before-snapshot: row counts, per-column value
    fingerprints, row-level changes, NULLs, broken foreign keys and schema diff."""
    return await _call(engine.compare, rehearsal_id)


@mcp.tool(annotations=READ)
async def run_sandbox_check(
    rehearsal_id: str,
    title: str,
    query: str,
    expectation: str = "no_rows",
    severity: str = "fail",
    explanation: str = "",
    table: str = "",
) -> dict[str, Any]:
    """Run ONE read-only SELECT you wrote against the sandbox and record it as a safety check.
    expectation: "no_rows" (pass when the query finds nothing — use for 'find the bad rows' checks) or
    "rows" (pass when it returns rows). severity: "fail" or "warn". Writes, multiple statements and dangerous
    functions are refused. Returns row count and a sample."""
    return await _call(engine.sandbox_check, rehearsal_id, title=title, query=query, expectation=expectation,
                       severity=severity, explanation=explanation or None, table=table or None)


@mcp.tool(annotations=SANDBOX_WRITE)
async def test_rollback(rehearsal_id: str, down_sql: str = "") -> dict[str, Any]:
    """Apply the down migration in the sandbox and prove every table is byte-identical to the before-snapshot.
    Pass down_sql if the user did not provide one (write the exact reverse of the migration)."""
    return await _call(engine.test_rollback, rehearsal_id, down_sql or None, "ai" if down_sql else "user")


@mcp.tool(annotations=READ)
async def submit_report(rehearsal_id: str, headline: str, summary: str) -> dict[str, Any]:
    """Finish the rehearsal: DryRun computes the risk score and verdict from the evidence; you provide the
    plain-English headline (one sentence with the key number) and a 2–4 sentence summary."""
    from .config import settings

    return await _call(engine.finalize, rehearsal_id, headline=headline, summary=summary, model=settings().dryrun_agent_model)


@mcp.tool(annotations=READ)
async def propose_fix(
    rehearsal_id: str,
    root_cause: str,
    evidence: list[str],
    fixed_sql: str,
    down_sql: str,
    why_safer: list[str],
) -> dict[str, Any]:
    """Record a safer migration for a blocked/risky rehearsal. It is NOT applied anywhere — the human reviews it
    and DryRun rehearses it as a new version. Include a down_sql that fully reverses fixed_sql."""

    def _save() -> dict[str, Any]:
        doc = store.get_rehearsal(rehearsal_id)
        if not doc:
            raise engine.StepError(f"unknown rehearsal {rehearsal_id}")
        from .config import settings

        fix = {
            "id": store.new_id("fix"),
            "rehearsal_id": rehearsal_id,
            "root_cause": root_cause,
            "evidence": evidence[:8],
            "original_sql": doc["up_sql"],
            "fixed_sql": fixed_sql,
            "down_sql": down_sql or None,
            "why_safer": why_safer[:8],
            "model": settings().dryrun_agent_model,
            "created_at": store.now(),
        }
        store.update_state(rehearsal_id, fix={"state": "ready", "fix": fix, "error": None})
        engine.Recorder.of(rehearsal_id).log("ai", "ai.fix", "safer migration drafted — waiting for human review")
        audit.record("ai.fix.proposed", target=rehearsal_id, fix=fix["id"])
        return {"saved": True, "fix_id": fix["id"], "next": "a human will review and rehearse it"}

    return await _call(_save)


@mcp.tool(annotations=PROD_WRITE)
async def apply_to_production(approval_id: str) -> dict[str, Any]:
    """IRREVERSIBLE: apply an approved, rehearsed migration to the PRODUCTION database (backup → apply → verify).
    Requires human approval in TrueForge AND an approved DryRun approval (two-person rule, typed confirmation)."""
    return await _call(production.apply, approval_id)


@mcp.tool(annotations=PROD_WRITE)
async def restore_production_backup(approval_id: str) -> dict[str, Any]:
    """IRREVERSIBLE: restore the affected production tables from the backup taken before apply."""
    appr = store.get("approvals", approval_id) or {}
    actor = (appr.get("decided_by") or {}).get("id") or "agent"
    return await _call(production.restore, approval_id, actor)


@mcp.tool(annotations=READ)
async def list_pending_approvals() -> dict[str, Any]:
    """List production approvals that are pending or approved but not yet applied (used by the nightly drift check)."""

    def _list() -> dict[str, Any]:
        out = []
        for a in store.list_approvals():
            if a["status"] in ("pending", "approved"):
                r = a["rehearsal"]
                out.append({"approval_id": a["id"], "status": a["status"], "rehearsal_id": r["id"], "migration": r["name"],
                            "version": r["version"], "risk": r["risk"], "rehearsed_at": r["created_at"]})
        return {"approvals": out}

    return await _call(_list)


@mcp.tool(annotations=SANDBOX_WRITE)
async def rerun_rehearsal(rehearsal_id: str) -> dict[str, Any]:
    """Re-rehearse an existing migration against TODAY's production data as a new version (drift check). Runs in a
    fresh sandbox in the background; production is not touched."""

    def _rerun() -> dict[str, Any]:
        doc = store.get_rehearsal(rehearsal_id)
        if not doc:
            raise engine.StepError(f"unknown rehearsal {rehearsal_id}")
        new = service.create_rehearsal(connection_id=doc["connection_id"], name=doc["name"], up_sql=doc["up_sql"],
                                       down_sql=doc.get("down_sql"), parent_id=rehearsal_id, user=service.SYSTEM_USER,
                                       options={"drift_check": True})
        audit.record("drift.rerun", target=rehearsal_id, new=new["id"])
        return {"queued": True, "new_rehearsal_id": new["id"], "version": new["version"]}

    return await _call(_rerun)
