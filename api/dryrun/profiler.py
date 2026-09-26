"""Database introspection and profiling — the "before" and "after" photos of a rehearsal."""

from __future__ import annotations

from typing import Any

import psycopg
from psycopg import sql

SNAPSHOT_SCHEMA = "_dryrun_before"
SYSTEM_SCHEMAS = ("pg_catalog", "information_schema", "pg_toast", SNAPSHOT_SCHEMA)
NUMERIC_TYPES = {"smallint", "integer", "bigint", "numeric", "real", "double precision", "money"}
TEXT_TYPES = {"text", "character varying", "character", "citext"}


def display(schema: str, table: str) -> str:
    return table if schema == "public" else f"{schema}.{table}"


def ident(schema: str, table: str) -> sql.Composed:
    return sql.Identifier(schema, table)


def list_tables(c: psycopg.Connection) -> list[dict[str, Any]]:
    rows = c.execute(
        """
        SELECT n.nspname AS schema, cl.relname AS name, cl.oid, GREATEST(cl.reltuples, 0)::bigint AS est
        FROM pg_class cl JOIN pg_namespace n ON n.oid = cl.relnamespace
        WHERE cl.relkind IN ('r','p') AND n.nspname <> ALL(%s) AND n.nspname NOT LIKE 'pg_temp%%'
        ORDER BY n.nspname, cl.relname
        """,
        (list(SYSTEM_SCHEMAS),),
    ).fetchall()
    tables = []
    for r in rows:
        cols = c.execute(
            """
            SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, t.typname AS udt,
                   NOT a.attnotnull AS nullable, pg_get_expr(d.adbin, d.adrelid) AS "default",
                   CASE WHEN t.typcategory = 'N' THEN 'numeric' WHEN t.typcategory = 'S' THEN 'text' ELSE 'other' END AS category
            FROM pg_attribute a JOIN pg_type t ON t.oid = a.atttypid
            LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
            WHERE a.attrelid = %s AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum
            """,
            (r["oid"],),
        ).fetchall()
        pk = c.execute(
            """
            SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
            WHERE i.indrelid = %s AND i.indisprimary ORDER BY array_position(i.indkey, a.attnum)
            """,
            (r["oid"],),
        ).fetchall()
        fks = c.execute(
            """
            SELECT con.conname AS name, rn.nspname AS ref_schema, rc.relname AS ref_table,
                   ARRAY(SELECT attname FROM pg_attribute WHERE attrelid = con.conrelid AND attnum = ANY(con.conkey)) AS cols,
                   ARRAY(SELECT attname FROM pg_attribute WHERE attrelid = con.confrelid AND attnum = ANY(con.confkey)) AS ref_cols
            FROM pg_constraint con JOIN pg_class rc ON rc.oid = con.confrelid JOIN pg_namespace rn ON rn.oid = rc.relnamespace
            WHERE con.conrelid = %s AND con.contype = 'f'
            """,
            (r["oid"],),
        ).fetchall()
        tables.append(
            {
                "schema": r["schema"],
                "name": r["name"],
                "display": display(r["schema"], r["name"]),
                "est_rows": int(r["est"]),
                "columns": [dict(x) for x in cols],
                "pk": [x["attname"] for x in pk],
                "fks": [
                    {"name": f["name"], "cols": list(f["cols"]), "ref": display(f["ref_schema"], f["ref_table"]),
                     "ref_schema": f["ref_schema"], "ref_table": f["ref_table"], "ref_cols": list(f["ref_cols"])}
                    for f in fks
                ],
            }
        )
    return tables


def count_rows(c: psycopg.Connection, schema: str, table: str) -> int:
    return int(c.execute(sql.SQL("SELECT count(*) AS n FROM {}").format(ident(schema, table))).fetchone()["n"])


def profile_table(c: psycopg.Connection, t: dict[str, Any], exact_distinct_limit: int = 1_000_000) -> dict[str, Any]:
    """Per-column facts plus an order-independent fingerprint of each column's values."""
    rows = count_rows(c, t["schema"], t["name"])
    parts: list[sql.Composable] = []
    for col in t["columns"]:
        cid = sql.Identifier(col["name"])
        parts.append(sql.SQL("count(*) FILTER (WHERE {c} IS NULL)").format(c=cid))
        if rows <= exact_distinct_limit:
            parts.append(sql.SQL("count(DISTINCT {c}::text)").format(c=cid))
        else:
            parts.append(sql.SQL("NULL::bigint"))
        parts.append(sql.SQL("max(length({c}::text))").format(c=cid))
        parts.append(
            sql.SQL("md5(coalesce(string_agg(md5(coalesce({c}::text, '∅')), '' ORDER BY md5(coalesce({c}::text, '∅'))), ''))").format(c=cid)
        )
    cols: dict[str, Any] = {}
    if parts:
        q = sql.SQL("SELECT {} FROM {}").format(sql.SQL(", ").join(parts), ident(t["schema"], t["name"]))
        vals = list(c.execute(q, prepare=False).fetchone().values())
        for i, col in enumerate(t["columns"]):
            nulls, distinct, maxlen, checksum = vals[i * 4 : i * 4 + 4]
            cols[col["name"]] = {
                "type": col["type"],
                "nullable": col["nullable"],
                "category": col["category"],
                "nulls": int(nulls or 0),
                "distinct": None if distinct is None else int(distinct),
                "max_len": None if maxlen is None else int(maxlen),
                "checksum": checksum,
            }
    return {"rows": rows, "columns": cols}


def profile(c: psycopg.Connection, tables: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    tables = tables if tables is not None else list_tables(c)
    return {
        "tables": {t["display"]: {**{k: t[k] for k in ("schema", "name", "pk", "fks")}, **profile_table(c, t)} for t in tables},
        "meta": {t["display"]: t for t in tables},
    }


def table_checksum(c: psycopg.Connection, schema: str, table: str) -> str:
    """Order-independent fingerprint of every full row."""
    q = sql.SQL("SELECT md5(coalesce(string_agg(md5(t::text), '' ORDER BY md5(t::text)), '')) AS h FROM {} t").format(ident(schema, table))
    return c.execute(q).fetchone()["h"]


def ddl(c: psycopg.Connection, schema: str, table: str) -> str:
    """A readable CREATE TABLE rendering: columns, constraints and indexes."""
    oid_row = c.execute("SELECT %s::regclass::oid AS oid", (f'"{schema}"."{table}"',)).fetchone()
    oid = oid_row["oid"]
    cols = c.execute(
        """
        SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull, pg_get_expr(d.adbin, d.adrelid) AS def
        FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = %s AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum
        """,
        (oid,),
    ).fetchall()
    lines = []
    for col in cols:
        line = f"  {col['attname']} {col['type']}"
        if col["def"]:
            line += f" DEFAULT {col['def']}"
        if col["attnotnull"]:
            line += " NOT NULL"
        lines.append(line)
    cons = c.execute(
        "SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = %s AND contype <> 'n' ORDER BY contype, conname",
        (oid,),
    ).fetchall()
    for k in cons:
        lines.append(f"  CONSTRAINT {k['conname']} {k['def']}")
    body = ",\n".join(lines)
    out = f"CREATE TABLE {display(schema, table)} (\n{body}\n);"
    idx = c.execute(
        """
        SELECT indexdef FROM pg_indexes WHERE schemaname = %s AND tablename = %s
          AND indexname NOT IN (SELECT conname FROM pg_constraint WHERE conrelid = %s)
        ORDER BY indexname
        """,
        (schema, table, oid),
    ).fetchall()
    for i in idx:
        out += "\n" + i["indexdef"] + ";"
    return out


def table_exists(c: psycopg.Connection, schema: str, table: str) -> bool:
    return c.execute("SELECT to_regclass(%s) IS NOT NULL AS ok", (f'"{schema}"."{table}"',)).fetchone()["ok"]


def schema_summary(c: psycopg.Connection) -> list[dict[str, Any]]:
    """Compact schema for the agent and the New Rehearsal side panel."""
    out = []
    for t in list_tables(c):
        out.append(
            {
                "name": t["display"],
                "rows": count_rows(c, t["schema"], t["name"]),
                "columns": [{"name": x["name"], "type": x["type"], "nullable": x["nullable"]} for x in t["columns"]],
                "references": sorted({f["ref"] for f in t["fks"]}),
                "primary_key": t["pk"],
            }
        )
    return out
