"""Creating rehearsals — shared by the REST API (engineers) and the agent's nightly drift-check schedule."""

from __future__ import annotations

import threading
from typing import Any

from . import analyzer, audit, engine, store

SYSTEM_USER = {"id": "u_system", "name": "DryRun nightly drift check", "email": "dryrun@system", "role": "engineer", "initials": "DR"}


class CreateError(ValueError):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def create_rehearsal(*, connection_id: str, name: str, up_sql: str, down_sql: str | None, parent_id: str | None,
                     user: dict[str, Any], options: dict[str, Any] | None = None) -> dict[str, Any]:
    from . import agent  # late import: agent imports engine which imports service users

    conn = store.get("connections", connection_id)
    if not conn:
        raise CreateError(404, "connection not found")
    if not analyzer.split_statements(up_sql):
        raise CreateError(400, "migration has no SQL statements")
    lineage_id, version = store.new_id("lin"), 1
    if parent_id:
        parent = store.get_rehearsal(parent_id)
        if not parent:
            raise CreateError(404, "parent rehearsal not found")
        lineage_id = parent["lineage_id"]
        version = max(r["version"] for r in store.list_rehearsals(limit=100, lineage_id=lineage_id)) + 1
    rid = store.new_id("reh")
    doc = engine.new_rehearsal_doc(rid=rid, name=name.strip(), version=version, lineage_id=lineage_id, parent_id=parent_id,
                                   connection=conn, up_sql=up_sql.strip(), down_sql=(down_sql or "").strip() or None, user=user,
                                   options={"ai_checks": True, "rollback": True, **(options or {})})
    store.save_rehearsal(doc)
    store.save_state(rid, {})
    audit.record("rehearsal.started", actor=user["id"], target=rid, name=doc["name"], version=version, connection=conn["name"])
    threading.Thread(target=agent.start_rehearsal, args=(rid,), daemon=True).start()
    return engine.public(doc)
