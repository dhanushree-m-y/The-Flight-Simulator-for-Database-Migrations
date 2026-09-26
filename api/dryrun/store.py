"""Metadata persistence. Public documents are stored as JSONB whose shape matches web/src/lib/types.ts;
private engine state (sandbox names, snapshots, agent session ids) lives in separate tables and never
leaves the API."""

from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timezone
from typing import Any

from psycopg.types.json import Jsonb

from .config import settings
from .db import connect, database_of, ensure_database, meta_dsn

SCHEMA = """
CREATE TABLE IF NOT EXISTS users        (id text PRIMARY KEY, doc jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS connections  (id text PRIMARY KEY, doc jsonb NOT NULL, dsn text NOT NULL);
CREATE TABLE IF NOT EXISTS rehearsals   (id text PRIMARY KEY, lineage_id text NOT NULL, created_at timestamptz NOT NULL, doc jsonb NOT NULL);
CREATE INDEX IF NOT EXISTS rehearsals_lineage ON rehearsals (lineage_id, created_at);
CREATE TABLE IF NOT EXISTS rehearsal_state (id text PRIMARY KEY, doc jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS evidence_rows (rehearsal_id text NOT NULL, check_id text NOT NULL, doc jsonb NOT NULL, PRIMARY KEY (rehearsal_id, check_id));
CREATE TABLE IF NOT EXISTS approvals    (id text PRIMARY KEY, rehearsal_id text NOT NULL, created_at timestamptz NOT NULL, doc jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS approval_state (id text PRIMARY KEY, doc jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS policies     (id text PRIMARY KEY, doc jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS audit_events (
  id bigserial PRIMARY KEY, ts text NOT NULL, actor_id text, action text NOT NULL, target text,
  detail jsonb NOT NULL, prev_hash text NOT NULL, hash text NOT NULL
);
"""

_lock = threading.Lock()


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def init() -> None:
    s = settings()
    admin = s.dryrun_sandbox_admin_dsn or s.dryrun_prod_dsn
    if not s.dryrun_meta_dsn and admin:
        ensure_database(admin, database_of(meta_dsn()))
    with connect(meta_dsn(), autocommit=True) as c:
        c.execute(SCHEMA)


def _q(sql: str, params: tuple = (), *, one: bool = False, write: bool = False):
    with connect(meta_dsn(), autocommit=True) as c:
        cur = c.execute(sql, params)
        if write and cur.description is None:
            return None
        rows = cur.fetchall()
        return (rows[0] if rows else None) if one else rows


# ---- generic doc tables ---------------------------------------------------------------------

def put(table: str, id_: str, doc: dict[str, Any], **cols: Any) -> None:
    names = ["id", "doc", *cols.keys()]
    vals = [id_, Jsonb(doc), *cols.values()]
    updates = ", ".join(f"{n} = EXCLUDED.{n}" for n in names[1:])
    _q(
        f"INSERT INTO {table} ({', '.join(names)}) VALUES ({', '.join(['%s'] * len(names))}) "
        f"ON CONFLICT (id) DO UPDATE SET {updates}",
        tuple(vals),
        write=True,
    )


def get(table: str, id_: str) -> dict[str, Any] | None:
    row = _q(f"SELECT doc FROM {table} WHERE id = %s", (id_,), one=True)
    return row["doc"] if row else None


def all_docs(table: str, order: str = "id") -> list[dict[str, Any]]:
    return [r["doc"] for r in _q(f"SELECT doc FROM {table} ORDER BY {order}")]


# ---- rehearsals -----------------------------------------------------------------------------

def save_rehearsal(doc: dict[str, Any]) -> None:
    put("rehearsals", doc["id"], doc, lineage_id=doc["lineage_id"], created_at=doc["created_at"])


def get_rehearsal(id_: str) -> dict[str, Any] | None:
    return get("rehearsals", id_)


def list_rehearsals(limit: int = 50, status: str | None = None, lineage_id: str | None = None) -> list[dict[str, Any]]:
    where, params = [], []
    if status:
        where.append("doc->>'status' = %s")
        params.append(status)
    if lineage_id:
        where.append("lineage_id = %s")
        params.append(lineage_id)
    clause = ("WHERE " + " AND ".join(where)) if where else ""
    order = "created_at ASC" if lineage_id else "created_at DESC"
    rows = _q(f"SELECT doc FROM rehearsals {clause} ORDER BY {order} LIMIT %s", (*params, limit))
    return [r["doc"] for r in rows]


def state(rid: str) -> dict[str, Any]:
    return get("rehearsal_state", rid) or {}


def save_state(rid: str, doc: dict[str, Any]) -> None:
    put("rehearsal_state", rid, doc)


def update_state(rid: str, **fields: Any) -> dict[str, Any]:
    with _lock:
        s = state(rid)
        s.update(fields)
        save_state(rid, s)
        return s


def put_evidence(rid: str, check_id: str, doc: dict[str, Any]) -> None:
    _q(
        "INSERT INTO evidence_rows (rehearsal_id, check_id, doc) VALUES (%s, %s, %s) "
        "ON CONFLICT (rehearsal_id, check_id) DO UPDATE SET doc = EXCLUDED.doc",
        (rid, check_id, Jsonb(doc)),
        write=True,
    )


def get_evidence(rid: str, check_id: str) -> dict[str, Any] | None:
    row = _q("SELECT doc FROM evidence_rows WHERE rehearsal_id = %s AND check_id = %s", (rid, check_id), one=True)
    return row["doc"] if row else None


# ---- approvals ------------------------------------------------------------------------------

def save_approval(doc: dict[str, Any]) -> None:
    put("approvals", doc["id"], doc, rehearsal_id=doc["rehearsal"]["id"], created_at=doc["requested_at"])


def list_approvals(status: str | None = None) -> list[dict[str, Any]]:
    if status:
        rows = _q("SELECT doc FROM approvals WHERE doc->>'status' = %s ORDER BY created_at DESC", (status,))
    else:
        rows = _q("SELECT doc FROM approvals ORDER BY created_at DESC")
    return [r["doc"] for r in rows]


def approval_for_rehearsal(rid: str) -> dict[str, Any] | None:
    row = _q("SELECT doc FROM approvals WHERE rehearsal_id = %s ORDER BY created_at DESC LIMIT 1", (rid,), one=True)
    return row["doc"] if row else None


# ---- connections ----------------------------------------------------------------------------

def save_connection(doc: dict[str, Any], dsn: str) -> None:
    put("connections", doc["id"], doc, dsn=dsn)


def connection_dsn(cid: str) -> str | None:
    row = _q("SELECT dsn FROM connections WHERE id = %s", (cid,), one=True)
    return row["dsn"] if row else None


def dumps(o: Any) -> str:
    return json.dumps(o, default=str)
