"""Postgres helpers: DSN manipulation, connections to production / sandbox / metadata databases."""

from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Iterator
from urllib.parse import quote, urlsplit, urlunsplit

import psycopg
from psycopg import sql
from psycopg.rows import dict_row

from .config import settings


def with_database(dsn: str, dbname: str) -> str:
    """Return the same connection string pointing at another database on the same server."""
    if "://" in dsn:
        p = urlsplit(dsn)
        return urlunsplit((p.scheme, p.netloc, "/" + quote(dbname), p.query, p.fragment))
    parts = [kv for kv in dsn.split() if not kv.startswith("dbname=")]
    return " ".join(parts + [f"dbname={dbname}"])


def database_of(dsn: str) -> str:
    return psycopg.conninfo.conninfo_to_dict(dsn).get("dbname") or ""


def masked_host(dsn: str) -> str:
    info = psycopg.conninfo.conninfo_to_dict(dsn)
    host = str(info.get("host") or "localhost")
    port = info.get("port") or "5432"
    user = info.get("user") or "?"
    return f"{user}@{host}:{port}"


def libpq_env(dsn: str) -> dict[str, str]:
    """Environment for pg_dump / pg_restore so the password never appears on a command line."""
    info = psycopg.conninfo.conninfo_to_dict(dsn)
    env = dict(os.environ)
    mapping = {"host": "PGHOST", "port": "PGPORT", "user": "PGUSER", "password": "PGPASSWORD", "dbname": "PGDATABASE", "sslmode": "PGSSLMODE"}
    for k, var in mapping.items():
        if info.get(k):
            env[var] = str(info[k])
    return env


@contextmanager
def connect(dsn: str, *, autocommit: bool = False, app: str = "dryrun") -> Iterator[psycopg.Connection]:
    conn = psycopg.connect(dsn, autocommit=autocommit, row_factory=dict_row, application_name=app, connect_timeout=8)
    try:
        yield conn
    finally:
        conn.close()


def meta_dsn() -> str:
    s = settings()
    if s.dryrun_meta_dsn:
        return s.dryrun_meta_dsn
    return with_database(s.dryrun_sandbox_admin_dsn or s.dryrun_prod_dsn, "dryrun_meta")


def ensure_database(admin_dsn: str, dbname: str) -> None:
    with connect(with_database(admin_dsn, "postgres"), autocommit=True) as c:
        exists = c.execute("SELECT 1 FROM pg_database WHERE datname = %s", (dbname,)).fetchone()
        if not exists:
            c.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(dbname)))
