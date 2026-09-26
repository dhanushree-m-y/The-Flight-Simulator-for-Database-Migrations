"""Guardrails for SQL written by the AI agent. Checks may only READ data; they additionally run in a
READ ONLY transaction with a statement timeout inside the sandbox clone, so this is defence in depth."""

from __future__ import annotations

import re

import sqlglot
from sqlglot import exp

FORBIDDEN_FUNCS = {
    "pg_sleep", "pg_read_file", "pg_read_binary_file", "pg_ls_dir", "pg_stat_file", "lo_import", "lo_export",
    "dblink", "dblink_exec", "pg_terminate_backend", "pg_cancel_backend", "set_config", "pg_reload_conf",
    "pg_rotate_logfile", "query_to_xml", "copy", "pg_advisory_lock", "txid_current",
}

ALLOWED_ROOTS = (exp.Select, exp.Union, exp.Intersect, exp.Except, exp.With, exp.Subquery)


class UnsafeSQL(ValueError):
    pass


def check_read_only(sql: str) -> str:
    """Return the normalised single SELECT statement, or raise UnsafeSQL explaining why it was refused."""
    text = sql.strip().rstrip(";").strip()
    if not text:
        raise UnsafeSQL("empty query")
    if ";" in _strip_literals(text):
        raise UnsafeSQL("only a single statement is allowed")
    try:
        trees = sqlglot.parse(text, read="postgres")
    except sqlglot.errors.ParseError as e:  # pragma: no cover - message passthrough
        raise UnsafeSQL(f"could not parse SQL: {str(e).splitlines()[0]}") from e
    if len(trees) != 1 or trees[0] is None:
        raise UnsafeSQL("only a single statement is allowed")
    tree = trees[0]
    if not isinstance(tree, ALLOWED_ROOTS):
        raise UnsafeSQL(f"only SELECT queries are allowed (got {tree.key.upper()})")
    for node in tree.walk():
        if isinstance(node, (exp.Insert, exp.Update, exp.Delete, exp.Merge, exp.Create, exp.Drop, exp.Alter, exp.Command, exp.Into)):
            raise UnsafeSQL(f"write operation {node.key.upper()} is not allowed in a check")
        if isinstance(node, (exp.Anonymous, exp.Func)):
            name = (node.name if isinstance(node, exp.Anonymous) else node.sql_name()).lower()
            if name in FORBIDDEN_FUNCS:
                raise UnsafeSQL(f"function {name}() is not allowed")
        if isinstance(node, exp.Table) and (node.db or "").lower() in {"pg_catalog", "information_schema"} and node.name.lower().startswith("pg_authid"):
            raise UnsafeSQL("system credential tables are not allowed")
    if re.search(r"\bfor\s+(update|share|no\s+key\s+update|key\s+share)\b", text, re.I):
        raise UnsafeSQL("row locks (FOR UPDATE/SHARE) are not allowed")
    return text


def _strip_literals(sql: str) -> str:
    sql = re.sub(r"'(?:[^']|'')*'", "''", sql)
    sql = re.sub(r"\$([A-Za-z_]*)\$.*?\$\1\$", "''", sql, flags=re.S)
    return re.sub(r"--[^\n]*", "", sql)
