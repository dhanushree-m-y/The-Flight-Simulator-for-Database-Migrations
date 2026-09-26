"""Static analysis of a migration before it runs: statement splitting, affected tables, Postgres lock
levels, and editor hints."""

from __future__ import annotations

import re
from dataclasses import dataclass

IDENT = r'(?:"[^"]+"|[A-Za-z_][\w$]*)'
QUALIFIED = rf"{IDENT}(?:\s*\.\s*{IDENT})?"


def split_statements(sql: str) -> list[str]:
    """Split a SQL script on top-level semicolons, respecting quotes, dollar quotes and comments."""
    out, buf, i, n = [], [], 0, len(sql)
    while i < n:
        ch = sql[i]
        if sql.startswith("--", i):
            j = sql.find("\n", i)
            j = n if j == -1 else j
            buf.append(sql[i:j])
            i = j
            continue
        if sql.startswith("/*", i):
            j = sql.find("*/", i + 2)
            j = n if j == -1 else j + 2
            buf.append(sql[i:j])
            i = j
            continue
        if ch in ("'", '"'):
            j = i + 1
            while j < n:
                if sql[j] == ch:
                    if j + 1 < n and sql[j + 1] == ch:
                        j += 2
                        continue
                    break
                j += 1
            buf.append(sql[i : j + 1])
            i = j + 1
            continue
        m = re.match(r"\$([A-Za-z_]\w*)?\$", sql[i:])
        if m:
            tag = m.group(0)
            j = sql.find(tag, i + len(tag))
            j = n if j == -1 else j + len(tag)
            buf.append(sql[i:j])
            i = j
            continue
        if ch == ";":
            stmt = "".join(buf).strip()
            if _has_code(stmt):
                out.append(stmt)
            buf = []
            i += 1
            continue
        buf.append(ch)
        i += 1
    stmt = "".join(buf).strip()
    if _has_code(stmt):
        out.append(stmt)
    return out


def _has_code(stmt: str) -> bool:
    return bool(re.sub(r"--[^\n]*|/\*.*?\*/", "", stmt, flags=re.S).strip())


def code_only(stmt: str) -> str:
    return re.sub(r"--[^\n]*|/\*.*?\*/", " ", stmt, flags=re.S).strip()


def unquote(name: str) -> str:
    parts = [p.strip() for p in re.split(r"\.(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)", name)]
    last = parts[-1]
    return last[1:-1] if last.startswith('"') else last.lower()


def tables_in(stmt: str) -> list[str]:
    s = code_only(stmt)
    found: list[str] = []
    patterns = [
        rf"\bALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?({QUALIFIED})",
        rf"\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?({QUALIFIED})",
        rf"\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(?:{IDENT}\s+)?ON\s+(?:ONLY\s+)?({QUALIFIED})",
        rf"\bUPDATE\s+(?:ONLY\s+)?({QUALIFIED})",
        rf"\bDELETE\s+FROM\s+(?:ONLY\s+)?({QUALIFIED})",
        rf"\bINSERT\s+INTO\s+({QUALIFIED})",
        rf"\bTRUNCATE\s+(?:TABLE\s+)?({QUALIFIED})",
        rf"\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?({QUALIFIED})",
        rf"\bREFERENCES\s+({QUALIFIED})",
    ]
    for p in patterns:
        for m in re.finditer(p, s, re.I):
            t = unquote(m.group(1))
            if t not in found:
                found.append(t)
    return found


@dataclass
class LockInfo:
    table: str
    mode: str
    rewrites: bool
    note: str


# Lock levels from the PostgreSQL docs ("13.3.1 Table-Level Locks").
def lock_for(stmt: str) -> list[LockInfo]:
    s = code_only(stmt)
    up = s.upper()
    tables = tables_in(stmt)
    target = tables[0] if tables else "?"
    res: list[LockInfo] = []
    if re.match(r"\s*CREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY", up):
        res.append(LockInfo(target, "SHARE UPDATE EXCLUSIVE", False, "concurrent index build — reads and writes continue"))
    elif re.match(r"\s*CREATE\s+(UNIQUE\s+)?INDEX", up):
        res.append(LockInfo(target, "SHARE", False, "blocks INSERT/UPDATE/DELETE until the index is built"))
    elif re.match(r"\s*ALTER\s+TABLE", up):
        rewrites = bool(re.search(r"ALTER\s+COLUMN\s+\S+\s+(SET\s+DATA\s+)?TYPE", up))
        if re.search(r"VALIDATE\s+CONSTRAINT", up):
            res.append(LockInfo(target, "SHARE UPDATE EXCLUSIVE", False, "validation scans the table without blocking writes"))
        elif re.search(r"ADD\s+CONSTRAINT.*FOREIGN\s+KEY|ADD\s+FOREIGN\s+KEY", up) and "NOT VALID" in up:
            res.append(LockInfo(target, "SHARE ROW EXCLUSIVE", False, "NOT VALID foreign key — no full scan"))
        else:
            note = "rewrites every row" if rewrites else "brief exclusive lock"
            if re.search(r"ADD\s+(CONSTRAINT\s+\S+\s+)?(UNIQUE|PRIMARY\s+KEY)", up):
                note = "builds a unique index while holding an exclusive lock"
            elif re.search(r"ADD\s+(CONSTRAINT\s+\S+\s+)?CHECK", up) and "NOT VALID" not in up:
                note = "scans the whole table to validate the CHECK while holding an exclusive lock"
            elif re.search(r"SET\s+NOT\s+NULL", up):
                note = "scans the whole table to verify no NULLs"
            res.append(LockInfo(target, "ACCESS EXCLUSIVE", rewrites, note))
    elif re.match(r"\s*(DROP|TRUNCATE)", up):
        res.append(LockInfo(target, "ACCESS EXCLUSIVE", False, "blocks all access"))
    elif re.match(r"\s*(UPDATE|DELETE|INSERT)", up):
        res.append(LockInfo(target, "ROW EXCLUSIVE", False, "row-level locks on touched rows"))
    return res


def is_concurrent(stmt: str) -> bool:
    return bool(re.search(r"\bCONCURRENTLY\b", code_only(stmt), re.I))


def hints(sql: str) -> list[dict]:
    """Editor hints shown while typing a migration."""
    out: list[dict] = []
    lines = sql.split("\n")

    def line_of(pattern: str) -> int | None:
        for i, l in enumerate(lines, 1):
            if re.search(pattern, l, re.I):
                return i
        return None

    stmts = split_statements(sql)
    if not stmts:
        return out
    for st in stmts:
        up = code_only(st).upper()
        first = code_only(st).split("\n")[0][:40]
        for lk in lock_for(st):
            if lk.mode == "ACCESS EXCLUSIVE":
                out.append({"level": "warn", "message": f"{lk.table}: ACCESS EXCLUSIVE lock — {lk.note}", "line": line_of(re.escape(first[:20]))})
        if re.search(r"\bDROP\s+(TABLE|COLUMN)\b", up):
            out.append({"level": "danger", "message": "Drops data permanently — DryRun will require a verified rollback and a backup.", "line": line_of(r"\bdrop\b")})
        if re.search(r"\bDELETE\s+FROM\b", up) and " WHERE " not in f" {up} ":
            out.append({"level": "danger", "message": "DELETE without WHERE removes every row.", "line": line_of(r"\bdelete\b")})
        if re.search(r"\bUPDATE\b", up) and " WHERE " not in f" {up} " and re.match(r"\s*UPDATE", up):
            out.append({"level": "warn", "message": "UPDATE without WHERE touches every row.", "line": line_of(r"^\s*update\b")})
        if re.search(r"TYPE\s+(VARCHAR|CHARACTER\s+VARYING|CHAR)\s*\(\s*\d+\s*\)", up):
            out.append({"level": "warn", "message": "Narrowing a text column can fail on (or cut) longer values.", "line": line_of(r"\btype\b")})
        if re.search(r"TYPE\s+(INT|INTEGER|SMALLINT|BIGINT|NUMERIC\s*\(\s*\d+\s*,\s*0\s*\))\b", up):
            out.append({"level": "warn", "message": "Converting to a whole-number type can round away decimals (e.g. ₹4,500.50 → ₹4,500).", "line": line_of(r"\btype\b")})
        if re.search(r"CREATE\s+(UNIQUE\s+)?INDEX\s+(?!CONCURRENTLY)", up):
            out.append({"level": "info", "message": "Consider CREATE INDEX CONCURRENTLY to avoid blocking writes.", "line": line_of(r"create\s+(unique\s+)?index")})
        if re.search(r"SET\s+NOT\s+NULL|ADD\s+COLUMN\s+\S+\s+[^,;]*NOT\s+NULL(?![^,;]*DEFAULT)", up):
            out.append({"level": "warn", "message": "NOT NULL fails if existing rows contain NULLs — DryRun will list them.", "line": line_of(r"not\s+null")})
    if not re.search(r"\bdown\b|rollback", sql, re.I):
        out.append({"level": "info", "message": "No rollback SQL provided — the DryRun agent will write one and prove it restores the data.", "line": None})
    # de-duplicate
    seen, uniq = set(), []
    for h in out:
        k = (h["level"], h["message"])
        if k not in seen:
            seen.add(k)
            uniq.append(h)
    return uniq
