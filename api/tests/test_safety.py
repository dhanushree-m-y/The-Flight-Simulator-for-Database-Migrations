"""Unit tests for the parts of DryRun that keep production safe and do not need a database."""

import pytest

from dryrun import analyzer, engine, sqlguard
from dryrun.audit import GENESIS, _digest


# --- SQL guard: AI-written checks must be a single read-only SELECT ----------------------------

@pytest.mark.parametrize(
    "query",
    [
        "SELECT * FROM rooms WHERE occupied > capacity",
        "SELECT phone, count(*) FROM students GROUP BY phone HAVING count(*) > 1",
        "WITH x AS (SELECT id FROM rooms) SELECT * FROM x",
        "SELECT a.id FROM allocations a LEFT JOIN rooms r ON r.id = a.room_id WHERE r.id IS NULL",
    ],
)
def test_guard_allows_read_only(query):
    assert sqlguard.check_read_only(query)


@pytest.mark.parametrize(
    "query,reason",
    [
        ("DELETE FROM rooms", "only SELECT"),
        ("UPDATE students SET phone = NULL", "only SELECT"),
        ("SELECT 1; DROP TABLE rooms", "single statement"),
        ("SELECT pg_sleep(30)", "pg_sleep"),
        ("WITH gone AS (DELETE FROM fees RETURNING *) SELECT * FROM gone", "DELETE"),
        ("SELECT * FROM rooms FOR UPDATE", "row locks"),
        ("SELECT * INTO backup FROM rooms", "INTO"),
    ],
)
def test_guard_refuses_writes_and_tricks(query, reason):
    with pytest.raises(sqlguard.UnsafeSQL) as e:
        sqlguard.check_read_only(query)
    assert reason.lower() in str(e.value).lower()


# --- Static analysis ---------------------------------------------------------------------------

def test_split_respects_quotes_comments_and_dollar_quotes():
    sql = """-- first; not a statement
    UPDATE students SET note = 'a;b' WHERE id = 1;
    DO $$ BEGIN RAISE NOTICE 'x;y'; END $$;
    /* ; */ ALTER TABLE rooms ADD COLUMN floor int"""
    stmts = analyzer.split_statements(sql)
    assert len(stmts) == 3
    assert "a;b" in stmts[0]


def test_lock_levels_follow_postgres_docs():
    assert analyzer.lock_for("ALTER TABLE rooms ADD CONSTRAINT c CHECK (occupied <= capacity)")[0].mode == "ACCESS EXCLUSIVE"
    assert analyzer.lock_for("CREATE UNIQUE INDEX CONCURRENTLY i ON students (phone)")[0].mode == "SHARE UPDATE EXCLUSIVE"
    assert analyzer.lock_for("CREATE INDEX i ON students (phone)")[0].mode == "SHARE"
    assert analyzer.lock_for("UPDATE fees SET amount = 0 WHERE id = 1")[0].mode == "ROW EXCLUSIVE"
    assert analyzer.lock_for("ALTER TABLE fees ALTER COLUMN amount TYPE integer")[0].rewrites


def test_tables_in_detects_targets_and_references():
    t = analyzer.tables_in('ALTER TABLE public."Allocations" ADD FOREIGN KEY (room_id) REFERENCES rooms (id)')
    assert t == ["Allocations", "rooms"]


def test_hints_flag_data_loss_patterns():
    msgs = " ".join(h["message"] for h in analyzer.hints("ALTER TABLE fees ALTER COLUMN amount TYPE integer; DELETE FROM complaints;"))
    assert "round" in msgs
    assert "DELETE without WHERE" in msgs


# --- Audit chain -------------------------------------------------------------------------------

def test_audit_digest_chains_and_detects_tampering():
    h1 = _digest(GENESIS, "2026-09-26T10:00:00+00:00", "u_engineer", "rehearsal.started", "reh_1", {"name": "003"})
    h2 = _digest(h1, "2026-09-26T10:01:00+00:00", "u_approver", "approval.approved", "apr_1", {})
    tampered = _digest(GENESIS, "2026-09-26T10:00:00+00:00", "u_engineer", "rehearsal.started", "reh_1", {"name": "004"})
    assert h1 != tampered
    assert _digest(tampered, "2026-09-26T10:01:00+00:00", "u_approver", "approval.approved", "apr_1", {}) != h2


# --- Risk scoring ------------------------------------------------------------------------------

def _doc(checks, rollback=None, locks=()):
    return {"checks": checks, "rollback": rollback, "locks": list(locks)}


def test_safe_migration_scores_low():
    risk, _ = engine.score(_doc([{"key": "migration_applied", "group": "constraint", "status": "pass"}],
                                rollback={"status": "passed"}), {})
    assert risk <= 30


def test_rejected_migration_with_evidence_is_high_risk():
    risk, parts = engine.score(_doc([
        {"key": "migration_applied", "group": "constraint", "status": "fail"},
        {"key": "check_violation", "group": "constraint", "status": "fail"},
    ], rollback={"status": "skipped"}), {})
    assert risk > 60
    assert {p["kind"] for p in parts} >= {"constraint", "rollback"}


def test_silent_data_loss_is_blocked():
    risk, _ = engine.score(_doc([
        {"key": "migration_applied", "group": "constraint", "status": "pass"},
        {"key": "values_changed_by_type", "group": "data", "status": "fail"},
        {"key": "rollback", "group": "constraint", "status": "fail"},
    ], rollback={"status": "failed"}), {})
    assert risk > 55


def test_masking_hides_contact_details():
    assert engine._mask("email", "priya.nair@college.edu") == "p***@college.edu"
    assert engine._mask("phone", "9876543210").endswith("10") and "98765" not in engine._mask("phone", "9876543210")
    assert engine._mask("room_no", "A-101") == "A-101"
