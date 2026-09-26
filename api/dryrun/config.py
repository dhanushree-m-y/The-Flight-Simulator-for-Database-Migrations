"""Runtime configuration. Every secret comes from the environment (.env locally, TrueFoundry secrets when deployed)."""

from __future__ import annotations

import os
import shutil
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

API_DIR = Path(__file__).resolve().parent.parent


def _default_pg_bin() -> str:
    """Locate pg_dump/pg_restore: PATH first, then the standard Windows install."""
    found = shutil.which("pg_dump")
    if found:
        return str(Path(found).parent)
    for v in ("17", "16", "15"):
        p = Path(f"C:/Program Files/PostgreSQL/{v}/bin")
        if (p / "pg_dump.exe").exists():
            return str(p)
    return ""


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=API_DIR / ".env", env_file_encoding="utf-8", extra="ignore")

    # --- Postgres ---------------------------------------------------------------------------
    # The production database DryRun protects (the hostel system). Read access is enough for rehearsals;
    # apply_to_production uses the same DSN, so give it DDL rights only if you want real applies.
    dryrun_prod_dsn: str = ""
    dryrun_prod_name: str = "hostel-prod"
    # A server where DryRun may CREATE/DROP throwaway sandbox databases (can be the same local server).
    dryrun_sandbox_admin_dsn: str = ""
    # DryRun's own metadata (rehearsals, approvals, audit chain). Created automatically if missing.
    dryrun_meta_dsn: str = ""
    pg_bin: str = _default_pg_bin()

    # --- TrueForge agent harness ------------------------------------------------------------
    trueforge_base_url: str = "http://localhost:8790"
    trueforge_ui_url: str = ""  # defaults to base url
    trueforge_token: str = ""  # only when TrueForge login/OIDC is enabled
    dryrun_agent_name: str = "dryrun-rehearsal-agent"
    dryrun_agent_model: str = "openai/gpt-5-5"
    # URL TrueForge uses to reach DryRun's MCP server. Localhost requires TrueForge started with
    # OUTBOUND_URL_ALLOWED_HOSTS='["localhost","127.0.0.1"]' (see scripts/start-trueforge.ps1).
    dryrun_mcp_public_url: str = "http://localhost:8000/mcp/"
    dryrun_mcp_key: str = "change-me-local-mcp-key"
    # "trueforge" = agent drives the rehearsal via MCP tools; "direct" = deterministic engine only (no LLM).
    dryrun_agent_mode: str = "trueforge"
    dryrun_agent_sandbox: bool = False  # force TrueForge's Daytona sandbox on (auto-enabled when a provider is configured)
    dryrun_drift_cron: str = "30 2 * * *"  # nightly drift check, Asia/Kolkata
    question_timeout_s: int = 600  # how long a rehearsal waits for the engineer to answer the agent's question

    # --- AWS: off-site copies of production backups (credentials via the standard AWS chain: `aws configure`) ---
    aws_s3_bucket: str = ""
    aws_region: str = "ap-south-1"

    # --- Engine limits ----------------------------------------------------------------------
    sandbox_ttl_minutes: int = 45
    snapshot_max_rows: int = 2_000_000
    check_timeout_ms: int = 8000
    evidence_row_limit: int = 500

    # --- Optional integrations --------------------------------------------------------------
    github_token: str = ""
    github_repo: str = ""  # owner/repo for PR checks
    slack_webhook_url: str = ""

    web_origin: str = "http://localhost:3000"
    backups_dir: str = str(API_DIR / "backups")

    @property
    def ui_url(self) -> str:
        return (self.trueforge_ui_url or self.trueforge_base_url).rstrip("/")

    def pg_tool(self, name: str) -> str:
        exe = name + (".exe" if os.name == "nt" else "")
        return str(Path(self.pg_bin) / exe) if self.pg_bin else name


@lru_cache
def settings() -> Settings:
    return Settings()
