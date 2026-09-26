"""Safety policies evaluated against every rehearsal and again at approval time."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from . import store

IST = timezone(timedelta(hours=5, minutes=30))

DEFAULTS: list[dict[str, Any]] = [
    {
        "id": "pol_lock",
        "key": "max_exclusive_lock",
        "title": "Block long exclusive locks on busy tables",
        "description": "An ACCESS EXCLUSIVE lock blocks every read and write. Block migrations that would hold one longer than the limit on a table above the row threshold.",
        "severity": "block",
        "enabled": True,
        "params": {"max_lock_ms": 2000, "min_rows": 1000},
    },
    {
        "id": "pol_rollback",
        "key": "require_rollback",
        "title": "Require a proven rollback",
        "description": "Production apply needs a rollback that restored the sandbox to a byte-identical state.",
        "severity": "review",
        "enabled": True,
        "params": {},
    },
    {
        "id": "pol_destructive",
        "key": "destructive_ddl",
        "title": "Destructive DDL needs review",
        "description": "DROP TABLE, DROP COLUMN and TRUNCATE remove data permanently and always require human review.",
        "severity": "review",
        "enabled": True,
        "params": {},
    },
    {
        "id": "pol_peak",
        "key": "peak_hours",
        "title": "No exclusive locks during hostel peak hours",
        "description": "Avoid table-blocking migrations while students check in and pay fees (IST).",
        "severity": "review",
        "enabled": True,
        "params": {"start_hour": 9, "end_hour": 21},
    },
    {
        "id": "pol_risk",
        "key": "max_risk",
        "title": "Production apply risk ceiling",
        "description": "Only rehearsals at or below this risk score can be approved for production.",
        "severity": "block",
        "enabled": True,
        "params": {"max_risk": 30},
    },
    {
        "id": "pol_two_person",
        "key": "two_person",
        "title": "Two-person rule",
        "description": "The person who requested a production change cannot approve it.",
        "severity": "block",
        "enabled": True,
        "params": {},
    },
]


def seed() -> None:
    existing = {p["id"] for p in store.all_docs("policies")}
    for p in DEFAULTS:
        if p["id"] not in existing:
            store.put("policies", p["id"], p)


def all_policies() -> list[dict[str, Any]]:
    order = {p["id"]: i for i, p in enumerate(DEFAULTS)}
    return sorted(store.all_docs("policies"), key=lambda p: order.get(p["id"], 99))


def by_key(key: str) -> dict[str, Any] | None:
    return next((p for p in all_policies() if p["key"] == key and p["enabled"]), None)


def evaluate(doc: dict[str, Any], *, statements: list[str] | None = None, table_rows: dict[str, int] | None = None) -> list[dict[str, Any]]:
    """Return policy violations for a finished rehearsal document."""
    out: list[dict[str, Any]] = []
    table_rows = table_rows or {}
    up = (doc.get("up_sql") or "").upper()
    for p in all_policies():
        if not p["enabled"]:
            continue
        k, prm = p["key"], p["params"]
        if k == "max_exclusive_lock":
            for lk in doc.get("locks", []):
                if lk["mode"] == "ACCESS EXCLUSIVE" and lk["duration_ms"] > prm["max_lock_ms"] and table_rows.get(lk["table"], 0) >= prm["min_rows"]:
                    out.append(_v(p, f"{lk['table']} held ACCESS EXCLUSIVE for {lk['duration_ms']:.0f} ms (limit {prm['max_lock_ms']} ms)"))
        elif k == "require_rollback":
            rb = doc.get("rollback") or {}
            if doc.get("status") != "blocked" and rb.get("status") != "passed":
                out.append(_v(p, "No rollback has been proven identical yet"))
        elif k == "destructive_ddl":
            import re

            if re.search(r"\bDROP\s+(TABLE|COLUMN)\b|\bTRUNCATE\b", up):
                out.append(_v(p, "Migration contains DROP/TRUNCATE"))
        elif k == "peak_hours":
            h = datetime.now(IST).hour
            exclusive = any(lk["mode"] == "ACCESS EXCLUSIVE" for lk in doc.get("locks", []))
            if exclusive and prm["start_hour"] <= h < prm["end_hour"]:
                out.append(_v(p, f"Takes ACCESS EXCLUSIVE locks and it is {h:02d}:00 IST (peak {prm['start_hour']:02d}–{prm['end_hour']:02d})"))
        elif k == "max_risk":
            if (doc.get("risk") or 0) > prm["max_risk"]:
                out.append(_v(p, f"Risk {doc.get('risk')} is above the production ceiling of {prm['max_risk']}"))
    return out


def _v(p: dict[str, Any], message: str) -> dict[str, Any]:
    return {"policy_id": p["id"], "title": p["title"], "severity": p["severity"], "message": message}
