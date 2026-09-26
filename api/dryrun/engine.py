"""The rehearsal engine. Each public function is one step the agent can take (exposed as MCP tools in
mcp_tools.py) or that direct mode runs in sequence. Production is only read (pg_dump + schema reads);
every write happens inside a throwaway sandbox clone."""

from __future__ import annotations

import re
import threading
import time
import traceback
from datetime import datetime, timezone
from typing import Any, Callable

import psycopg
from psycopg import sql

from . import analyzer, audit, events, policies, profiler, sandbox, sqlguard, store
from .config import settings
from .db import connect

STAGES = [
    ("provision", "Production copy"),
    ("snapshot", "Snapshot"),
    ("migrate", "Migration"),
    ("compare", "Compare"),
    ("ai_checks", "AI checks"),
    ("rollback", "Rollback"),
    ("report", "Report"),
]

SENSITIVE = re.compile(r"email|phone|mobile|contact|aadhaar|aadhar|pan_?no|passport|address|dob|birth|password|guardian_(phone|mobile)", re.I)


class StepError(RuntimeError):
    """A step was called out of order or with bad input; the message is shown to the agent."""


# ---------------------------------------------------------------------------------------------
# Recorder: owns the public rehearsal document while steps run, persists and streams every change.
# ---------------------------------------------------------------------------------------------

class Recorder:
    _registry: dict[str, "Recorder"] = {}
    _reg_lock = threading.Lock()

    def __init__(self, rid: str):
        doc = store.get_rehearsal(rid)
        if doc is None:
            raise StepError(f"unknown rehearsal {rid}")
        self.doc = doc
        self.lock = threading.RLock()
        self.t_start = time.perf_counter()

    @classmethod
    def of(cls, rid: str) -> "Recorder":
        with cls._reg_lock:
            r = cls._registry.get(rid)
            if r is None:
                r = cls._registry[rid] = Recorder(rid)
            return r

    @classmethod
    def forget(cls, rid: str) -> None:
        with cls._reg_lock:
            cls._registry.pop(rid, None)

    @property
    def rid(self) -> str:
        return self.doc["id"]

    def save(self) -> None:
        with self.lock:
            store.save_rehearsal(self.doc)

    def emit(self, event: dict[str, Any]) -> None:
        events.publish(f"rehearsal:{self.rid}", event)

    def log(self, level: str, source: str, message: str) -> None:
        line = {"ts": store.now(), "level": level, "source": source, "message": message}
        with self.lock:
            self.doc["logs"].append(line)
            self.doc["logs"] = self.doc["logs"][-400:]
            self.save()
        self.emit({"type": "log", "line": line})

    def stage(self, key: str, status: str, detail: str | None = None) -> None:
        with self.lock:
            st = next(s for s in self.doc["stages"] if s["key"] == key)
            if status == "running" and st["status"] != "running":
                st["started_at"] = store.now()
                st["_t0"] = time.perf_counter()
            if status in ("passed", "warning", "failed", "skipped") and st.get("_t0"):
                st["duration_ms"] = round((time.perf_counter() - st.pop("_t0")) * 1000)
            st["status"] = status
            if detail is not None:
                st["detail"] = detail
            if self.doc["status"] == "queued":
                self.doc["status"] = "running"
            self.save()
            public = {k: v for k, v in st.items() if not k.startswith("_")}
        self.emit({"type": "stage", "stage": public})

    def add_check(self, check: dict[str, Any], rows: dict[str, Any] | None = None) -> dict[str, Any]:
        check.setdefault("id", store.new_id("chk"))
        check.setdefault("table", None)
        check.setdefault("column", None)
        check.setdefault("before", None)
        check.setdefault("after", None)
        check.setdefault("sql", None)
        check.setdefault("explanation", None)
        check.setdefault("affected_rows", 0)
        check["has_rows"] = bool(rows and rows.get("rows"))
        if rows and rows.get("rows"):
            store.put_evidence(self.rid, check["id"], {"check_id": check["id"], **rows})
        with self.lock:
            self.doc["checks"].append(check)
            self.doc["metrics"]["checks_run"] = len(self.doc["checks"])
            self.doc["metrics"]["checks_total"] = max(self.doc["metrics"]["checks_total"], len(self.doc["checks"]))
            self.save()
        self.emit({"type": "check", "check": check})
        self.emit({"type": "metrics", "metrics": self.doc["metrics"]})
        return check

    def metrics(self, **kw: Any) -> None:
        with self.lock:
            self.doc["metrics"].update(kw)
            self.doc["metrics"]["elapsed_ms"] = self.elapsed_ms()
            self.save()
        self.emit({"type": "metrics", "metrics": self.doc["metrics"]})

    def elapsed_ms(self) -> int:
        started = self.doc["created_at"]
        return int((datetime.now(timezone.utc) - datetime.fromisoformat(started)).total_seconds() * 1000)

    def set(self, **kw: Any) -> None:
        with self.lock:
            self.doc.update(kw)
            self.save()


def new_rehearsal_doc(*, rid: str, name: str, version: int, lineage_id: str, parent_id: str | None, connection: dict[str, Any],
                      up_sql: str, down_sql: str | None, user: dict[str, Any], options: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": rid,
        "name": name,
        "version": version,
        "lineage_id": lineage_id,
        "parent_id": parent_id,
        "connection_id": connection["id"],
        "connection_name": connection["name"],
        "status": "queued",
        "risk": None,
        "headline": None,
        "created_by": user,
        "created_at": store.now(),
        "finished_at": None,
        "duration_ms": None,
        "approval_status": None,
        "up_sql": up_sql,
        "down_sql": down_sql,
        "options": options,
        "stages": [{"key": k, "label": l, "status": "pending", "started_at": None, "duration_ms": None, "detail": None} for k, l in STAGES],
        "metrics": {"rows_scanned": 0, "rows_total": 0, "tables": 0, "checks_run": 0, "checks_total": 0, "elapsed_ms": 0},
        "checks": [],
        "risk_parts": [],
        "locks": [],
        "rollback": None,
        "impact": [],
        "schema_diff": [],
        "logs": [],
        "ai": None,
        "sandbox": None,
        "policy_violations": [],
        "error": None,
        "agent": None,
    }


def _sb(rid: str) -> tuple[dict[str, Any], str]:
    st = store.state(rid)
    name = st.get("sandbox")
    if not name:
        raise StepError("no sandbox yet — call create_sandbox first")
    return st, sandbox.sandbox_dsn(name)


def _mask(col: str, v: Any) -> Any:
    if v is None or not SENSITIVE.search(col):
        return v
    s = str(v)
    if "@" in s:
        user, _, dom = s.partition("@")
        return f"{user[:1]}***@{dom}"
    digits = re.sub(r"\D", "", s)
    if len(digits) >= 6:
        return "•" * (len(s) - 2) + s[-2:]
    return s[:1] + "•" * max(0, len(s) - 1)


def _rows_payload(rows: list[dict[str, Any]], highlight: list[str], total: int) -> dict[str, Any]:
    cols = list(rows[0].keys()) if rows else []
    masked = any(SENSITIVE.search(c) for c in cols)
    out = []
    for r in rows:
        out.append({k: (_mask(k, v) if not isinstance(v, (int, float)) or SENSITIVE.search(k) else v) for k, v in r.items()})
        for k, v in list(out[-1].items()):
            if v is not None and not isinstance(v, (int, float, str)):
                out[-1][k] = str(v)
    return {"columns": cols, "highlight": highlight, "rows": out, "total": total, "masked": masked}


# ---------------------------------------------------------------------------------------------
# Step 0 — brief (read-only look at the job; used by the agent to plan)
# ---------------------------------------------------------------------------------------------

def brief(rid: str) -> dict[str, Any]:
    doc = store.get_rehearsal(rid)
    if not doc:
        raise StepError(f"unknown rehearsal {rid}")
    dsn = store.connection_dsn(doc["connection_id"])
    with connect(dsn, app="dryrun-brief") as c:
        c.execute("SET TRANSACTION READ ONLY")
        schema = profiler.schema_summary(c)
    stmts = analyzer.split_statements(doc["up_sql"])
    return {
        "rehearsal_id": rid,
        "migration_name": doc["name"],
        "version": doc["version"],
        "production_database": doc["connection_name"],
        "up_sql": doc["up_sql"],
        "down_sql_provided": bool(doc.get("down_sql")),
        "down_sql": doc.get("down_sql"),
        "statements": [
            {"sql": s, "tables": analyzer.tables_in(s), "locks": [lk.__dict__ for lk in analyzer.lock_for(s)]} for s in stmts
        ],
        "schema": schema,
        "static_hints": analyzer.hints(doc["up_sql"]),
        "policies": [{"title": p["title"], "severity": p["severity"], "params": p["params"]} for p in policies.all_policies() if p["enabled"]],
    }


# ---------------------------------------------------------------------------------------------
# Step 1 — sandbox clone + "before" snapshot
# ---------------------------------------------------------------------------------------------

def create_sandbox(rid: str) -> dict[str, Any]:
    rec = Recorder.of(rid)
    st = store.state(rid)
    if st.get("sandbox"):
        return {"sandbox": st["sandbox"], "note": "sandbox already exists", "tables": st.get("table_rows")}
    doc = rec.doc
    prod_dsn = store.connection_dsn(doc["connection_id"])
    name = sandbox.new_name()
    info = {"id": name, "provider": "local-postgres", "engine": "PostgreSQL", "region": "local", "status": "creating", "expires_at": sandbox.expires_at()}
    rec.set(sandbox=info)
    rec.emit({"type": "sandbox", "sandbox": info})
    rec.stage("provision", "running", "pg_dump production → sandbox")
    rec.log("info", "sandbox.create", name)
    try:
        timing = sandbox.clone(prod_dsn, name)
    except Exception as e:
        rec.stage("provision", "failed", str(e)[:200])
        rec.log("error", "sandbox.create", str(e)[:300])
        raise
    store.update_state(rid, sandbox=name, sandbox_expires=info["expires_at"])
    info["status"] = "ready"
    rec.set(sandbox=info)
    rec.emit({"type": "sandbox", "sandbox": info})
    rec.stage("provision", "passed", f"cloned in {timing['total_s']}s")
    rec.log("info", "sandbox.ready", f"{name} cloned from {doc['connection_name']} in {timing['total_s']}s")

    rec.stage("snapshot", "running", "profiling tables")
    dsn = sandbox.sandbox_dsn(name)
    with connect(dsn, autocommit=True, app="dryrun-snapshot") as c:
        tables = profiler.list_tables(c)
        prof = profiler.profile(c, tables)
        total = sum(t["rows"] for t in prof["tables"].values())
        affected = set()
        for s in analyzer.split_statements(doc["up_sql"]):
            affected.update(analyzer.tables_in(s))
        snap = [t for t in tables if total <= settings().snapshot_max_rows or t["display"] in affected or t["name"] in affected]
        c.execute(sql.SQL("CREATE SCHEMA IF NOT EXISTS {}").format(sql.Identifier(profiler.SNAPSHOT_SCHEMA)))
        for t in snap:
            c.execute(
                sql.SQL("CREATE TABLE {} AS SELECT * FROM {}").format(
                    sql.Identifier(profiler.SNAPSHOT_SCHEMA, f"{t['schema']}__{t['name']}"), profiler.ident(t["schema"], t["name"])
                )
            )
        ddl_before = {t["display"]: profiler.ddl(c, t["schema"], t["name"]) for t in tables}
    table_rows = {k: v["rows"] for k, v in prof["tables"].items()}
    store.update_state(rid, before=prof, snap_tables=[t["display"] for t in snap], ddl_before=ddl_before, table_rows=table_rows)
    rec.metrics(rows_total=total, rows_scanned=total, tables=len(tables))
    for t, n in table_rows.items():
        rec.log("info", f"snapshot.{t}", f"{n:,} rows")
    rec.stage("snapshot", "passed", f"{len(tables)} tables · {total:,} rows")
    return {
        "sandbox": name,
        "tables": table_rows,
        "total_rows": total,
        "snapshot_tables": [t["display"] for t in snap],
        "next": "call apply_migration_in_sandbox",
    }


# ---------------------------------------------------------------------------------------------
# Step 2 — apply the migration in the sandbox, measuring locks
# ---------------------------------------------------------------------------------------------

class LockMonitor(threading.Thread):
    """Polls pg_locks for the migrating backend and records how long each table lock was held."""

    def __init__(self, dsn: str, pid: int):
        super().__init__(daemon=True)
        self.dsn, self.pid = dsn, pid
        self.stop_evt = threading.Event()
        self.seen: dict[tuple[str, str], list[float]] = {}

    def run(self) -> None:
        try:
            with connect(self.dsn, autocommit=True, app="dryrun-lockmon") as c:
                while not self.stop_evt.is_set():
                    now = time.perf_counter()
                    for r in c.execute(
                        """
                        SELECT n.nspname AS schema, cl.relname AS rel, l.mode FROM pg_locks l
                        JOIN pg_class cl ON cl.oid = l.relation JOIN pg_namespace n ON n.oid = cl.relnamespace
                        WHERE l.pid = %s AND l.granted AND cl.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog', %s)
                        """,
                        (self.pid, profiler.SNAPSHOT_SCHEMA),
                    ).fetchall():
                        key = (profiler.display(r["schema"], r["rel"]), _norm_mode(r["mode"]))
                        first_last = self.seen.setdefault(key, [now, now])
                        first_last[1] = now
                    time.sleep(0.015)
        except Exception:  # noqa: BLE001 - monitoring is best-effort
            pass

    def stop(self) -> None:
        self.stop_evt.set()
        self.join(timeout=2)


MODE_RANK = ["ACCESS SHARE", "ROW SHARE", "ROW EXCLUSIVE", "SHARE UPDATE EXCLUSIVE", "SHARE", "SHARE ROW EXCLUSIVE", "EXCLUSIVE", "ACCESS EXCLUSIVE"]


def _norm_mode(m: str) -> str:
    """pg_locks reports e.g. 'AccessExclusiveLock' → 'ACCESS EXCLUSIVE'."""
    return re.sub(r"(?<!^)(?=[A-Z])", " ", m.removesuffix("Lock")).upper()


def _run_statements(dsn: str, stmts: list[str], *, tag: str) -> dict[str, Any]:
    """Execute a script. Transactional unless it contains CONCURRENTLY statements. Returns timings,
    measured locks and error diagnostics."""
    concurrent = any(analyzer.is_concurrent(s) for s in stmts)
    result: dict[str, Any] = {"ok": True, "timings": [], "locks": [], "error": None, "failed_statement": None}
    with connect(dsn, autocommit=concurrent, app=f"dryrun-{tag}") as c:
        pid = c.execute("SELECT pg_backend_pid() AS p").fetchone()["p"]
        c.execute("SET lock_timeout = '10s'")
        c.execute("SET statement_timeout = '120s'")
        mon = LockMonitor(dsn, pid)
        mon.start()
        time.sleep(0.03)
        try:
            for s in stmts:
                t0 = time.perf_counter()
                try:
                    c.execute(s, prepare=False)
                except psycopg.Error as e:
                    d = e.diag
                    result.update(
                        ok=False,
                        failed_statement=s,
                        error={
                            "sqlstate": d.sqlstate,
                            "message": d.message_primary or str(e).splitlines()[0],
                            "detail": d.message_detail,
                            "hint": d.message_hint,
                            "constraint": d.constraint_name,
                            "table": d.table_name,
                            "column": d.column_name,
                        },
                    )
                    if not concurrent:
                        c.rollback()
                    break
                result["timings"].append({"sql": s, "ms": round((time.perf_counter() - t0) * 1000, 2)})
            if result["ok"] and not concurrent:
                c.commit()
        finally:
            time.sleep(0.03)
            mon.stop()
    locks: dict[str, dict[str, Any]] = {}
    for (table, mode), (first, last) in mon.seen.items():
        dur = round((last - first) * 1000 + 15, 1)
        cur = locks.get(table)
        rank = MODE_RANK.index(mode) if mode in MODE_RANK else 0
        if cur is None or rank > MODE_RANK.index(cur["mode"]):
            locks[table] = {"table": table, "mode": mode, "duration_ms": dur}
        else:
            cur["duration_ms"] = max(cur["duration_ms"], dur)
    result["locks"] = [
        {**lk, "blocks_reads": lk["mode"] == "ACCESS EXCLUSIVE", "blocks_writes": lk["mode"] in MODE_RANK[4:], "source": "measured"}
        for lk in locks.values()
        if lk["mode"] not in ("ACCESS SHARE",)
    ]
    return result


def _merge_lock_timings(res: dict[str, Any], stmts: list[str]) -> list[dict[str, Any]]:
    """Postgres holds table locks from the statement that takes them until COMMIT. The monitor samples
    pg_locks every ~15ms and can miss fast statements, so we also derive hold time from the measured
    statement timings: a lock taken by statement i is held for the time of statements i..n."""
    locks = {lk["table"]: dict(lk) for lk in res["locks"]}
    timings = [t["ms"] for t in res["timings"]]
    for i, stmt in enumerate(stmts):
        executed = i < len(timings)
        held = sum(timings[i:]) if executed else 0.0
        for lk in analyzer.lock_for(stmt):
            if lk.table == "?":
                continue
            cur = locks.get(lk.table)
            rank = MODE_RANK.index(lk.mode) if lk.mode in MODE_RANK else 0
            entry = {"table": lk.table, "mode": lk.mode, "duration_ms": round(held, 1), "blocks_reads": lk.mode == "ACCESS EXCLUSIVE",
                     "blocks_writes": lk.mode in MODE_RANK[4:], "source": "measured" if executed else "static"}
            if cur is None:
                locks[lk.table] = entry
            elif rank > (MODE_RANK.index(cur["mode"]) if cur["mode"] in MODE_RANK else 0):
                entry["duration_ms"] = max(entry["duration_ms"], cur["duration_ms"])
                locks[lk.table] = entry
            else:
                cur["duration_ms"] = max(cur["duration_ms"], round(held, 1))
    for lk in locks.values():
        lk["blocks_reads"] = lk["mode"] == "ACCESS EXCLUSIVE"
        lk["blocks_writes"] = lk["mode"] in MODE_RANK[4:]
    return list(locks.values())


def apply_migration(rid: str) -> dict[str, Any]:
    rec = Recorder.of(rid)
    st, dsn = _sb(rid)
    if st.get("applied"):
        return {"note": "migration already applied", **st["apply_result"]}
    stmts = analyzer.split_statements(rec.doc["up_sql"])
    if not stmts:
        raise StepError("migration has no SQL statements")
    rec.stage("migrate", "running", f"{len(stmts)} statement(s)")
    rec.log("info", "migration.apply", rec.doc["name"])
    res = _run_statements(dsn, stmts, tag="migrate")
    res["locks"] = _merge_lock_timings(res, stmts)
    rec.set(locks=res["locks"])
    for lk in res["locks"]:
        rec.log("info" if lk["mode"] != "ACCESS EXCLUSIVE" else "warn", "lock.observe", f"{lk['table']} · {lk['mode']} · {lk['duration_ms']:.0f}ms ({lk['source']})")

    evidence: list[dict[str, Any]] = []
    if res["ok"]:
        total_ms = sum(t["ms"] for t in res["timings"])
        rec.add_check({"key": "migration_applied", "title": "Migration applied cleanly", "group": "constraint", "status": "pass",
                       "after": f"{len(stmts)} statement(s) in {total_ms:.0f} ms"})
        rec.stage("migrate", "passed", f"applied in {total_ms:.0f} ms")
    else:
        err = res["error"]
        rec.log("error", "migration.error", f"{err['sqlstate']} {err['message']}")
        if err.get("detail"):
            rec.log("error", "migration.error", err["detail"])
        rec.add_check({"key": "migration_applied", "title": "Migration was rejected by PostgreSQL", "group": "constraint", "status": "fail",
                       "before": "valid schema", "after": f"ERROR {err['sqlstate']}", "sql": res["failed_statement"],
                       "explanation": f"{err['message']}" + (f" — {err['detail']}" if err.get("detail") else "") +
                       ". PostgreSQL rolled the transaction back, so the sandbox is unchanged. In production this would fail mid-deploy."})
        rec.stage("migrate", "failed", f"rejected · {err['sqlstate']}")
        evidence = _probe_failure(rec, dsn, res["failed_statement"], err)
    rec.set(error=None)
    store.update_state(rid, applied=True, apply_result={k: res[k] for k in ("ok", "error", "timings", "failed_statement")})
    return {
        "ok": res["ok"],
        "error": res["error"],
        "timings_ms": [t["ms"] for t in res["timings"]],
        "locks": res["locks"],
        "evidence_checks": evidence,
        "next": "call compare_before_after" if res["ok"] else "migration failed: inspect evidence with run_sandbox_check, then call compare_before_after",
    }


def _balanced_after(text: str, start: int) -> str | None:
    i = text.find("(", start)
    if i < 0:
        return None
    depth = 0
    for j in range(i, len(text)):
        if text[j] == "(":
            depth += 1
        elif text[j] == ")":
            depth -= 1
            if depth == 0:
                return text[i + 1 : j]
    return None


def _probe_failure(rec: Recorder, dsn: str, stmt: str, err: dict[str, Any]) -> list[dict[str, Any]]:
    """Deterministic evidence for common failures: find the exact rows that break the migration."""
    code = err.get("sqlstate")
    tables = analyzer.tables_in(stmt)
    table = err.get("table") or (tables[0] if tables else None)
    out: list[dict[str, Any]] = []
    if not table:
        return out
    tid = sql.Identifier(*table.split(".")) if "." in table else sql.Identifier(table)
    limit = settings().evidence_row_limit
    try:
        with connect(dsn, autocommit=True, app="dryrun-evidence") as c:
            c.execute("SET statement_timeout = '15s'")
            if code == "23505":  # unique_violation
                m = re.search(r"Key \((.+?)\)=", err.get("detail") or "")
                cols = [x.strip().strip('"') for x in m.group(1).split(",")] if m else []
                if not cols:
                    inner = _balanced_after(stmt, re.search(r"UNIQUE|ON\s+\S+", stmt, re.I).end() if re.search(r"UNIQUE|ON\s+\S+", stmt, re.I) else 0)
                    cols = [x.strip().strip('"') for x in (inner or "").split(",") if x.strip()]
                if cols:
                    cl = sql.SQL(", ").join(sql.Identifier(x) for x in cols)
                    groups = c.execute(sql.SQL("SELECT count(*) AS g, coalesce(sum(n),0) AS r FROM (SELECT count(*) n FROM {t} WHERE ({cl}) IS NOT NULL GROUP BY {cl} HAVING count(*) > 1) x").format(t=tid, cl=cl)).fetchone()
                    rows = c.execute(sql.SQL("SELECT * FROM {t} WHERE ({cl}) IN (SELECT {cl} FROM {t} GROUP BY {cl} HAVING count(*) > 1) ORDER BY {cl} LIMIT %s").format(t=tid, cl=cl), (limit,)).fetchall()
                    probe_sql = f"SELECT {', '.join(cols)}, count(*) FROM {table} GROUP BY {', '.join(cols)} HAVING count(*) > 1;"
                    refs = _referencing_rows(c, table, rows)
                    expl = f"{groups['g']} duplicate {'/'.join(cols)} value(s) shared by {groups['r']} rows block the UNIQUE constraint."
                    if refs:
                        expl += " " + "; ".join(f"{n} {t} rows reference them" for t, n in refs.items()) + " — deleting duplicates carelessly would orphan them."
                    out.append(rec.add_check({"key": "duplicates", "title": f"Duplicate {'/'.join(cols)} in {table}", "group": "constraint", "status": "fail",
                                              "table": table, "column": cols[0], "before": f"{groups['g']} duplicate groups", "after": "UNIQUE cannot be created",
                                              "sql": probe_sql, "explanation": expl, "affected_rows": int(groups["r"])},
                                             _rows_payload(rows, cols, int(groups["r"]))))
            elif code == "23502":  # not_null_violation
                col = err.get("column") or (re.search(r'column "(.+?)"', err.get("message") or "") or [None, None])[1]
                if col:
                    n = c.execute(sql.SQL("SELECT count(*) n FROM {t} WHERE {c} IS NULL").format(t=tid, c=sql.Identifier(col))).fetchone()["n"]
                    rows = c.execute(sql.SQL("SELECT * FROM {t} WHERE {c} IS NULL LIMIT %s").format(t=tid, c=sql.Identifier(col)), (limit,)).fetchall()
                    out.append(rec.add_check({"key": "nulls", "title": f"NULL {col} values in {table}", "group": "constraint", "status": "fail", "table": table, "column": col,
                                              "before": f"{n} NULLs", "after": "NOT NULL rejected", "sql": f"SELECT * FROM {table} WHERE {col} IS NULL;",
                                              "explanation": f"{n} rows have no {col}; NOT NULL cannot be enforced until they are filled.", "affected_rows": int(n)},
                                             _rows_payload(rows, [col], int(n))))
            elif code == "23514":  # check_violation
                expr = None
                cname = err.get("constraint")
                if cname:
                    mm = re.search(rf"{re.escape(cname)}\s+CHECK\s*", stmt, re.I)
                    if mm:
                        expr = _balanced_after(stmt, mm.start())
                if expr is None:
                    mm = re.search(r"\bCHECK\s*\(", stmt, re.I)
                    expr = _balanced_after(stmt, mm.start()) if mm else None
                if expr:
                    where = sql.SQL("NOT (" + expr + ")")  # expression comes from the engineer's own migration
                    n = c.execute(sql.SQL("SELECT count(*) n FROM {t} WHERE {w}").format(t=tid, w=where)).fetchone()["n"]
                    rows = c.execute(sql.SQL("SELECT * FROM {t} WHERE {w} LIMIT %s").format(t=tid, w=where), (limit,)).fetchall()
                    cols = re.findall(r"[A-Za-z_]\w*", expr)
                    out.append(rec.add_check({"key": "check_violation", "title": f"Rows violating CHECK ({expr.strip()})", "group": "constraint", "status": "fail",
                                              "table": table, "before": f"{n} violating rows", "after": "CHECK rejected",
                                              "sql": f"SELECT * FROM {table} WHERE NOT ({expr.strip()});",
                                              "explanation": f"{n} rows in {table} already break the new rule, so PostgreSQL refuses to add it.", "affected_rows": int(n)},
                                             _rows_payload(rows, [x for x in cols if rows and x in rows[0]], int(n))))
            elif code == "22001":  # string_data_right_truncation
                mm = re.search(r"ALTER\s+COLUMN\s+(\"?[\w]+\"?)\s+(?:SET\s+DATA\s+)?TYPE\s+(?:VARCHAR|CHARACTER\s+VARYING|CHAR|CHARACTER)\s*\(\s*(\d+)\s*\)", stmt, re.I)
                if mm:
                    col, size = mm.group(1).strip('"'), int(mm.group(2))
                    n = c.execute(sql.SQL("SELECT count(*) n FROM {t} WHERE length({c}::text) > %s").format(t=tid, c=sql.Identifier(col)), (size,)).fetchone()["n"]
                    rows = c.execute(sql.SQL("SELECT * FROM {t} WHERE length({c}::text) > %s ORDER BY length({c}::text) DESC LIMIT %s").format(t=tid, c=sql.Identifier(col)), (size, limit)).fetchall()
                    out.append(rec.add_check({"key": "truncation", "title": f"{col} values longer than {size} characters", "group": "data", "status": "fail", "table": table, "column": col,
                                              "before": f"max {size}+ chars", "after": f"varchar({size})", "sql": f"SELECT * FROM {table} WHERE length({col}) > {size};",
                                              "explanation": f"{n} values would not fit in {size} characters.", "affected_rows": int(n)},
                                             _rows_payload(rows, [col], int(n))))
            elif code == "23503":  # foreign_key_violation
                mm = re.search(r'Key \((.+?)\)=\((.*?)\) is not present in table "(.+?)"', err.get("detail") or "")
                if mm:
                    cols = [x.strip().strip('"') for x in mm.group(1).split(",")]
                    parent = mm.group(3)
                    pcols = cols  # best effort: same-name keys; the agent can refine with run_sandbox_check
                    ref = _balanced_after(stmt, re.search(r"REFERENCES\s+\S+", stmt, re.I).end() - 1) if re.search(r"REFERENCES\s+\S+", stmt, re.I) else None
                    if ref:
                        pcols = [x.strip().strip('"') for x in ref.split(",")]
                    cond = sql.SQL(" AND ").join(sql.SQL("p.{} = c.{}").format(sql.Identifier(p), sql.Identifier(k)) for p, k in zip(pcols, cols))
                    notnull = sql.SQL(" AND ").join(sql.SQL("c.{} IS NOT NULL").format(sql.Identifier(k)) for k in cols)
                    q = sql.SQL("FROM {t} c WHERE {nn} AND NOT EXISTS (SELECT 1 FROM {p} p WHERE {cond})").format(t=tid, nn=notnull, p=sql.Identifier(parent), cond=cond)
                    n = c.execute(sql.SQL("SELECT count(*) n ") + q).fetchone()["n"]
                    rows = c.execute(sql.SQL("SELECT c.* ") + q + sql.SQL(" LIMIT %s"), (limit,)).fetchall()
                    out.append(rec.add_check({"key": "orphans", "title": f"{table} rows point to missing {parent}", "group": "constraint", "status": "fail", "table": table, "column": cols[0],
                                              "before": f"{n} orphan rows", "after": "FOREIGN KEY rejected", "explanation": f"{n} rows reference {parent} rows that do not exist.",
                                              "affected_rows": int(n)}, _rows_payload(rows, cols, int(n))))
    except Exception as e:  # noqa: BLE001 - evidence is best effort; the agent can still investigate
        rec.log("warn", "evidence.probe", f"automatic evidence probe failed: {str(e).splitlines()[0][:200]}")
    for chk in out:
        rec.log("warn", "evidence", f"{chk['title']} · {chk['affected_rows']} rows")
    return [{"id": x["id"], "title": x["title"], "affected_rows": x["affected_rows"], "explanation": x["explanation"]} for x in out]


def _referencing_rows(c: psycopg.Connection, table: str, rows: list[dict[str, Any]]) -> dict[str, int]:
    """How many rows in other tables reference the given rows (via declared foreign keys)."""
    if not rows:
        return {}
    out: dict[str, int] = {}
    for t in profiler.list_tables(c):
        for fk in t["fks"]:
            if fk["ref"] != table or len(fk["cols"]) != 1:
                continue
            key = fk["ref_cols"][0]
            ids = [r[key] for r in rows if key in r]
            if not ids:
                continue
            n = c.execute(sql.SQL("SELECT count(*) n FROM {t} WHERE {c} = ANY(%s)").format(t=profiler.ident(t["schema"], t["name"]), c=sql.Identifier(fk["cols"][0])), (ids,)).fetchone()["n"]
            if n:
                out[t["display"]] = int(n)
    return out


# ---------------------------------------------------------------------------------------------
# Step 3 — compare before vs after
# ---------------------------------------------------------------------------------------------

def compare(rid: str) -> dict[str, Any]:
    rec = Recorder.of(rid)
    st, dsn = _sb(rid)
    if not st.get("applied"):
        raise StepError("apply the migration first (apply_migration_in_sandbox)")
    if st.get("compared"):
        return st["compare_summary"]
    rec.stage("compare", "running", "profiling after-state")
    before = st["before"]
    applied_ok = st["apply_result"]["ok"]
    findings: list[dict[str, Any]] = []
    limit = settings().evidence_row_limit

    with connect(dsn, autocommit=True, app="dryrun-compare") as c:
        c.execute("SET statement_timeout = '60s'")
        after = profiler.profile(c)
        ddl_after = {k: profiler.ddl(c, v["schema"], v["name"]) for k, v in after["tables"].items()}
        changed_tables: set[str] = set()

        if not applied_ok:
            rec.log("info", "compare", "migration was rejected — sandbox unchanged, comparing to confirm")
            for stmt_ in analyzer.split_statements(rec.doc["up_sql"]):
                for t_ in analyzer.tables_in(stmt_):
                    if t_ in before["tables"]:
                        changed_tables.add(t_)
        # Dropped / added tables
        for t, b in before["tables"].items():
            if t not in after["tables"]:
                changed_tables.add(t)
                findings.append(rec.add_check({"key": "table_dropped", "title": f"Table {t} was dropped", "group": "data", "status": "fail", "table": t,
                                               "before": f"{b['rows']:,} rows", "after": "table gone", "affected_rows": b["rows"],
                                               "explanation": f"All {b['rows']:,} rows of {t} would be deleted permanently."}))
        for t in after["tables"]:
            if t not in before["tables"]:
                changed_tables.add(t)
                rec.log("info", "compare", f"new table {t}")

        preserved, lost_tables = [], []
        for t, b in before["tables"].items():
            a = after["tables"].get(t)
            if not a:
                continue
            meta = before["meta"][t]
            snap = sql.Identifier(profiler.SNAPSHOT_SCHEMA, f"{b['schema']}__{b['name']}")
            has_snap = t in st.get("snap_tables", [])
            pk = [k for k in b.get("pk", []) if k in a["columns"]]
            live = profiler.ident(a["schema"], a["name"])
            if ddl_after.get(t) != st["ddl_before"].get(t):
                changed_tables.add(t)
            # Row count
            if a["rows"] != b["rows"]:
                changed_tables.add(t)
                if a["rows"] < b["rows"]:
                    lost = b["rows"] - a["rows"]
                    rows, total = [], lost
                    if has_snap and pk:
                        using = sql.SQL(" AND ").join(sql.SQL("a.{k} = b.{k}").format(k=sql.Identifier(k)) for k in pk)
                        rows = c.execute(sql.SQL("SELECT b.* FROM {s} b WHERE NOT EXISTS (SELECT 1 FROM {l} a WHERE {u}) LIMIT %s").format(s=snap, l=live, u=using), (limit,)).fetchall()
                    lost_tables.append(t)
                    findings.append(rec.add_check({"key": "rows_removed", "title": f"{lost:,} rows removed from {t}", "group": "data", "status": "warn", "table": t,
                                                   "before": f"{b['rows']:,}", "after": f"{a['rows']:,}", "affected_rows": lost,
                                                   "explanation": f"The migration deletes {lost:,} rows from {t}. Make sure this is intended and recoverable."},
                                                  _rows_payload(rows, pk, total)))
                else:
                    rec.log("info", "compare", f"{t}: {a['rows'] - b['rows']:,} rows added")
            else:
                preserved.append(t)
            # Columns
            for col, bc in b["columns"].items():
                ac = a["columns"].get(col)
                if ac is None:
                    changed_tables.add(t)
                    non_null = b["rows"] - bc["nulls"]
                    findings.append(rec.add_check({"key": "column_dropped", "title": f"Column {t}.{col} dropped", "group": "data", "status": "fail" if non_null else "warn",
                                                   "table": t, "column": col, "before": f"{non_null:,} values", "after": "column gone", "affected_rows": non_null,
                                                   "explanation": f"{non_null:,} non-empty {col} values would be deleted permanently."}))
                    continue
                if ac["checksum"] == bc["checksum"]:
                    continue
                changed_tables.add(t)
                type_changed = ac["type"] != bc["type"]
                numeric = bc["category"] == "numeric" and ac["category"] == "numeric"
                changed_n, rows = None, []
                if has_snap and pk:
                    using = sql.SQL(" AND ").join(sql.SQL("a.{k} = b.{k}").format(k=sql.Identifier(k)) for k in pk)
                    ci = sql.Identifier(col)
                    cmp = (sql.SQL("b.{c}::numeric IS DISTINCT FROM a.{c}::numeric") if numeric else sql.SQL("b.{c}::text IS DISTINCT FROM a.{c}::text")).format(c=ci)
                    sel = sql.SQL(", ").join([*(sql.SQL("b.{k}").format(k=sql.Identifier(k)) for k in pk),
                                              sql.SQL("b.{c}::text AS {bn}").format(c=ci, bn=sql.Identifier(f"{col} (before)")),
                                              sql.SQL("a.{c}::text AS {an}").format(c=ci, an=sql.Identifier(f"{col} (after)"))])
                    base = sql.SQL("FROM {s} b JOIN {l} a ON {u} WHERE {cmp}").format(s=snap, l=live, u=using, cmp=cmp)
                    try:
                        changed_n = c.execute(sql.SQL("SELECT count(*) n ") + base).fetchone()["n"]
                        rows = c.execute(sql.SQL("SELECT ") + sel + sql.SQL(" ") + base + sql.SQL(" LIMIT %s"), (limit,)).fetchall()
                    except psycopg.Error:
                        changed_n = None
                if changed_n == 0:
                    rec.log("info", "compare", f"{t}.{col}: representation changed ({bc['type']} → {ac['type']}), values identical")
                    continue
                n = changed_n if changed_n is not None else b["rows"]
                if type_changed:
                    kind = "rounded" if numeric else "altered"
                    findings.append(rec.add_check({"key": "values_changed_by_type", "title": f"{n:,} {t}.{col} values {kind} by {bc['type']} → {ac['type']}",
                                                   "group": "data", "status": "fail", "table": t, "column": col, "before": bc["type"], "after": ac["type"], "affected_rows": n,
                                                   "explanation": f"Changing the type silently changes {n:,} stored values — this is data loss that PostgreSQL does not report."},
                                                  _rows_payload(rows, [f"{col} (before)", f"{col} (after)"], n)))
                else:
                    findings.append(rec.add_check({"key": "values_updated", "title": f"{n:,} {t}.{col} values updated", "group": "data", "status": "warn", "table": t, "column": col,
                                                   "before": f"{bc['distinct']} distinct", "after": f"{ac['distinct']} distinct", "affected_rows": n,
                                                   "explanation": f"The migration rewrites {n:,} values of {col}. Confirm the backfill is intended."},
                                                  _rows_payload(rows, [f"{col} (before)", f"{col} (after)"], n)))
                if ac["nulls"] > bc["nulls"]:
                    findings.append(rec.add_check({"key": "nulls_increased", "title": f"{t}.{col} gained {ac['nulls'] - bc['nulls']:,} NULLs", "group": "data", "status": "warn",
                                                   "table": t, "column": col, "before": f"{bc['nulls']:,} NULL", "after": f"{ac['nulls']:,} NULL", "affected_rows": ac["nulls"] - bc["nulls"]}))
            del meta

        # Foreign-key integrity against the BEFORE relationships
        orphan_total = 0
        for t, meta in before["meta"].items():
            if t not in after["tables"]:
                continue
            for fk in meta["fks"]:
                if fk["ref"] not in after["tables"] or len(fk["cols"]) != len(fk["ref_cols"]):
                    continue
                if not all(x in after["tables"][t]["columns"] for x in fk["cols"]):
                    continue
                child = profiler.ident(after["tables"][t]["schema"], after["tables"][t]["name"])
                parent = profiler.ident(after["tables"][fk["ref"]]["schema"], after["tables"][fk["ref"]]["name"])
                cond = sql.SQL(" AND ").join(sql.SQL("p.{} = c.{}").format(sql.Identifier(p), sql.Identifier(k)) for p, k in zip(fk["ref_cols"], fk["cols"]))
                nn = sql.SQL(" AND ").join(sql.SQL("c.{} IS NOT NULL").format(sql.Identifier(k)) for k in fk["cols"])
                q = sql.SQL("FROM {c} c WHERE {nn} AND NOT EXISTS (SELECT 1 FROM {p} p WHERE {cond})").format(c=child, nn=nn, p=parent, cond=cond)
                try:
                    n = c.execute(sql.SQL("SELECT count(*) n ") + q).fetchone()["n"]
                except psycopg.Error:
                    continue
                if n:
                    orphan_total += n
                    rows = c.execute(sql.SQL("SELECT c.* ") + q + sql.SQL(" LIMIT %s"), (limit,)).fetchall()
                    findings.append(rec.add_check({"key": "orphans_after", "title": f"{n:,} {t} rows lost their {fk['ref']}", "group": "data", "status": "fail", "table": t,
                                                   "column": fk["cols"][0], "before": "0 orphans", "after": f"{n:,} orphans", "affected_rows": n,
                                                   "explanation": f"After the migration {n:,} {t} rows point at {fk['ref']} rows that no longer exist."},
                                                  _rows_payload(rows, fk["cols"], n)))

    total_rows = sum(v["rows"] for v in after["tables"].values())
    rec.add_check({"key": "row_counts", "title": "Row counts preserved", "group": "data", "status": "pass" if not lost_tables else "warn",
                   "before": f"{sum(v['rows'] for v in before['tables'].values()):,} rows", "after": f"{total_rows:,} rows",
                   "explanation": f"{len(preserved)} of {len(before['tables'])} tables have identical row counts."})
    rec.add_check({"key": "fk_integrity", "title": "Foreign keys intact", "group": "constraint", "status": "pass" if orphan_total == 0 else "fail",
                   "before": "0 orphans", "after": f"{orphan_total:,} orphans"})

    # Impact map + schema diff
    refs = {t: sorted({fk["ref"] for fk in m["fks"]}) for t, m in {**before["meta"], **after["meta"]}.items()}
    related = {r for t in changed_tables for r in refs.get(t, [])} | {t for t, rs in refs.items() if set(rs) & changed_tables}
    impact = []
    for t in sorted(set(before["tables"]) | set(after["tables"])):
        status = "changed" if t in changed_tables else "affected" if t in related else "unchanged"
        target_note = "targeted by the rejected migration" if not applied_ok else "modified by the migration"
        rows_n = (after["tables"].get(t) or before["tables"].get(t))["rows"]
        impact.append({"name": t, "rows": rows_n, "status": status, "references": refs.get(t, []),
                       "note": None if status == "unchanged" else (target_note if status == "changed" else "linked to a changed table")})
    diffs = [{"table": t, "before": st["ddl_before"].get(t, "-- (did not exist)"), "after": ddl_after.get(t, "-- (dropped)")}
             for t in sorted(changed_tables) if st["ddl_before"].get(t) != ddl_after.get(t)]
    rec.set(impact=impact, schema_diff=diffs)
    rec.metrics(rows_scanned=sum(v["rows"] for v in before["tables"].values()) + total_rows)

    fails = [f for f in findings if f["status"] == "fail"]
    warns = [f for f in findings if f["status"] == "warn"]
    rec.stage("compare", "failed" if fails else "warning" if warns else "passed",
              f"{len(fails)} failing · {len(warns)} warnings" if (fails or warns) else "no unexpected changes")
    summary = {
        "migration_applied": applied_ok,
        "changed_tables": sorted(changed_tables),
        "findings": [{"id": f["id"], "status": f["status"], "title": f["title"], "affected_rows": f["affected_rows"]} for f in findings],
        "row_counts_after": {k: v["rows"] for k, v in after["tables"].items()},
        "next": "write targeted read-only checks with run_sandbox_check, then test_rollback, then submit_report",
    }
    store.update_state(rid, compared=True, compare_summary=summary, table_rows_after=summary["row_counts_after"])
    return summary


# ---------------------------------------------------------------------------------------------
# Step 4 — AI-authored checks (read-only, sandbox only)
# ---------------------------------------------------------------------------------------------

def sandbox_check(rid: str, *, title: str, query: str, expectation: str = "no_rows", severity: str = "fail",
                  explanation: str | None = None, table: str | None = None, source: str = "ai") -> dict[str, Any]:
    rec = Recorder.of(rid)
    st, dsn = _sb(rid)
    try:
        safe = sqlguard.check_read_only(query)
    except sqlguard.UnsafeSQL as e:
        rec.log("warn", "ai.guard", f"refused check '{title}': {e}")
        return {"refused": True, "reason": str(e), "hint": "rewrite as a single read-only SELECT"}
    ai_stage = next(s for s in rec.doc["stages"] if s["key"] == "ai_checks")
    if ai_stage["status"] == "pending":
        rec.stage("ai_checks", "running", "agent is writing checks")
    rec.log("ai", "ai.check", title)
    limit = 200
    try:
        with connect(dsn, app="dryrun-ai-check") as c:
            c.execute("SET TRANSACTION READ ONLY")
            c.execute(sql.SQL("SET LOCAL statement_timeout = {}").format(sql.Literal(settings().check_timeout_ms)))
            cur = c.execute(sql.SQL("SELECT * FROM ({}) q LIMIT %s").format(sql.SQL(safe)), (limit + 1,), prepare=False)
            rows = cur.fetchall()
            c.rollback()
    except psycopg.Error as e:
        msg = (e.diag.message_primary or str(e)).splitlines()[0]
        rec.log("warn", "ai.check", f"'{title}' errored: {msg}")
        return {"error": msg, "hint": "fix the query and call run_sandbox_check again"}
    n = len(rows)
    total = n if n <= limit else limit
    rows = rows[:limit]
    ok = (n == 0) if expectation == "no_rows" else (n > 0)
    status = "pass" if ok else ("warn" if severity == "warn" else "fail")
    note = "" if not st.get("rolled_back") else " (ran after rollback: sandbox holds the pre-migration data)"
    chk = rec.add_check(
        {"key": "ai_check", "title": title, "group": "ai" if source == "ai" else "data", "status": status, "table": table, "sql": safe,
         "before": "expect no rows" if expectation == "no_rows" else "expect rows",
         "after": f"{total}{'+' if n > limit else ''} rows", "explanation": (explanation or "") + note, "affected_rows": 0 if ok and expectation == "no_rows" else total},
        _rows_payload(rows, [], total) if rows else None,
    )
    if status != "pass":
        rec.log("warn", "ai.check", f"{title} · {total} rows")
    preview = _rows_payload(rows[:15], [], total)
    return {"check_id": chk["id"], "status": status, "row_count": total, "columns": preview["columns"], "sample_rows": preview["rows"]}


# ---------------------------------------------------------------------------------------------
# Step 5 — rollback proof
# ---------------------------------------------------------------------------------------------

def test_rollback(rid: str, down_sql: str | None = None, source: str = "user") -> dict[str, Any]:
    rec = Recorder.of(rid)
    st, dsn = _sb(rid)
    if not st.get("compared"):
        raise StepError("call compare_before_after before testing the rollback")
    if st.get("rolled_back") is not None and st.get("rollback_done"):
        return rec.doc["rollback"]
    down = (down_sql or rec.doc.get("down_sql") or "").strip()
    if not st["apply_result"]["ok"]:
        result = {"status": "skipped", "down_sql": down or None, "down_sql_source": source if down else None, "identical": True, "tables": [],
                  "message": "The migration was rejected and rolled back by PostgreSQL, so there is nothing to undo."}
        rec.set(rollback=result)
        rec.stage("rollback", "skipped", "nothing to undo")
        store.update_state(rid, rollback_done=True)
        return result
    if not down:
        raise StepError("no down migration: write the rollback SQL and pass it as down_sql")
    if source == "ai" and not rec.doc.get("down_sql"):
        rec.set(down_sql=down)
    rec.stage("rollback", "running", "applying down migration")
    rec.log("info", "rollback.apply", f"{len(analyzer.split_statements(down))} statement(s) · source={source}")
    res = _run_statements(dsn, analyzer.split_statements(down), tag="rollback")
    tables_out: list[dict[str, Any]] = []
    identical = res["ok"]
    if res["ok"]:
        with connect(dsn, autocommit=True, app="dryrun-rollback-verify") as c:
            for t in st.get("snap_tables", []):
                meta = st["before"]["meta"][t]
                snap_name = f"{meta['schema']}__{meta['name']}"
                if not profiler.table_exists(c, meta["schema"], meta["name"]):
                    tables_out.append({"table": t, "rows_before": st["before"]["tables"][t]["rows"], "rows_after": 0, "checksum_before": "", "checksum_after": "missing", "identical": False})
                    identical = False
                    continue
                cb = profiler.table_checksum(c, profiler.SNAPSHOT_SCHEMA, snap_name)
                ca = profiler.table_checksum(c, meta["schema"], meta["name"])
                ra = profiler.count_rows(c, meta["schema"], meta["name"])
                same = cb == ca
                identical &= same
                tables_out.append({"table": t, "rows_before": st["before"]["tables"][t]["rows"], "rows_after": ra, "checksum_before": cb, "checksum_after": ca, "identical": same})
            extra = [t["display"] for t in profiler.list_tables(c) if t["display"] not in st["before"]["tables"]]
            if extra:
                identical = False
                rec.log("warn", "rollback.verify", f"tables left behind after rollback: {', '.join(extra)}")
    result = {
        "status": "passed" if identical else "failed",
        "down_sql": down,
        "down_sql_source": source,
        "identical": identical,
        "tables": tables_out,
        "message": None if res["ok"] else f"Rollback SQL failed: {res['error']['message']}",
    }
    rec.set(rollback=result)
    rec.stage("rollback", "passed" if identical else "failed", "100% identical" if identical else "state differs after rollback")
    rec.log("info" if identical else "error", "rollback.verify", "restored state is byte-identical" if identical else (result["message"] or "restored state differs"))
    rec.add_check({"key": "rollback", "title": "Rollback restores the exact original data", "group": "constraint", "status": "pass" if identical else "fail",
                   "before": f"{len(tables_out)} tables fingerprinted", "after": "identical" if identical else "mismatch", "sql": down})
    store.update_state(rid, rolled_back=True, rollback_done=True)
    return {"identical": identical, "status": result["status"], "message": result["message"], "tables": [{k: t[k] for k in ("table", "rows_before", "rows_after", "identical")} for t in tables_out]}


# ---------------------------------------------------------------------------------------------
# Step 6 — report: risk score, verdict, policies
# ---------------------------------------------------------------------------------------------

def score(doc: dict[str, Any], table_rows: dict[str, int], max_lock_ms: float = 2000) -> tuple[int, list[dict[str, Any]]]:
    parts: dict[str, dict[str, Any]] = {}

    def add(kind: str, label: str, pts: float, cap: float) -> None:
        p = parts.setdefault(kind, {"label": label, "points": 0.0, "kind": kind})
        p["points"] = min(cap, p["points"] + pts)

    checks = doc["checks"]
    migration_failed = any(c["key"] == "migration_applied" and c["status"] == "fail" for c in checks)
    if migration_failed:
        add("constraint", "Rejected by PostgreSQL", 40, 60)
    for c in checks:
        if c["key"] in ("migration_applied", "row_counts", "fk_integrity", "rollback"):
            if c["key"] == "fk_integrity" and c["status"] == "fail":
                add("data_loss", "Data loss", 30, 50)
            continue
        if c["group"] == "constraint" and c["status"] == "fail":
            add("constraint", "Constraint violations", 25, 60)
        elif c["group"] == "data" and c["status"] == "fail":
            add("data_loss", "Data loss", 35 if parts.get("data_loss", {}).get("points", 0) == 0 else 10, 55)
        elif c["group"] == "data" and c["status"] == "warn":
            add("data_loss", "Data changes to review", 8, 25)
        elif c["group"] == "ai" and c["status"] == "fail":
            add("ai", "AI safety checks", 12, 30)
        elif c["group"] == "ai" and c["status"] == "warn":
            add("ai", "AI safety checks", 5, 15)
    for lk in doc.get("locks", []):
        rows_n = table_rows.get(lk["table"], 0)
        if lk["mode"] == "ACCESS EXCLUSIVE":
            add("lock", "Table locks", 15 if lk["duration_ms"] > max_lock_ms else 6 if rows_n > 10_000 else 3, 20)
        elif lk["mode"] in ("SHARE", "SHARE ROW EXCLUSIVE", "EXCLUSIVE"):
            add("lock", "Table locks", 2, 20)
    rb = doc.get("rollback")
    if rb is None:
        add("rollback", "Rollback unproven", 8, 25)
    elif rb["status"] == "failed":
        add("rollback", "Rollback failed", 25, 25)
    elif rb["status"] == "skipped":
        add("rollback", "Rollback unproven", 8, 25)
    out = [{"label": p["label"], "points": int(round(p["points"])), "kind": p["kind"]} for p in parts.values() if p["points"] > 0]
    out.sort(key=lambda p: -p["points"])
    return min(100, sum(p["points"] for p in out)), out


def default_headline(doc: dict[str, Any]) -> tuple[str, str]:
    fails = [c for c in doc["checks"] if c["status"] == "fail" and c["key"] not in ("migration_applied", "fk_integrity", "rollback")]
    warns = [c for c in doc["checks"] if c["status"] == "warn"]
    rejected = any(c["key"] == "migration_applied" and c["status"] == "fail" for c in doc["checks"])
    if fails:
        top = max(fails, key=lambda c: c["affected_rows"])
        head = f"{top['title']}" + (" — migration fails." if rejected else " — do not apply.")
        return head, top.get("explanation") or head
    if rejected:
        return "PostgreSQL rejects this migration.", "See the failing statement and error in the checks."
    if warns:
        return f"{len(warns)} change(s) need a human look.", "; ".join(c["title"] for c in warns[:3])
    return "Safe to apply — no data lost, rollback proven.", "Every table kept its rows and values; the rollback restored an identical state."


def finalize(rid: str, *, headline: str | None = None, summary: str | None = None, model: str | None = None) -> dict[str, Any]:
    rec = Recorder.of(rid)
    st = store.state(rid)
    if not st.get("compared"):
        raise StepError("call compare_before_after before submit_report")
    ai_stage = next(s for s in rec.doc["stages"] if s["key"] == "ai_checks")
    ai_checks = [c for c in rec.doc["checks"] if c["group"] == "ai"]
    if ai_stage["status"] in ("pending", "running"):
        if ai_checks:
            bad = [c for c in ai_checks if c["status"] != "pass"]
            rec.stage("ai_checks", "warning" if bad else "passed", f"{len(ai_checks)} checks · {len(bad)} flagged")
        else:
            rec.stage("ai_checks", "skipped", "no AI checks (direct mode)")
    rb_stage = next(s for s in rec.doc["stages"] if s["key"] == "rollback")
    if rb_stage["status"] == "pending":
        rec.stage("rollback", "skipped", "no rollback tested")
    rec.stage("report", "running", "scoring")
    table_rows = st.get("table_rows", {})
    lock_pol = policies.by_key("max_exclusive_lock")
    risk, parts = score(rec.doc, table_rows, lock_pol["params"]["max_lock_ms"] if lock_pol else 2000)
    rec.doc["risk"] = risk
    violations = [v for v in policies.evaluate(rec.doc, table_rows=table_rows) if v["policy_id"] != "pol_risk"]
    for v in violations:
        if v["severity"] == "block":
            parts.append({"label": v["title"], "points": 20, "kind": "policy"})
    risk = min(100, sum(p["points"] for p in parts))
    rejected = any(c["key"] == "migration_applied" and c["status"] == "fail" for c in rec.doc["checks"])
    if rejected:
        risk = max(risk, 61)
    status = "passed" if risk <= 30 else "warning" if risk <= 60 else "blocked"
    d_head, d_sum = default_headline(rec.doc)
    rec.set(
        risk=risk,
        risk_parts=parts,
        status=status,
        headline=(headline or d_head)[:200],
        ai={"headline": (headline or d_head)[:200], "summary": summary or d_sum, "model": model} if (headline or summary) else {"headline": d_head, "summary": d_sum, "model": None},
        policy_violations=violations,
        finished_at=store.now(),
        duration_ms=rec.elapsed_ms(),
    )
    rec.metrics()
    rec.stage("report", "passed", f"risk {risk} · {status}")
    rec.log("info", "report", f"verdict {status.upper()} · risk {risk}")
    audit.record("rehearsal.finished", actor=rec.doc["created_by"]["id"], target=rid, name=rec.doc["name"], version=rec.doc["version"], risk=risk, status=status)
    rec.emit({"type": "done", "rehearsal": public(rec.doc)})
    from . import report

    threading.Thread(target=report.deliver, args=(rid,), daemon=True).start()
    return {"status": status, "risk": risk, "risk_parts": parts, "policy_violations": violations}


def fail(rid: str, message: str) -> None:
    """Mark a rehearsal as errored (DryRun itself failed, not the migration)."""
    rec = Recorder.of(rid)
    for s in rec.doc["stages"]:
        if s["status"] == "running":
            rec.stage(s["key"], "failed", message[:120])
    rec.set(status="failed", error=message, finished_at=store.now(), duration_ms=rec.elapsed_ms())
    rec.log("error", "dryrun", message)
    rec.emit({"type": "done", "rehearsal": public(rec.doc)})


def cancel(rid: str) -> None:
    rec = Recorder.of(rid)
    if rec.doc["status"] not in ("queued", "running"):
        return
    for s in rec.doc["stages"]:
        if s["status"] in ("running", "pending"):
            s["status"] = "skipped"
    rec.set(status="cancelled", finished_at=store.now(), duration_ms=rec.elapsed_ms())
    rec.log("warn", "dryrun", "rehearsal cancelled by user")
    rec.emit({"type": "done", "rehearsal": public(rec.doc)})
    st = store.state(rid)
    if st.get("sandbox"):
        try:
            sandbox.destroy(st["sandbox"])
        except Exception:  # noqa: BLE001
            pass


def public(doc: dict[str, Any]) -> dict[str, Any]:
    d = {k: v for k, v in doc.items() if k != "options"}
    d["stages"] = [{k: v for k, v in s.items() if not k.startswith("_")} for s in doc["stages"]]
    return d


# ---------------------------------------------------------------------------------------------
# Direct mode: the whole pipeline without an LLM (fallback when TrueForge is unavailable)
# ---------------------------------------------------------------------------------------------

def run_direct(rid: str, on_error: Callable[[str], None] | None = None) -> None:
    try:
        rec = Recorder.of(rid)
        rec.log("warn", "agent", "running in direct mode — deterministic engine only, no AI checks")
        create_sandbox(rid)
        apply_migration(rid)
        compare(rid)
        if rec.doc.get("down_sql") or not store.state(rid)["apply_result"]["ok"]:
            test_rollback(rid)
        finalize(rid)
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        fail(rid, f"{type(e).__name__}: {e}")
        if on_error:
            on_error(str(e))
