"""TrueForge integration. DryRun's agent is a TrueForge agent: TrueForge runs the agent loop (model,
context, approvals); DryRun exposes its rehearsal engine to it as a remote MCP server (mcp_tools.py).

Flow:
  1. ensure_setup(): register the `dryrun` MCP server and the `dryrun-rehearsal-agent` spec in TrueForge.
  2. start_rehearsal(): create a TrueForge session and stream a turn asking the agent to rehearse.
     Agent tool calls hit /mcp → engine steps → live events for the UI.
  3. request_apply(): a new turn asks the agent to apply; TrueForge pauses on the approval-gated
     `apply_to_production` tool (tool.approval_required). The pending call is stored on the approval.
  4. release(): when an approver approves in DryRun, we answer TrueForge with user.tool_approval=allow.
"""

from __future__ import annotations

import json
import threading
import traceback
from typing import Any, Callable

import httpx

from . import audit, engine, store
from .config import settings

APPROVAL_GATED = ["apply_to_production", "restore_production_backup"]

INSTRUCTIONS = """You are DryRun, a careful database migration rehearsal agent for a hostel management system.
You NEVER touch production directly. Every write happens in a throwaway sandbox clone through your DryRun tools.

When asked to rehearse a migration (you get a rehearsal_id):
1. get_rehearsal_brief(rehearsal_id) — read the migration, the schema, static lock analysis and the policies.
2. create_sandbox(rehearsal_id) — clone production into a sandbox and snapshot every table.
3. apply_migration_in_sandbox(rehearsal_id) — run the migration; note errors and measured locks.
4. compare_before_after(rehearsal_id) — row counts, values, NULLs, foreign keys, schema diff.
5. Think like a senior DBA about what ELSE could go wrong for THIS change and verify it with 2–5
   run_sandbox_check(rehearsal_id, title, query, expectation, severity, explanation) calls. Each query must be a
   single read-only SELECT. Use expectation="no_rows" for "this should find nothing" checks. Examples: rows that
   would violate the new rule, orphaned references, values that would be cut or rounded, rooms over capacity,
   students without a room, fee amounts with paise. If the migration failed, investigate WHY with checks.
6. test_rollback(rehearsal_id, down_sql) — if the user gave no down migration and the migration applied, write
   a correct down migration yourself (reverse every statement) and pass it. Skip only if the migration failed.
7. submit_report(rehearsal_id, headline, summary) — headline: one plain-English sentence with the key number
   (e.g. "3 rooms already exceed capacity, so the CHECK constraint fails."). summary: 2–4 sentences a hostel
   warden could understand: what breaks, how many rows, and what to do.
Call the tools in this order. Be concise in chat.

When asked to propose a fix for a rehearsal: investigate the evidence with run_sandbox_check (the sandbox holds
the pre-migration data if the migration failed or was rolled back), then call propose_fix with a safer migration
(e.g. clean or move the offending rows first, keep a backup table so the change is reversible, use
CREATE INDEX CONCURRENTLY / NOT VALID + VALIDATE to avoid long locks), its down migration, the root cause, the
evidence, and why it is safer. Never delete data silently — preserve it (archive/backup tables) and say so.

When asked to apply an approved rehearsal to production: call apply_to_production(approval_id) exactly once.
It pauses for a human; if it is refused, report the reason and stop. Never try to work around a refusal."""


class TrueForgeError(RuntimeError):
    pass


def _client(timeout: float = 30) -> httpx.Client:
    s = settings()
    headers = {"Content-Type": "application/json"}
    if s.trueforge_token:
        headers["Authorization"] = f"Bearer {s.trueforge_token}"
    return httpx.Client(base_url=s.trueforge_base_url.rstrip("/"), headers=headers, timeout=timeout)


def _check(r: httpx.Response) -> dict[str, Any]:
    if r.status_code >= 400:
        try:
            msg = r.json().get("error", {}).get("message") or r.text
        except Exception:  # noqa: BLE001
            msg = r.text
        raise TrueForgeError(f"TrueForge {r.request.method} {r.request.url.path} → {r.status_code}: {msg[:300]}")
    return r.json() if r.content else {}


def status() -> dict[str, Any]:
    """Reachability + configured model providers, for /api/integrations and mode selection."""
    try:
        with _client(5) as c:
            providers = _check(c.get("/api/v1/settings/model-providers")).get("data", [])
            servers = _check(c.get("/api/v1/settings/mcp-servers")).get("data", [])
            caps = _check(c.get("/api/v1/capabilities")).get("data", {})
        return {"reachable": True, "providers": providers, "mcp_servers": servers, "sandbox": caps.get("sandbox", {}).get("enabled", False)}
    except Exception as e:  # noqa: BLE001
        return {"reachable": False, "error": str(e)[:200], "providers": [], "mcp_servers": [], "sandbox": False}


def agent_spec() -> dict[str, Any]:
    s = settings()
    spec: dict[str, Any] = {
        "model": {"name": s.dryrun_agent_model, "params": {"temperature": 0.1, "max_tokens": 4096}},
        "instructions": INSTRUCTIONS,
        "mcp_servers": [{"name": "dryrun", "enable_tools": ["@all"], "require_approval_for_tools": APPROVAL_GATED, "preload": True}],
        "config": {"iteration_limit": 60, "sandbox": {"enabled": bool(s.dryrun_agent_sandbox)}},
    }
    return spec


def ensure_setup() -> dict[str, Any]:
    """Idempotently register the MCP server and the agent in TrueForge."""
    s = settings()
    manifest = {
        "type": "remote",
        "name": "dryrun",
        "url": s.dryrun_mcp_public_url,
        "description": "DryRun migration rehearsal tools: sandbox clone, apply, compare, read-only checks, rollback proof, report, and approval-gated production apply.",
        "auth": {"type": "header", "headers": {"X-DryRun-Agent-Key": s.dryrun_mcp_key}},
    }
    with _client() as c:
        existing = {m["name"] for m in _check(c.get("/api/v1/settings/mcp-servers")).get("data", []) if isinstance(m, dict) and "name" in m}
        if not existing:
            # responses may nest the name under manifest
            existing = {((m.get("manifest") or {}).get("name")) for m in _check(c.get("/api/v1/settings/mcp-servers")).get("data", [])}
        if "dryrun" in existing:
            _check(c.put("/api/v1/settings/mcp-servers", json={"manifest": manifest}))
        else:
            _check(c.post("/api/v1/settings/mcp-servers", json={"manifest": manifest}))
        agents = _check(c.get("/api/v1/agents")).get("data", [])
        found = next((a for a in agents if a.get("name") == s.dryrun_agent_name), None)
        body = {"description": "Rehearses Postgres migrations in a sandbox and gates production behind human approval.", "manifest": agent_spec()}
        if found:
            _check(c.put(f"/api/v1/agents/{found['id']}", json=body))
        else:
            _check(c.post("/api/v1/agents", json={"name": s.dryrun_agent_name, **body}))
    return {"mcp_server": "dryrun", "agent": s.dryrun_agent_name}


def session_url(session_id: str) -> str:
    return f"{settings().ui_url}/sessions/{session_id}"


def create_session(metadata: dict[str, Any]) -> str:
    with _client() as c:
        data = _check(c.post("/api/v1/sessions", json={"agent": {"name": settings().dryrun_agent_name}, "metadata": metadata}))
    return (data.get("data") or data)["id"]


def run_turn(session_id: str, input_items: list[dict[str, Any]], on_event: Callable[[dict[str, Any]], None]) -> dict[str, Any]:
    """Stream one turn (SSE) and feed every event to on_event. Returns the turn.done event."""
    done: dict[str, Any] = {}
    buf_msgs: dict[str, dict[str, Any]] = {}
    with _client(timeout=httpx.Timeout(30, read=660)) as c:
        with c.stream("POST", f"/api/v1/sessions/{session_id}/turns", json={"input": input_items, "stream": True}) as r:
            if r.status_code >= 400:
                r.read()
                _check(r)
            data_lines: list[str] = []
            for raw in r.iter_lines():
                if raw.startswith("data:"):
                    data_lines.append(raw[5:].strip())
                    continue
                if raw == "" and data_lines:
                    payload = "\n".join(data_lines)
                    data_lines = []
                    try:
                        ev = json.loads(payload)
                    except json.JSONDecodeError:
                        continue
                    ev = _merge(ev, buf_msgs)
                    if ev is None:
                        continue
                    on_event(ev)
                    if ev.get("type") == "turn.done":
                        done = ev
    return done


def _merge(ev: dict[str, Any], msgs: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
    """Fold model.message.delta fragments into their model.message; emit the merged message on finish."""
    t = ev.get("type")
    if t == "model.message":
        msgs[ev["id"]] = ev
        return ev if ev.get("finish_reason") else None
    if t == "model.message.delta":
        base = msgs.get(ev["id"])
        if base is None:
            return None
        if ev.get("content"):
            base["content"] = (base.get("content") or "") + ev["content"]
        for tc in ev.get("tool_calls") or []:
            idx = tc.get("index", 0)
            calls = base.setdefault("tool_calls", [])
            while len(calls) <= idx:
                calls.append({"id": None, "function": {"name": "", "arguments": ""}})
            tgt = calls[idx]
            if tc.get("id"):
                tgt["id"] = tc["id"]
            fn = tc.get("function") or {}
            tgt["function"]["name"] += fn.get("name") or ""
            tgt["function"]["arguments"] += fn.get("arguments") or ""
            if tc.get("tool_info"):
                tgt["tool_info"] = tc["tool_info"]
        if ev.get("finish_reason"):
            base["finish_reason"] = ev["finish_reason"]
            return base
        return None
    return ev


# ---------------------------------------------------------------------------------------------
# High-level flows (run in background threads)
# ---------------------------------------------------------------------------------------------

def _logger(rid: str) -> Callable[[dict[str, Any]], None]:
    rec = engine.Recorder.of(rid)

    def on_event(ev: dict[str, Any]) -> None:
        t = ev.get("type")
        if t == "model.message":
            text = (ev.get("content") or "").strip()
            if text:
                rec.log("ai", "agent", text[:600])
            for tc in ev.get("tool_calls") or []:
                name = (tc.get("tool_info") or {}).get("name") or tc["function"]["name"]
                rec.log("ai", "agent.tool", f"→ {name}")
        elif t == "tool.approval_required":
            rec.log("warn", "trueforge", "turn paused — waiting for human approval")
        elif t == "sandbox.created":
            rec.log("info", "trueforge", f"TrueForge sandbox {ev.get('sandbox_id')} provisioned")
        elif t == "turn.done":
            stt = ev.get("state", {})
            m = stt.get("metrics") or {}
            if m:
                rec.log("info", "trueforge", f"turn done · {m.get('total_tokens', 0)} tokens · ${m.get('total_cost_in_usd', 0):.3f}")
            if stt.get("status") == "error":
                rec.log("error", "trueforge", stt.get("message", "turn error"))

    return on_event


def start_rehearsal(rid: str) -> None:
    """Background: let the TrueForge agent drive the rehearsal; fall back to direct mode if unavailable."""
    s = settings()
    rec = engine.Recorder.of(rid)
    if s.dryrun_agent_mode != "trueforge":
        rec.set(agent={"provider": "direct", "session_id": None, "url": None, "model": None})
        engine.run_direct(rid)
        return
    try:
        ensure_setup()
        sid = create_session({"dryrun_rehearsal_id": rid, "migration": rec.doc["name"]})
    except Exception as e:  # noqa: BLE001
        rec.log("warn", "trueforge", f"TrueForge unavailable ({str(e)[:160]}) — falling back to direct mode")
        rec.set(agent={"provider": "direct", "session_id": None, "url": None, "model": None})
        engine.run_direct(rid)
        return
    store.update_state(rid, trueforge_session=sid)
    rec.set(agent={"provider": "trueforge", "session_id": sid, "url": session_url(sid), "model": s.dryrun_agent_model})
    rec.log("info", "trueforge", f"session {sid} · agent {s.dryrun_agent_name} · {s.dryrun_agent_model}")
    audit.record("agent.session.started", actor=rec.doc["created_by"]["id"], target=rid, session=sid)
    prompt = f"Rehearse migration `{rec.doc['name']}` (rehearsal_id: {rid}) against {rec.doc['connection_name']}. Follow your procedure and finish with submit_report."
    try:
        done = run_turn(sid, [{"type": "user.message", "content": prompt}], _logger(rid))
        state = (done or {}).get("state", {})
        if state.get("status") == "error":
            raise TrueForgeError(state.get("message") or "agent turn failed")
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        rec.log("error", "trueforge", f"agent turn failed: {str(e)[:300]}")
    # Safety net: if the agent stopped early, finish deterministically so the user always gets a verdict.
    doc = store.get_rehearsal(rid) or {}
    if doc.get("status") in ("queued", "running"):
        rec.log("warn", "dryrun", "agent did not finish the procedure — completing remaining steps deterministically")
        try:
            st = store.state(rid)
            if not st.get("sandbox"):
                engine.create_sandbox(rid)
            if not store.state(rid).get("applied"):
                engine.apply_migration(rid)
            if not store.state(rid).get("compared"):
                engine.compare(rid)
            st = store.state(rid)
            if not st.get("rollback_done") and (engine.Recorder.of(rid).doc.get("down_sql") or not st["apply_result"]["ok"]):
                engine.test_rollback(rid)
            engine.finalize(rid)
        except Exception as e:  # noqa: BLE001
            engine.fail(rid, f"{type(e).__name__}: {e}")


def start_fix(rid: str) -> None:
    """Background: ask the agent (same session) to investigate and propose a safer migration."""
    store.update_state(rid, fix={"state": "running", "fix": None, "error": None})
    rec = engine.Recorder.of(rid)
    st = store.state(rid)
    sid = st.get("trueforge_session")
    try:
        if not sid:
            ensure_setup()
            sid = create_session({"dryrun_rehearsal_id": rid, "purpose": "fix"})
            store.update_state(rid, trueforge_session=sid)
        if not st.get("sandbox"):
            raise TrueForgeError("the sandbox for this rehearsal has expired — re-run the rehearsal first")
        prompt = (f"Propose a fix for rehearsal_id {rid} (`{rec.doc['name']}`). Verdict was {rec.doc['status']} with risk {rec.doc['risk']}: "
                  f"{rec.doc.get('headline')}. Investigate with run_sandbox_check, then call propose_fix.")
        run_turn(sid, [{"type": "user.message", "content": prompt}], _logger(rid))
        if (store.state(rid).get("fix") or {}).get("state") != "ready":
            raise TrueForgeError("the agent finished without proposing a fix")
    except Exception as e:  # noqa: BLE001
        store.update_state(rid, fix={"state": "failed", "fix": None, "error": str(e)[:300]})


def request_apply(approval_id: str) -> None:
    """Background: ask the agent to apply; TrueForge pauses on the gated tool and we record the pending call."""
    approval = store.get("approvals", approval_id)
    rid = approval["rehearsal"]["id"]
    st = store.state(rid)
    sid = st.get("trueforge_session")
    ast = store.get("approval_state", approval_id) or {}
    if not sid or settings().dryrun_agent_mode != "trueforge":
        ast["mode"] = "direct"
        store.put("approval_state", approval_id, ast)
        return
    pending: list[dict[str, Any]] = []

    def on_event(ev: dict[str, Any]) -> None:
        if ev.get("type") == "tool.approval_required":
            for ref in ev.get("tool_calls") or []:
                pending.append({"thread_id": ev.get("thread_id") or "main", "tool_call_id": ref["id"]})

    try:
        prompt = f"Rehearsal {rid} passed and a human requested production apply. Call apply_to_production with approval_id {approval_id}."
        done = run_turn(sid, [{"type": "user.message", "content": prompt}], on_event)
        for ra in (done.get("state") or {}).get("required_actions") or []:
            if ra.get("type") == "tool.approval_required":
                for ref in ra.get("tool_calls") or []:
                    if not any(p["tool_call_id"] == ref["id"] for p in pending):
                        pending.append({"thread_id": ra.get("thread_id") or "main", "tool_call_id": ref["id"]})
        ast.update(mode="trueforge", session_id=sid, pending=pending)
    except Exception as e:  # noqa: BLE001
        ast.update(mode="direct", error=str(e)[:300])
    store.put("approval_state", approval_id, ast)
    audit.record("agent.apply.paused", target=approval_id, session=sid, pending=len(pending))


def release(approval_id: str, allow: bool, reason: str | None = None) -> str:
    """Answer TrueForge's paused approval. Returns the mode used ('trueforge' or 'direct')."""
    from . import production

    ast = store.get("approval_state", approval_id) or {}
    if ast.get("mode") == "trueforge" and ast.get("pending"):
        items = [
            {"type": "user.tool_approval", "thread_id": p["thread_id"], "tool_call_id": p["tool_call_id"],
             "approval": {"status": "allow"} if allow else {"status": "deny", "reason": reason or "rejected by approver in DryRun"}}
            for p in ast["pending"]
        ]
        ast["pending"] = []
        store.put("approval_state", approval_id, ast)

        def _run() -> None:
            try:
                run_turn(ast["session_id"], items, lambda ev: None)
            except Exception:  # noqa: BLE001
                traceback.print_exc()
            appr = store.get("approvals", approval_id)
            if allow and appr and appr["status"] == "approved":
                # The agent did not call the tool after release — apply directly (still gated server-side).
                try:
                    production.apply(approval_id)
                except Exception:  # noqa: BLE001
                    traceback.print_exc()

        threading.Thread(target=_run, daemon=True).start()
        return "trueforge"
    if allow:
        threading.Thread(target=lambda: _safe(production.apply, approval_id), daemon=True).start()
    return "direct"


def _safe(fn: Callable[..., Any], *a: Any) -> None:
    try:
        fn(*a)
    except Exception:  # noqa: BLE001
        traceback.print_exc()
