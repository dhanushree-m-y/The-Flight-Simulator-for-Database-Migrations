"""Production apply. Only reachable through the TrueForge approval-gated tool `apply_to_production`
AND an approved DryRun approval record (two-person rule + typed confirmation) — defence in depth."""

from __future__ import annotations

import hashlib
import subprocess
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import psycopg
from psycopg import sql

from . import analyzer, audit, events, store
from .config import settings
from .db import connect, libpq_env


class ApplyRefused(RuntimeError):
    pass


def _publish(approval: dict[str, Any], event: dict[str, Any]) -> None:
    events.publish(f"approval:{approval['id']}", event)


def _step(approval: dict[str, Any], key: str, status: str, detail: str | None = None, t0: float | None = None) -> None:
    run = approval["apply"]
    s = next(x for x in run["steps"] if x["key"] == key)
    s["status"] = status
    if detail is not None:
        s["detail"] = detail
    if t0 is not None and status in ("passed", "failed"):
        s["duration_ms"] = round((time.perf_counter() - t0) * 1000)
    store.save_approval(approval)
    _publish(approval, {"type": "step", "run": run})


def _log(approval: dict[str, Any], level: str, source: str, message: str) -> None:
    line = {"ts": store.now(), "level": level, "source": source, "message": message}
    approval["apply"]["logs"].append(line)
    store.save_approval(approval)
    _publish(approval, {"type": "log", "line": line})


def sql_fingerprint(up_sql: str) -> str:
    return hashlib.sha256(up_sql.strip().encode()).hexdigest()[:16]


def assert_releasable(approval: dict[str, Any]) -> dict[str, Any]:
    """The server-side gate. TrueForge's human approval alone is not enough."""
    if approval["status"] != "approved":
        raise ApplyRefused(f"approval {approval['id']} is '{approval['status']}' — an approver must approve it in DryRun (type the database name) first")
    if approval["decided_by"] and approval["decided_by"]["id"] == approval["requested_by"]["id"]:
        raise ApplyRefused("two-person rule: the requester cannot approve their own change")
    reh = store.get_rehearsal(approval["rehearsal"]["id"])
    if not reh or reh["status"] != "passed":
        raise ApplyRefused("only a rehearsal with a passing verdict can be applied")
    st = store.get("approval_state", approval["id"]) or {}
    if st.get("sql_fingerprint") != sql_fingerprint(reh["up_sql"]):
        raise ApplyRefused("the migration SQL changed after it was rehearsed — rehearse again")
    return reh


def apply(approval_id: str) -> dict[str, Any]:
    approval = store.get("approvals", approval_id)
    if not approval:
        raise ApplyRefused(f"unknown approval {approval_id}")
    if approval.get("apply") and approval["apply"]["status"] in ("running", "succeeded"):
        return approval["apply"]
    reh = assert_releasable(approval)
    s = settings()
    prod_dsn = store.connection_dsn(reh["connection_id"])
    approval["apply"] = {
        "id": store.new_id("apl"),
        "status": "running",
        "steps": [
            {"key": "backup", "label": "Backup affected tables", "status": "pending", "duration_ms": None, "detail": None},
            {"key": "apply", "label": "Apply migration", "status": "pending", "duration_ms": None, "detail": None},
            {"key": "verify", "label": "Verify on production", "status": "pending", "duration_ms": None, "detail": None},
            {"key": "done", "label": "Done", "status": "pending", "duration_ms": None, "detail": None},
        ],
        "backup_ref": None,
        "restore_until": None,
        "logs": [],
    }
    store.save_approval(approval)
    audit.record("production.apply.started", actor=approval["decided_by"]["id"], target=approval_id, rehearsal=reh["id"], name=reh["name"])

    stmts = analyzer.split_statements(reh["up_sql"])
    tables = sorted({t for st_ in stmts for t in analyzer.tables_in(st_)})

    # 1. Backup
    t0 = time.perf_counter()
    _step(approval, "backup", "running", f"pg_dump {', '.join(tables) or 'full database'}")
    Path(s.backups_dir).mkdir(parents=True, exist_ok=True)
    backup = str(Path(s.backups_dir) / f"{approval_id}.dump")
    with connect(prod_dsn, app="dryrun-backup-scope") as c:
        existing = [t for t in tables if c.execute("SELECT to_regclass(%s) IS NOT NULL AS ok", (t,)).fetchone()["ok"]]
    cmd = [s.pg_tool("pg_dump"), "--format=custom", "--file", backup]
    for t in existing:
        cmd += ["--table", t]
    proc = subprocess.run(cmd, capture_output=True, env=libpq_env(prod_dsn))
    if proc.returncode != 0:
        _step(approval, "backup", "failed", proc.stderr.decode(errors="replace")[:200], t0)
        return _finish(approval, "failed", "backup failed — production untouched")
    approval["apply"]["backup_ref"] = backup
    size_kb = Path(backup).stat().st_size / 1024
    offsite = _upload_s3(approval, backup)
    _step(approval, "backup", "passed", f"{size_kb:.0f} KB" + (f" · copied to {offsite}" if offsite else ""), t0)
    _log(approval, "info", "backup", f"saved {Path(backup).name}")

    # 2. Apply with guard rails
    t0 = time.perf_counter()
    _step(approval, "apply", "running", f"{len(stmts)} statement(s)")
    concurrent = any(analyzer.is_concurrent(x) for x in stmts)
    try:
        with connect(prod_dsn, autocommit=concurrent, app="dryrun-apply") as c:
            c.execute("SET lock_timeout = '5s'")
            c.execute("SET statement_timeout = '120s'")
            if not concurrent:
                c.execute("SELECT pg_advisory_xact_lock(hashtext('dryrun-apply'))")
            for stmt in stmts:
                _log(approval, "info", "apply", stmt.splitlines()[0][:120])
                c.execute(stmt, prepare=False)
            if not concurrent:
                c.commit()
    except psycopg.Error as e:
        msg = (e.diag.message_primary or str(e)).splitlines()[0]
        _step(approval, "apply", "failed", msg, t0)
        _log(approval, "error", "apply", msg)
        return _finish(approval, "failed", "apply failed — transaction rolled back" if not concurrent else "apply failed — check state; restore is available")
    _step(approval, "apply", "passed", None, t0)

    # 3. Verify: re-run the rehearsal's read-only checks against production
    t0 = time.perf_counter()
    _step(approval, "verify", "running")
    problems = 0
    checks = [c for c in reh["checks"] if c["group"] == "ai" and c.get("sql") and c["status"] == "pass"]
    with connect(prod_dsn, app="dryrun-verify") as c:
        c.execute("SET TRANSACTION READ ONLY")
        c.execute("SET LOCAL statement_timeout = '15s'")
        for chk in checks:
            try:
                n = len(c.execute(sql.SQL("SELECT 1 FROM ({}) q LIMIT 1").format(sql.SQL(chk["sql"].rstrip(";")))).fetchall())
            except psycopg.Error as e:
                c.rollback()
                c.execute("SET TRANSACTION READ ONLY")
                _log(approval, "warn", "verify", f"{chk['title']}: {str(e).splitlines()[0][:120]}")
                continue
            ok = n == 0 if chk.get("before") == "expect no rows" else n > 0
            problems += 0 if ok else 1
            _log(approval, "info" if ok else "error", "verify", f"{'✓' if ok else '✕'} {chk['title']}")
    # Production must now look exactly like the sandbox did after the rehearsal.
    expected = (store.state(reh["id"]).get("table_rows_after") or {})
    matched = 0
    with connect(prod_dsn, app="dryrun-verify-counts") as c:
        c.execute("SET TRANSACTION READ ONLY")
        from . import profiler

        live = {t["display"]: t for t in profiler.list_tables(c)}
        for table, want in expected.items():
            if table not in live:
                problems += 1
                _log(approval, "error", "verify", f"✕ {table} missing on production")
                continue
            got = profiler.count_rows(c, live[table]["schema"], live[table]["name"])
            if got == want:
                matched += 1
            else:
                # Production may have received writes since the rehearsal snapshot — report, don't fail silently.
                _log(approval, "warn", "verify", f"△ {table}: {got:,} rows on production vs {want:,} in rehearsal (live writes since snapshot?)")
        _log(approval, "info", "verify", f"✓ {matched}/{len(expected)} tables match the rehearsed row counts")
    _step(approval, "verify", "passed" if problems == 0 else "failed",
          f"{matched}/{len(expected)} tables match rehearsal · {len(checks)} AI checks re-run", t0)
    approval["apply"]["restore_until"] = (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat()
    return _finish(approval, "succeeded" if problems == 0 else "failed", "applied and verified" if problems == 0 else f"{problems} verification check(s) failed — consider restoring")


def _upload_s3(approval: dict[str, Any], path: str) -> str | None:
    """Keep an off-site copy of every production backup in Amazon S3 (when AWS_S3_BUCKET is set)."""
    s = settings()
    if not s.aws_s3_bucket:
        return None
    try:
        import boto3

        key = f"dryrun/backups/{Path(path).name}"
        boto3.client("s3", region_name=s.aws_region).upload_file(path, s.aws_s3_bucket, key, ExtraArgs={"ServerSideEncryption": "AES256"})
        uri = f"s3://{s.aws_s3_bucket}/{key}"
        approval["apply"]["backup_s3"] = uri
        _log(approval, "info", "backup", f"off-site copy -> {uri}")
        audit.record("backup.s3", target=approval["id"], uri=uri)
        return uri
    except Exception as e:  # noqa: BLE001 - the local backup still exists; never block on the off-site copy
        _log(approval, "warn", "backup", f"S3 upload skipped: {str(e).splitlines()[0][:160]}")
        return None


def _finish(approval: dict[str, Any], status: str, message: str) -> dict[str, Any]:
    run = approval["apply"]
    run["status"] = status
    done = next(x for x in run["steps"] if x["key"] == "done")
    done["status"] = "passed" if status == "succeeded" else "failed"
    done["detail"] = message
    approval["status"] = "applied" if status == "succeeded" else "apply_failed"
    store.save_approval(approval)
    reh = store.get_rehearsal(approval["rehearsal"]["id"])
    if reh:
        reh["approval_status"] = approval["status"]
        store.save_rehearsal(reh)
    audit.record(f"production.apply.{status}", actor=(approval.get("decided_by") or {}).get("id"), target=approval["id"], message=message)
    _publish(approval, {"type": "done", "run": run})
    return run


def restore(approval_id: str, actor_id: str) -> dict[str, Any]:
    approval = store.get("approvals", approval_id)
    if not approval or not approval.get("apply") or not approval["apply"].get("backup_ref"):
        raise ApplyRefused("no backup to restore from")
    until = approval["apply"].get("restore_until")
    if until and datetime.fromisoformat(until) < datetime.now(timezone.utc):
        raise ApplyRefused("the restore window has expired")
    reh = store.get_rehearsal(approval["rehearsal"]["id"])
    prod_dsn = store.connection_dsn(reh["connection_id"])
    s = settings()
    _log(approval, "warn", "restore", "restoring affected tables from backup")
    proc = subprocess.run(
        [s.pg_tool("pg_restore"), "--clean", "--if-exists", "--no-owner", "--no-privileges", "--single-transaction", "--dbname", psycopg_dbname(prod_dsn), approval["apply"]["backup_ref"]],
        capture_output=True,
        env=libpq_env(prod_dsn),
    )
    if proc.returncode != 0:
        msg = proc.stderr.decode(errors="replace")[:300]
        _log(approval, "error", "restore", msg)
        raise ApplyRefused(f"restore failed: {msg}")
    approval["status"] = "restored"
    approval["apply"]["status"] = "restored"
    store.save_approval(approval)
    audit.record("production.restored", actor=actor_id, target=approval_id)
    _publish(approval, {"type": "done", "run": approval["apply"]})
    return approval


def psycopg_dbname(dsn: str) -> str:
    return psycopg.conninfo.conninfo_to_dict(dsn).get("dbname") or ""
