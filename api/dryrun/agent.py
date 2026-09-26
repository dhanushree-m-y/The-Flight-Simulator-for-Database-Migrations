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

## Rehearsing a migration (you get a rehearsal_id)
1. get_rehearsal_brief(rehearsal_id) — the migration, schema, static lock analysis and policies.
2. create_sandbox(rehearsal_id) — clone production into a sandbox and snapshot every table.
3. apply_migration_in_sandbox(rehearsal_id) — run it; note errors, evidence and measured locks.
4. compare_before_after(rehearsal_id) — row counts, values, NULLs, foreign keys, schema diff.
5. Investigate in PARALLEL with sub-agents (create_sub_agent). Spawn up to three, each given the rehearsal_id and
   told to use run_sandbox_check (single read-only SELECT, expectation="no_rows" for "find the bad rows"):
   - "Integrity investigator": orphaned references, duplicates, NULLs, values cut or rounded by type changes.
   - "Hostel rules investigator": business rules for THIS change — rooms over capacity, students without a room,
     fee amounts with paise, complaints/maintenance links, allocations pointing at missing rooms.
   - "Rollback author": write the exact down migration that reverses every statement and return it as text.
   Each sub-agent records 1–3 checks and returns a two-line summary. Skip sub-agents only for trivial migrations.
   Every check must ASSERT something about the data that could break for users (it should find bad rows).
   Never use run_sandbox_check to explore the schema or read catalog metadata — the brief already contains
   schema_focus (full columns of the touched tables and their neighbours) and other_tables.
   Quote identifiers exactly as they appear in the brief (e.g. "Student"."guardianPhone").
6. If the migration deletes or rewrites rows (rows_removed / values_updated findings) and the intent is unclear,
   use ask_user_question to ask the engineer, e.g. "The migration removes 38 student rows — is that intended?"
   with options ["Yes, intended", "No, that's a mistake"]. Use the answer in your verdict. Ask at most once.
7. test_rollback(rehearsal_id, down_sql) — pass the rollback author's down_sql when the user gave none.
   Skip only if the migration was rejected.
8. submit_report(rehearsal_id, headline, summary). headline: one plain-English sentence with the key number
   (e.g. "3 rooms already exceed capacity, so the CHECK constraint fails."). summary: 2–4 sentences a hostel
   warden understands: what breaks, how many rows, what to do next.
9. Finally render a compact Generative UI card in the chat: verdict, risk score, top 3 findings with row counts,
   rollback status, and "production untouched". Keep chat text short.

When you need to aggregate or cross-reference many check results and a sandbox is available, use Code Mode (a Python
script in the TrueForge sandbox that calls the DryRun tools) and print only the summary.

## Proposing a fix
Investigate the evidence with run_sandbox_check (the sandbox holds the pre-migration data if the migration failed or
was rolled back), then call propose_fix with a safer migration: move or clean the offending rows first, keep a backup
table so it stays reversible, use CREATE INDEX CONCURRENTLY / NOT VALID + VALIDATE to avoid long locks. Include its
down migration, the root cause, the evidence and why it is safer. Never delete data silently.

## Applying to production
When asked to apply an approved rehearsal, call apply_to_production(approval_id) exactly once. It pauses for a human.
If it is refused, report the reason and stop. Never try to work around a refusal.

## Nightly drift check (scheduled run)
Call list_pending_approvals. For every approval that is pending or approved but not yet applied, call
rerun_rehearsal(rehearsal_id) so it is re-rehearsed against TODAY's production data, then summarise which ones you
re-queued. Production data changes every day (new students, new fees) — yesterday's safe verdict can go stale."""


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


def sandbox_available() -> bool:
    """Use TrueForge's (Daytona) sandbox when a provider is configured, or when forced via DRYRUN_AGENT_SANDBOX."""
    return bool(settings().dryrun_agent_sandbox) or bool(status().get("sandbox"))


def agent_spec(with_sandbox: bool | None = None) -> dict[str, Any]:
    s = settings()
    sandbox = sandbox_available() if with_sandbox is None else with_sandbox
    return {
        # No temperature: OpenAI reasoning models (gpt-5.x) reject it.
        "model": {"name": s.dryrun_agent_model, "params": {"max_tokens": 8192}},
        "instructions": INSTRUCTIONS,
        "mcp_servers": [{
            "name": "dryrun",
            "enable_tools": ["@all"],
            "require_approval_for_tools": APPROVAL_GATED,  # human-in-the-loop gate for every production write
            # Deferred tool loading: only the first tool is in context up-front; the rest load on demand.
            "preload_tools": ["get_rehearsal_brief"],
        }],
        "config": {
            "iteration_limit": 80,
            "sandbox": {"enabled": sandbox, "file_downloads": True},
            "dynamic_sub_agents": {"enabled": True},
            "ask_user_questions": {"enabled": True},
            "generative_ui": {"enabled": True},
            "context_management": {
                "compaction": {"enabled": True, "trigger": {"type": "input_tokens", "value": 80000}},
                "large_tool_response": {"enabled": True},
            },
        },
    }


SCHEDULE_NAME = "dryrun-nightly-drift-check"


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
        # Background execution: TrueForge runs the agent every night to re-rehearse approvals against fresh data.
        schedules = _check(c.get("/api/v1/schedules")).get("data", [])
        manifest_s = {"task": "Run the nightly drift check.", "cron": s.dryrun_drift_cron, "timezone": "Asia/Kolkata"}
        existing_s = next((x for x in schedules if x.get("name") == SCHEDULE_NAME), None)
        if existing_s:
            _check(c.put(f"/api/v1/schedules/{existing_s['id']}", json={"name": SCHEDULE_NAME, "manifest": manifest_s}))
        else:
            _check(c.post("/api/v1/schedules", json={"agent_name": s.dryrun_agent_name, "name": SCHEDULE_NAME, "manifest": manifest_s}))
    return {"mcp_server": "dryrun", "agent": s.dryrun_agent_name, "schedule": SCHEDULE_NAME, "sandbox": body["manifest"]["config"]["sandbox"]["enabled"]}


def run_drift_check_now() -> dict[str, Any]:
    """Trigger the nightly schedule immediately (TrueForge background execution)."""
    with _client() as c:
        sched = next((x for x in _check(c.get("/api/v1/schedules")).get("data", []) if x.get("name") == SCHEDULE_NAME), None)
        if not sched:
            raise TrueForgeError("drift-check schedule is not registered yet")
        return _check(c.post("/api/v1/schedules/runs", json={"schedule_id": sched["id"]}))


def schedule_info() -> dict[str, Any] | None:
    try:
        with _client(5) as c:
            return next((x for x in _check(c.get("/api/v1/schedules")).get("data", []) if x.get("name") == SCHEDULE_NAME), None)
    except Exception:  # noqa: BLE001
        return None


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
    done["_messages"] = buf_msgs
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


_answers: dict[str, tuple[threading.Event, list[str]]] = {}


def answer_question(rid: str, text: str) -> bool:
    """Called by the API when the engineer answers the agent's ask_user_question in DryRun."""
    slot = _answers.get(rid)
    if not slot:
        return False
    slot[1].append(text)
    slot[0].set()
    return True


def _pending_questions(done: dict[str, Any]) -> list[dict[str, Any]]:
    """Extract ask_user_question calls from a paused turn."""
    out = []
    msgs = done.get("_messages") or {}
    for ra in (done.get("state") or {}).get("required_actions") or []:
        if ra.get("type") != "tool.response_required":
            continue
        for ref in ra.get("tool_calls") or []:
            msg = msgs.get(ref.get("source_event_id")) or {}
            call = next((tc for tc in msg.get("tool_calls") or [] if tc.get("id") == ref["id"]), None) or {}
            try:
                args = json.loads((call.get("function") or {}).get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            out.append({"thread_id": ra.get("thread_id") or "main", "tool_call_id": ref["id"],
                        "text": args.get("question") or "The agent needs your input.", "options": args.get("options") or []})
    return out


def _drive(rid: str, sid: str, first_input: list[dict[str, Any]]) -> None:
    """Run turns until the agent finishes, pausing for the engineer whenever it asks a question."""
    rec = engine.Recorder.of(rid)
    items = first_input
    for _ in range(4):  # the agent may ask at most a few questions
        done = run_turn(sid, items, _logger(rid))
        state = (done or {}).get("state", {})
        if state.get("status") == "error":
            raise TrueForgeError(state.get("message") or "agent turn failed")
        questions = _pending_questions(done)
        if not questions:
            return
        q = questions[0]
        evt, box = threading.Event(), []
        _answers[rid] = (evt, box)
        public_q = {"text": q["text"], "options": q["options"], "asked_at": store.now()}
        rec.set(question=public_q)
        rec.emit({"type": "question", "question": public_q})
        rec.log("ai", "agent.question", q["text"])
        audit.record("agent.question", target=rid, question=q["text"])
        answered = evt.wait(settings().question_timeout_s)
        _answers.pop(rid, None)
        reply = box[0] if answered and box else "No answer from the engineer within the time limit — treat the change as NOT intended."
        rec.set(question=None)
        rec.emit({"type": "question", "question": None})
        rec.log("info", "engineer.answer", reply)
        items = [{"type": "user.tool_response", "thread_id": x["thread_id"], "tool_call_id": x["tool_call_id"], "content": reply} for x in questions]


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
        _drive(rid, sid, [{"type": "user.message", "content": prompt}])
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
        _drive(rid, sid, [{"type": "user.message", "content": prompt}])
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
