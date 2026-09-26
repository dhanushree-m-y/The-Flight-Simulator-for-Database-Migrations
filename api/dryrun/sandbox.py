"""Sandbox databases: a throwaway clone of production per rehearsal. Production is only ever READ here
(pg_dump); every write happens in the clone, which is dropped when its TTL expires."""

from __future__ import annotations

import secrets
import subprocess
import time
from datetime import datetime, timedelta, timezone

from psycopg import sql

from .config import settings
from .db import connect, libpq_env, with_database

PREFIX = "dryrun_sbx_"


class SandboxError(RuntimeError):
    pass


def new_name() -> str:
    return PREFIX + secrets.token_hex(3)


def admin_dsn() -> str:
    s = settings()
    dsn = s.dryrun_sandbox_admin_dsn or s.dryrun_prod_dsn
    if not dsn:
        raise SandboxError("DRYRUN_SANDBOX_ADMIN_DSN is not configured")
    return dsn


def sandbox_dsn(name: str) -> str:
    return with_database(admin_dsn(), name)


def clone(prod_dsn: str, name: str) -> dict:
    """CREATE DATABASE <name>, then stream pg_dump(prod) → pg_restore(sandbox). Returns timing info."""
    s = settings()
    t0 = time.perf_counter()
    with connect(with_database(admin_dsn(), "postgres"), autocommit=True) as c:
        c.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
    t_create = time.perf_counter() - t0

    dump = subprocess.Popen(
        [s.pg_tool("pg_dump"), "--format=custom", "--no-owner", "--no-privileges", "--no-comments"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=libpq_env(prod_dsn),
    )
    restore = subprocess.run(
        [s.pg_tool("pg_restore"), "--no-owner", "--no-privileges", "--exit-on-error", "--dbname", name],
        stdin=dump.stdout,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env={**libpq_env(sandbox_dsn(name)), "PGDATABASE": name},
    )
    dump.stdout.close()  # type: ignore[union-attr]
    dump_err = dump.stderr.read().decode(errors="replace") if dump.stderr else ""
    dump.wait()
    if dump.returncode != 0:
        destroy(name)
        raise SandboxError(f"pg_dump failed: {dump_err.strip()[:400]}")
    if restore.returncode != 0:
        destroy(name)
        raise SandboxError(f"pg_restore failed: {restore.stderr.decode(errors='replace').strip()[:400]}")
    return {"create_s": round(t_create, 3), "total_s": round(time.perf_counter() - t0, 3)}


def destroy(name: str) -> None:
    if not name.startswith(PREFIX):
        raise SandboxError("refusing to drop a database that is not a DryRun sandbox")
    with connect(with_database(admin_dsn(), "postgres"), autocommit=True) as c:
        c.execute(sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(name)))


def expires_at() -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=settings().sandbox_ttl_minutes)).isoformat()


def reap_expired(active: dict[str, str]) -> list[str]:
    """Drop sandboxes whose TTL passed. `active` maps sandbox name → expires_at ISO string."""
    dropped = []
    now = datetime.now(timezone.utc)
    with connect(with_database(admin_dsn(), "postgres"), autocommit=True) as c:
        names = [r["datname"] for r in c.execute("SELECT datname FROM pg_database WHERE datname LIKE %s", (PREFIX + "%",)).fetchall()]
    for n in names:
        exp = active.get(n)
        if exp is None or datetime.fromisoformat(exp) < now:
            try:
                destroy(n)
                dropped.append(n)
            except Exception:  # noqa: BLE001 - best-effort janitor
                pass
    return dropped
