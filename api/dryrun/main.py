"""DryRun API: REST + Server-Sent Events for the web app, and the MCP endpoint (/mcp/) for the TrueForge agent."""

from __future__ import annotations

import asyncio
import contextlib
import hmac
import json
import threading
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any, AsyncIterator

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from . import agent, analyzer, audit, engine, events, policies, production, profiler, report, sandbox, store
from .config import settings
from .db import connect, database_of, masked_host
from .mcp_tools import mcp

USERS = [
    {"id": "u_engineer", "name": "Arjun Mehta", "email": "arjun@hostel.example", "role": "engineer", "initials": "AM"},
    {"id": "u_approver", "name": "Meera Iyer", "email": "meera@hostel.example", "role": "approver", "initials": "MI"},
    {"id": "u_viewer", "name": "Riya Nair", "email": "riya@hostel.example", "role": "viewer", "initials": "RN"},
    {"id": "u_admin", "name": "Hostel Admin", "email": "admin@hostel.example", "role": "admin", "initials": "HA"},
]


# ---------------------------------------------------------------------------------------------
# App + MCP mount
# ---------------------------------------------------------------------------------------------

mcp_app = mcp.streamable_http_app(streamable_http_path="/", stateless_http=True, json_response=True)


class McpKeyGuard:
    """Only TrueForge (which holds the header secret) may call DryRun's tools."""

    def __init__(self, app: Any):
        self.app = app

    async def __call__(self, scope: dict, receive: Any, send: Any) -> None:
        if scope["type"] == "http":
            key = dict(scope.get("headers") or []).get(b"x-dryrun-agent-key", b"").decode()
            if not hmac.compare_digest(key, settings().dryrun_mcp_key):
                body = b'{"error":"missing or invalid X-DryRun-Agent-Key"}'
                await send({"type": "http.response.start", "status": 401, "headers": [(b"content-type", b"application/json")]})
                await send({"type": "http.response.body", "body": body})
                return
        await self.app(scope, receive, send)


@contextlib.asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    events.bind_loop(asyncio.get_running_loop())
    boot()
    janitor = asyncio.create_task(_janitor())
    async with mcp.session_manager.run():
        yield
    janitor.cancel()


app = FastAPI(title="DryRun API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings().web_origin, "http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/mcp", McpKeyGuard(mcp_app))


def boot() -> None:
    s = settings()
    if not s.dryrun_prod_dsn:
        print("[dryrun] DRYRUN_PROD_DSN is not set — configure api/.env (see .env.example)")
        return
    store.init()
    existing = {u["id"] for u in store.all_docs("users")}
    for u in USERS:
        if u["id"] not in existing:
            store.put("users", u["id"], u)
    policies.seed()
    if not store.get("connections", "conn_prod"):
        doc = {
            "id": "conn_prod",
            "name": s.dryrun_prod_name,
            "engine": "PostgreSQL",
            "host": masked_host(s.dryrun_prod_dsn),
            "database": database_of(s.dryrun_prod_dsn),
            "environment": "production",
            "read_only": True,
            "size_bytes": None,
            "tables": None,
            "rows": None,
            "health": "ok",
            "last_checked_at": None,
        }
        store.save_connection(doc, s.dryrun_prod_dsn)
        audit.record("connection.registered", target="conn_prod", name=s.dryrun_prod_name)
    if s.dryrun_agent_mode == "trueforge":
        try:
            agent.ensure_setup()
            print("[dryrun] TrueForge agent + MCP server registered")
        except Exception as e:  # noqa: BLE001
            print(f"[dryrun] TrueForge setup deferred: {e}")


async def _janitor() -> None:
    while True:
        await asyncio.sleep(120)
        try:
            active = {}
            for r in store.list_rehearsals(limit=200):
                st = store.state(r["id"])
                if st.get("sandbox"):
                    active[st["sandbox"]] = st.get("sandbox_expires") or datetime.now(timezone.utc).isoformat()
            dropped = await asyncio.to_thread(sandbox.reap_expired, active)
            for name in dropped:
                for r in store.list_rehearsals(limit=200):
                    if (r.get("sandbox") or {}).get("id") == name:
                        r["sandbox"]["status"] = "destroyed"
                        store.save_rehearsal(r)
                audit.record("sandbox.destroyed", target=name, reason="ttl")
        except Exception as e:  # noqa: BLE001
            print(f"[dryrun] janitor: {e}")


# ---------------------------------------------------------------------------------------------
# Auth (header-based user for the hackathon build; roles enforced server-side)
# ---------------------------------------------------------------------------------------------

def current_user(x_dryrun_user: str | None = Header(default=None), user: str | None = Query(default=None)) -> dict[str, Any]:
    uid = x_dryrun_user or user or "u_engineer"
    u = store.get("users", uid)
    if not u:
        raise HTTPException(401, "unknown user")
    return u


def require(*roles: str):
    def dep(u: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
        if u["role"] not in (*roles, "admin"):
            raise HTTPException(403, f"{u['role']} cannot do this — requires {' or '.join(roles)}")
        return u

    return dep


def _summary(doc: dict[str, Any]) -> dict[str, Any]:
    keys = ("id", "name", "version", "lineage_id", "connection_id", "connection_name", "status", "risk", "headline", "created_by",
            "created_at", "finished_at", "duration_ms", "approval_status")
    return {k: doc.get(k) for k in keys}


def _rehearsal(rid: str) -> dict[str, Any]:
    doc = store.get_rehearsal(rid)
    if not doc:
        raise HTTPException(404, "rehearsal not found")
    return doc


def _thread(fn: Any, *args: Any) -> None:
    threading.Thread(target=fn, args=args, daemon=True).start()


# ---------------------------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------------------------

@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"ok": True, "agent_mode": settings().dryrun_agent_mode}


@app.get("/api/users")
def users() -> list[dict[str, Any]]:
    order = {u["id"]: i for i, u in enumerate(USERS)}
    return sorted(store.all_docs("users"), key=lambda u: order.get(u["id"], 99))


@app.get("/api/overview")
def overview() -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=7)
    all_r = store.list_rehearsals(limit=500)
    week = [r for r in all_r if datetime.fromisoformat(r["created_at"]) >= since]
    done = [r for r in week if r.get("duration_ms")]
    issues: Counter[str] = Counter()
    for r in week:
        for c in r.get("checks", []):
            if c["status"] != "pass":
                issues[c["key"].replace("_", " ")] += 1
    iso = now.isocalendar()
    start = (now - timedelta(days=now.weekday())).strftime("%d %b")
    return {
        "week_label": f"Overview · week {iso.week} · from {start}",
        "kpis": {
            "rehearsals": len(week),
            "blocked": sum(1 for r in week if r["status"] == "blocked"),
            "rows_protected": sum((r.get("metrics") or {}).get("rows_total", 0) for r in week if r["status"] in ("blocked", "warning")),
            "avg_duration_ms": int(sum(r["duration_ms"] for r in done) / len(done)) if done else 0,
        },
        "pending": [_approval_out(a) for a in store.list_approvals("pending")],
        "recent": [_summary(r) for r in all_r[:8]],
        "risk_trend": [{"id": r["id"], "name": r["name"], "risk": r["risk"], "at": r["created_at"]} for r in reversed(week) if r.get("risk") is not None],
        "top_issues": [{"kind": k, "count": n} for k, n in issues.most_common(5)],
    }


# ---- connections ----------------------------------------------------------------------------

def _refresh_connection(doc: dict[str, Any]) -> dict[str, Any]:
    dsn = store.connection_dsn(doc["id"])
    try:
        with connect(dsn, app="dryrun-health") as c:
            c.execute("SET TRANSACTION READ ONLY")
            size = c.execute("SELECT pg_database_size(current_database()) AS s").fetchone()["s"]
            tables = profiler.list_tables(c)
            rows = sum(profiler.count_rows(c, t["schema"], t["name"]) for t in tables)
        doc.update(size_bytes=int(size), tables=len(tables), rows=rows, health="ok")
    except Exception:  # noqa: BLE001
        doc.update(health="down")
    doc["last_checked_at"] = store.now()
    store.save_connection(doc, dsn)
    return doc


@app.get("/api/connections")
def connections() -> list[dict[str, Any]]:
    out = []
    for d in store.all_docs("connections"):
        if not d.get("last_checked_at") or datetime.fromisoformat(d["last_checked_at"]) < datetime.now(timezone.utc) - timedelta(minutes=2):
            d = _refresh_connection(d)
        out.append(d)
    return out


class NewConnection(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    dsn: str = Field(min_length=8)
    environment: str = "production"


@app.post("/api/connections")
def add_connection(body: NewConnection, u: dict = Depends(require("admin"))) -> dict[str, Any]:
    try:
        with connect(body.dsn, app="dryrun-test") as c:
            c.execute("SELECT 1")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"could not connect: {str(e).splitlines()[0][:200]}") from e
    doc = {"id": store.new_id("conn"), "name": body.name, "engine": "PostgreSQL", "host": masked_host(body.dsn), "database": database_of(body.dsn),
           "environment": body.environment, "read_only": True, "size_bytes": None, "tables": None, "rows": None, "health": "ok", "last_checked_at": None}
    store.save_connection(doc, body.dsn)
    audit.record("connection.added", actor=u["id"], target=doc["id"], name=body.name)
    return _refresh_connection(doc)


@app.post("/api/connections/{cid}/test")
def test_connection(cid: str) -> dict[str, Any]:
    d = store.get("connections", cid)
    if not d:
        raise HTTPException(404, "connection not found")
    return _refresh_connection(d)


@app.get("/api/connections/{cid}/schema")
def connection_schema(cid: str) -> list[dict[str, Any]]:
    dsn = store.connection_dsn(cid)
    if not dsn:
        raise HTTPException(404, "connection not found")
    with connect(dsn, app="dryrun-schema") as c:
        c.execute("SET TRANSACTION READ ONLY")
        return [{k: t[k] for k in ("name", "rows", "columns", "references")} for t in profiler.schema_summary(c)]


class AnalyzeBody(BaseModel):
    sql: str
    connection_id: str | None = None


@app.post("/api/analyze")
def analyze(body: AnalyzeBody) -> list[dict[str, Any]]:
    return analyzer.hints(body.sql)


# ---- rehearsals -----------------------------------------------------------------------------

class NewRehearsal(BaseModel):
    connection_id: str
    name: str = Field(min_length=1, max_length=120)
    up_sql: str = Field(min_length=3)
    down_sql: str | None = None
    parent_id: str | None = None
    options: dict[str, Any] = Field(default_factory=lambda: {"ai_checks": True, "rollback": True})
    github_pr: int | None = None


def _create(body: NewRehearsal, u: dict[str, Any]) -> dict[str, Any]:
    conn = store.get("connections", body.connection_id)
    if not conn:
        raise HTTPException(404, "connection not found")
    if not analyzer.split_statements(body.up_sql):
        raise HTTPException(400, "migration has no SQL statements")
    lineage_id, version = store.new_id("lin"), 1
    if body.parent_id:
        parent = _rehearsal(body.parent_id)
        lineage_id = parent["lineage_id"]
        version = max(r["version"] for r in store.list_rehearsals(limit=100, lineage_id=lineage_id)) + 1
    rid = store.new_id("reh")
    doc = engine.new_rehearsal_doc(rid=rid, name=body.name.strip(), version=version, lineage_id=lineage_id, parent_id=body.parent_id,
                                   connection=conn, up_sql=body.up_sql.strip(), down_sql=(body.down_sql or "").strip() or None, user=u,
                                   options={**body.options, **({"github_pr": body.github_pr} if body.github_pr else {})})
    store.save_rehearsal(doc)
    store.save_state(rid, {})
    audit.record("rehearsal.started", actor=u["id"], target=rid, name=doc["name"], version=version, connection=conn["name"])
    _thread(agent.start_rehearsal, rid)
    return engine.public(doc)


@app.post("/api/rehearsals")
def create_rehearsal(body: NewRehearsal, u: dict = Depends(require("engineer", "approver"))) -> dict[str, Any]:
    return _create(body, u)


@app.get("/api/rehearsals")
def list_rehearsals(limit: int = 50, status: str | None = None, lineage_id: str | None = None) -> list[dict[str, Any]]:
    return [_summary(r) for r in store.list_rehearsals(limit=min(limit, 500), status=status, lineage_id=lineage_id)]


@app.get("/api/rehearsals/{rid}")
def get_rehearsal(rid: str) -> dict[str, Any]:
    return engine.public(_rehearsal(rid))


@app.get("/api/rehearsals/{rid}/events")
async def rehearsal_events(rid: str, request: Request) -> EventSourceResponse:
    doc = _rehearsal(rid)
    q = events.subscribe(f"rehearsal:{rid}")

    async def gen() -> AsyncIterator[dict[str, str]]:
        try:
            yield {"data": json.dumps({"type": "snapshot", "rehearsal": engine.public(store.get_rehearsal(rid) or doc)}, default=str)}
            while not await request.is_disconnected():
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=15)
                except asyncio.TimeoutError:
                    yield {"comment": "keep-alive"}
                    continue
                yield {"data": json.dumps(ev, default=str)}
        finally:
            events.unsubscribe(f"rehearsal:{rid}", q)

    return EventSourceResponse(gen())


@app.post("/api/rehearsals/{rid}/cancel")
def cancel(rid: str, u: dict = Depends(require("engineer", "approver"))) -> dict[str, Any]:
    _rehearsal(rid)
    engine.cancel(rid)
    audit.record("rehearsal.cancelled", actor=u["id"], target=rid)
    return engine.public(_rehearsal(rid))


@app.get("/api/rehearsals/{rid}/report.md", response_class=PlainTextResponse)
def report_markdown(rid: str) -> PlainTextResponse:
    doc = _rehearsal(rid)
    return PlainTextResponse(report.markdown(doc, f"{settings().web_origin.rstrip('/')}/rehearsals/{rid}/report"),
                             media_type="text/markdown; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="dryrun-{doc["name"]}-v{doc["version"]}.md"'})


@app.get("/api/rehearsals/{rid}/checks/{check_id}/rows")
def evidence_rows(rid: str, check_id: str) -> dict[str, Any]:
    ev = store.get_evidence(rid, check_id)
    if not ev:
        raise HTTPException(404, "no evidence rows for this check")
    return ev


@app.get("/api/rehearsals/{rid}/lineage")
def lineage(rid: str) -> list[dict[str, Any]]:
    doc = _rehearsal(rid)
    return [_summary(r) for r in store.list_rehearsals(limit=100, lineage_id=doc["lineage_id"])]


@app.post("/api/rehearsals/{rid}/fix")
def start_fix(rid: str, u: dict = Depends(require("engineer", "approver"))) -> dict[str, Any]:
    doc = _rehearsal(rid)
    if doc["status"] in ("queued", "running"):
        raise HTTPException(409, "wait for the rehearsal to finish")
    cur = store.state(rid).get("fix") or {}
    if cur.get("state") == "running":
        return cur
    store.update_state(rid, fix={"state": "running", "fix": None, "error": None})
    audit.record("ai.fix.requested", actor=u["id"], target=rid)
    _thread(agent.start_fix, rid)
    return {"state": "running", "fix": None, "error": None}


@app.get("/api/rehearsals/{rid}/fix")
def get_fix(rid: str) -> dict[str, Any]:
    _rehearsal(rid)
    return store.state(rid).get("fix") or {"state": "none", "fix": None, "error": None}


class RehearseFix(BaseModel):
    fixed_sql: str = Field(min_length=3)
    down_sql: str | None = None


@app.post("/api/rehearsals/{rid}/rehearse-fix")
def rehearse_fix(rid: str, body: RehearseFix, u: dict = Depends(require("engineer", "approver"))) -> dict[str, Any]:
    doc = _rehearsal(rid)
    return _create(NewRehearsal(connection_id=doc["connection_id"], name=doc["name"], up_sql=body.fixed_sql, down_sql=body.down_sql, parent_id=rid), u)


# ---- approvals ------------------------------------------------------------------------------

def _approval_out(a: dict[str, Any]) -> dict[str, Any]:
    reh = store.get_rehearsal(a["rehearsal"]["id"])
    if reh:
        a = {**a, "rehearsal": _summary(reh)}
    return a


def _checklist(reh: dict[str, Any], requester: dict[str, Any], approver: dict[str, Any] | None) -> list[dict[str, Any]]:
    rb = reh.get("rollback") or {}
    risk_pol = policies.by_key("max_risk")
    max_risk = risk_pol["params"]["max_risk"] if risk_pol else 30
    blocking = [v for v in reh.get("policy_violations", []) if v["severity"] == "block"]
    return [
        {"label": "Rehearsal passed", "ok": reh["status"] == "passed", "detail": f"risk {reh['risk']} · {reh['status']}"},
        {"label": f"Risk at or below {max_risk}", "ok": (reh["risk"] or 0) <= max_risk, "detail": f"risk {reh['risk']}"},
        {"label": "Rollback proven identical", "ok": rb.get("status") == "passed", "detail": rb.get("message") or ("100% identical" if rb.get("identical") else "not proven")},
        {"label": "No blocking policy", "ok": not blocking, "detail": "; ".join(v["message"] for v in blocking) or None},
        {"label": "Backup will be taken first", "ok": True, "detail": "pg_dump of affected tables, restorable for 24h"},
        {"label": "Approver is not the requester", "ok": approver is None or approver["id"] != requester["id"], "detail": f"requested by {requester['name']}"},
    ]


class ApprovalRequest(BaseModel):
    comment: str | None = None


@app.post("/api/rehearsals/{rid}/request-approval")
def request_approval(rid: str, body: ApprovalRequest, u: dict = Depends(require("engineer", "approver"))) -> dict[str, Any]:
    reh = _rehearsal(rid)
    if reh["status"] != "passed":
        raise HTTPException(409, f"only a passing rehearsal can go to production (this one is {reh['status']})")
    existing = store.approval_for_rehearsal(rid)
    if existing and existing["status"] in ("pending", "approved", "applied"):
        return _approval_out(existing)
    aid = store.new_id("apr")
    conn = store.get("connections", reh["connection_id"])
    doc = {
        "id": aid,
        "rehearsal": _summary(reh),
        "status": "pending",
        "requested_by": u,
        "requested_at": store.now(),
        "decided_by": None,
        "decided_at": None,
        "comment": body.comment,
        "checklist": _checklist(reh, u, None),
        "confirm_phrase": conn["name"] if conn else "production",
        "apply": None,
    }
    store.save_approval(doc)
    store.put("approval_state", aid, {"sql_fingerprint": production.sql_fingerprint(reh["up_sql"])})
    reh["approval_status"] = "pending"
    store.save_rehearsal(reh)
    audit.record("approval.requested", actor=u["id"], target=aid, rehearsal=rid)
    _thread(agent.request_apply, aid)
    _thread(report.notify_approval, doc)
    return _approval_out(doc)


@app.get("/api/approvals")
def approvals(status: str | None = None) -> list[dict[str, Any]]:
    return [_approval_out(a) for a in store.list_approvals(status)]


def _approval(aid: str) -> dict[str, Any]:
    a = store.get("approvals", aid)
    if not a:
        raise HTTPException(404, "approval not found")
    return a


@app.get("/api/approvals/{aid}")
def get_approval(aid: str) -> dict[str, Any]:
    return _approval_out(_approval(aid))


class Decision(BaseModel):
    decision: str = Field(pattern="^(approve|reject)$")
    confirm_phrase: str = ""
    comment: str | None = None


@app.post("/api/approvals/{aid}/decide")
def decide(aid: str, body: Decision, u: dict = Depends(require("approver"))) -> dict[str, Any]:
    a = _approval(aid)
    if a["status"] != "pending":
        raise HTTPException(409, f"approval is already {a['status']}")
    reh = _rehearsal(a["rehearsal"]["id"])
    if body.decision == "approve":
        if u["id"] == a["requested_by"]["id"]:
            raise HTTPException(403, "two-person rule: you requested this change, so someone else must approve it")
        if body.confirm_phrase.strip() != a["confirm_phrase"]:
            raise HTTPException(400, f"type {a['confirm_phrase']} exactly to confirm")
        checklist = _checklist(reh, a["requested_by"], u)
        failing = [c["label"] for c in checklist if not c["ok"]]
        if failing:
            raise HTTPException(409, "cannot approve: " + "; ".join(failing))
        a.update(status="approved", decided_by=u, decided_at=store.now(), comment=body.comment or a.get("comment"), checklist=checklist)
        store.save_approval(a)
        audit.record("approval.approved", actor=u["id"], target=aid, rehearsal=reh["id"], confirm=a["confirm_phrase"])
        reh["approval_status"] = "approved"
        store.save_rehearsal(reh)
        mode = agent.release(aid, True)
        audit.record("agent.tool_approval.allow" if mode == "trueforge" else "production.apply.direct", actor=u["id"], target=aid)
    else:
        a.update(status="rejected", decided_by=u, decided_at=store.now(), comment=body.comment)
        store.save_approval(a)
        reh["approval_status"] = "rejected"
        store.save_rehearsal(reh)
        audit.record("approval.rejected", actor=u["id"], target=aid, reason=body.comment)
        agent.release(aid, False, body.comment)
    return _approval_out(_approval(aid))


@app.get("/api/approvals/{aid}/events")
async def approval_events(aid: str, request: Request) -> EventSourceResponse:
    _approval(aid)
    q = events.subscribe(f"approval:{aid}")

    async def gen() -> AsyncIterator[dict[str, str]]:
        try:
            cur = store.get("approvals", aid) or {}
            if cur.get("apply"):
                yield {"data": json.dumps({"type": "step", "run": cur["apply"]}, default=str)}
                if cur["apply"]["status"] != "running":
                    yield {"data": json.dumps({"type": "done", "run": cur["apply"]}, default=str)}
            while not await request.is_disconnected():
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=15)
                except asyncio.TimeoutError:
                    yield {"comment": "keep-alive"}
                    continue
                yield {"data": json.dumps(ev, default=str)}
        finally:
            events.unsubscribe(f"approval:{aid}", q)

    return EventSourceResponse(gen())


@app.post("/api/approvals/{aid}/restore")
def restore(aid: str, u: dict = Depends(require("approver"))) -> dict[str, Any]:
    try:
        return _approval_out(production.restore(aid, u["id"]))
    except production.ApplyRefused as e:
        raise HTTPException(409, str(e)) from e


# ---- policies / audit / integrations ------------------------------------------------------------

@app.get("/api/policies")
def get_policies() -> list[dict[str, Any]]:
    return policies.all_policies()


class PolicyUpdate(BaseModel):
    enabled: bool | None = None
    params: dict[str, Any] | None = None


@app.put("/api/policies/{pid}")
def put_policy(pid: str, body: PolicyUpdate, u: dict = Depends(require("admin"))) -> dict[str, Any]:
    p = store.get("policies", pid)
    if not p:
        raise HTTPException(404, "policy not found")
    if body.enabled is not None:
        p["enabled"] = body.enabled
    if body.params:
        p["params"].update({k: v for k, v in body.params.items() if k in p["params"]})
    store.put("policies", pid, p)
    audit.record("policy.updated", actor=u["id"], target=pid, enabled=p["enabled"], params=p["params"])
    return p


class Simulate(BaseModel):
    rehearsal_id: str


@app.post("/api/policies/simulate")
def simulate(body: Simulate) -> list[dict[str, Any]]:
    reh = _rehearsal(body.rehearsal_id)
    return policies.evaluate(reh, table_rows=store.state(reh["id"]).get("table_rows", {}))


@app.get("/api/audit")
def get_audit(limit: int = 200, action: str | None = None) -> list[dict[str, Any]]:
    return audit.list_events(min(limit, 1000), action)


@app.get("/api/audit/verify")
def verify_audit() -> dict[str, Any]:
    return audit.verify()


@app.get("/api/integrations")
def integrations() -> list[dict[str, Any]]:
    s = settings()
    tf = agent.status()
    provider_names = [((p.get("manifest") or p).get("name") or (p.get("manifest") or p).get("type")) for p in tf["providers"]]
    return [
        {"key": "truefoundry", "name": "TrueForge agent harness", "connected": tf["reachable"],
         "detail": f"{s.trueforge_base_url} · agent {s.dryrun_agent_name} · mode {s.dryrun_agent_mode}" + ("" if tf["reachable"] else f" · unreachable: {tf.get('error', '')}")},
        {"key": "llm", "name": "Model via TrueForge", "connected": bool(tf["providers"]),
         "detail": f"{s.dryrun_agent_model} · providers: {', '.join(filter(None, provider_names)) or 'none configured in TrueForge Settings → Models'}"},
        {"key": "github", "name": "GitHub", "connected": bool(s.github_token and s.github_repo), "detail": s.github_repo or "set GITHUB_TOKEN and GITHUB_REPO to post PR checks"},
        {"key": "slack", "name": "Slack", "connected": bool(s.slack_webhook_url), "detail": "approval notifications" if s.slack_webhook_url else "set SLACK_WEBHOOK_URL"},
    ]


@app.post("/api/trueforge/setup")
def trueforge_setup(u: dict = Depends(require("admin"))) -> dict[str, Any]:
    try:
        out = agent.ensure_setup()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, str(e)) from e
    audit.record("trueforge.setup", actor=u["id"], **out)
    return out
