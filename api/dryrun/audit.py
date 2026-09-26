"""Tamper-evident audit log: every event stores sha256(prev_hash + canonical event). Editing any past row
breaks the chain, which /api/audit/verify detects."""

from __future__ import annotations

import hashlib
import json
import threading
from typing import Any

from psycopg.types.json import Jsonb

from . import store
from .db import connect, meta_dsn

GENESIS = "0" * 64
_lock = threading.Lock()


def _digest(prev: str, ts: str, actor: str | None, action: str, target: str | None, detail: dict[str, Any]) -> str:
    canonical = json.dumps({"ts": ts, "actor": actor, "action": action, "target": target, "detail": detail}, sort_keys=True, default=str)
    return hashlib.sha256((prev + canonical).encode()).hexdigest()


def record(action: str, *, actor: str | None = None, target: str | None = None, **detail: Any) -> None:
    with _lock, connect(meta_dsn(), autocommit=False) as c:
        c.execute("LOCK TABLE audit_events IN EXCLUSIVE MODE")
        row = c.execute("SELECT hash FROM audit_events ORDER BY id DESC LIMIT 1").fetchone()
        prev = row["hash"] if row else GENESIS
        ts = store.now()
        detail = json.loads(json.dumps(detail, default=str))
        h = _digest(prev, ts, actor, action, target, detail)
        c.execute(
            "INSERT INTO audit_events (ts, actor_id, action, target, detail, prev_hash, hash) VALUES (%s,%s,%s,%s,%s,%s,%s)",
            (ts, actor, action, target, Jsonb(detail), prev, h),
        )
        c.commit()


def list_events(limit: int = 200, action: str | None = None) -> list[dict[str, Any]]:
    users = {u["id"]: u for u in store.all_docs("users")}
    with connect(meta_dsn(), autocommit=True) as c:
        if action:
            rows = c.execute("SELECT * FROM audit_events WHERE action ILIKE %s ORDER BY id DESC LIMIT %s", (f"%{action}%", limit)).fetchall()
        else:
            rows = c.execute("SELECT * FROM audit_events ORDER BY id DESC LIMIT %s", (limit,)).fetchall()
    return [
        {
            "id": r["id"],
            "ts": r["ts"],
            "actor": users.get(r["actor_id"]) if r["actor_id"] else None,
            "action": r["action"],
            "target": r["target"],
            "detail": r["detail"],
            "prev_hash": r["prev_hash"],
            "hash": r["hash"],
        }
        for r in rows
    ]


def verify() -> dict[str, Any]:
    prev = GENESIS
    n = 0
    with connect(meta_dsn(), autocommit=True) as c:
        for r in c.execute("SELECT * FROM audit_events ORDER BY id").fetchall():
            n += 1
            expected = _digest(prev, r["ts"], r["actor_id"], r["action"], r["target"], r["detail"])
            if r["prev_hash"] != prev or r["hash"] != expected:
                return {"ok": False, "events": n, "broken_at": r["id"]}
            prev = r["hash"]
    return {"ok": True, "events": n, "broken_at": None}
