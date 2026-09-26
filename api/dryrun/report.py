"""Rehearsal report rendering + delivery to where the team works (GitHub PR comment, Slack)."""

from __future__ import annotations

import traceback
from typing import Any

import httpx

from . import audit, store
from .config import settings

ICON = {"passed": "🟢 SAFE TO APPLY", "warning": "🟠 NEEDS REVIEW", "blocked": "🔴 DO NOT APPLY", "failed": "⚠️ REHEARSAL ERROR", "cancelled": "— CANCELLED"}
MARK = {"pass": "✅", "warn": "⚠️", "fail": "❌"}


def markdown(doc: dict[str, Any], web_url: str | None = None) -> str:
    ai = doc.get("ai") or {}
    m = doc.get("metrics") or {}
    rb = doc.get("rollback") or {}
    lines = [
        f"## DryRun rehearsal · `{doc['name']}` V{doc['version']}",
        "",
        f"**{ICON.get(doc['status'], doc['status'])}** · risk **{doc.get('risk', '—')}/100** · {doc['connection_name']} → sandbox `{(doc.get('sandbox') or {}).get('id', '—')}`",
        "",
        f"> {ai.get('headline') or doc.get('headline') or ''}",
        "",
        ai.get("summary") or "",
        "",
        "| | |",
        "|---|---|",
        f"| Rows compared | {m.get('rows_scanned', 0):,} across {m.get('tables', 0)} tables |",
        f"| Checks | {sum(1 for c in doc['checks'] if c['status'] == 'pass')}/{len(doc['checks'])} passed |",
        f"| Rollback | {rb.get('status', 'not tested')}{' · 100% identical' if rb.get('identical') and rb.get('status') == 'passed' else ''} |",
        f"| Locks | {', '.join(f'{l['table']} {l['mode']} {l['duration_ms']:.0f}ms' for l in doc.get('locks', [])) or 'none'} |",
        "",
        "### Checks",
        "",
    ]
    for c in doc["checks"]:
        n = f" · {c['affected_rows']:,} rows" if c.get("affected_rows") else ""
        lines.append(f"- {MARK.get(c['status'], '•')} **{c['title']}**{n}" + (f" — {c['explanation']}" if c.get("explanation") and c["status"] != "pass" else ""))
    if doc.get("risk_parts"):
        lines += ["", "### Why this risk score", ""] + [f"- {p['label']}: +{p['points']}" for p in doc["risk_parts"]]
    if doc.get("policy_violations"):
        lines += ["", "### Policies", ""] + [f"- **{v['title']}** ({v['severity']}): {v['message']}" for v in doc["policy_violations"]]
    lines += ["", "### Migration", "", "```sql", doc["up_sql"].strip(), "```"]
    if rb.get("down_sql"):
        lines += ["", f"Rollback ({rb.get('down_sql_source') or 'user'}-written):", "", "```sql", rb["down_sql"].strip(), "```"]
    agent = doc.get("agent") or {}
    lines += ["", "---", f"Rehearsed by the DryRun agent on TrueForge ({agent.get('model') or 'deterministic engine'}). "
              "Production is only changed after a human approval." + (f" [Open full report]({web_url})" if web_url else "")]
    return "\n".join(lines)


def deliver(rid: str) -> None:
    """Post the finished report to GitHub (PR comment) and Slack when configured. Best effort."""
    s = settings()
    doc = store.get_rehearsal(rid)
    if not doc:
        return
    url = f"{s.web_origin.rstrip('/')}/rehearsals/{rid}/report"
    body = markdown(doc, url)
    pr = (doc.get("options") or {}).get("github_pr")
    if s.github_token and s.github_repo and pr:
        try:
            r = httpx.post(
                f"https://api.github.com/repos/{s.github_repo}/issues/{int(pr)}/comments",
                headers={"Authorization": f"Bearer {s.github_token}", "Accept": "application/vnd.github+json"},
                json={"body": body},
                timeout=15,
            )
            r.raise_for_status()
            audit.record("report.github_comment", target=rid, pr=pr, url=r.json().get("html_url"))
        except Exception:  # noqa: BLE001
            traceback.print_exc()
    if s.slack_webhook_url:
        try:
            text = f"*DryRun* · `{doc['name']}` V{doc['version']} → {ICON.get(doc['status'], doc['status'])} · risk {doc.get('risk')}\n>{doc.get('headline') or ''}\n<{url}|Open report>"
            httpx.post(s.slack_webhook_url, json={"text": text}, timeout=10).raise_for_status()
            audit.record("report.slack", target=rid)
        except Exception:  # noqa: BLE001
            traceback.print_exc()


def notify_approval(approval: dict[str, Any]) -> None:
    s = settings()
    if not s.slack_webhook_url:
        return
    r = approval["rehearsal"]
    url = f"{s.web_origin.rstrip('/')}/approvals/{approval['id']}"
    try:
        httpx.post(s.slack_webhook_url, json={"text": f"✋ *Approval needed* · `{r['name']}` V{r['version']} on {r['connection_name']} · risk {r['risk']} · requested by {approval['requested_by']['name']}\n<{url}|Review and approve in DryRun>"}, timeout=10)
    except Exception:  # noqa: BLE001
        traceback.print_exc()
