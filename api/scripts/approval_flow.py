"""Dev helper: exercise the production approval gates for a passed rehearsal.
Usage: python scripts/approval_flow.py <rehearsal_id> [api_url]"""
import json
import sys
import time
import urllib.error
import urllib.request

rid = sys.argv[1]
API = sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:8001"


def call(method, path, user, body=None):
    req = urllib.request.Request(f"{API}{path}", method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", "X-DryRun-User": user})
    try:
        return json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as e:
        return {"http": e.code, **json.load(e)}


a = call("POST", f"/api/rehearsals/{rid}/request-approval", "u_engineer", {"comment": "demo"})
print("requested:", a.get("status"), a.get("detail", ""), "| phrase:", a.get("confirm_phrase"))
for c in a.get("checklist", []):
    print(f"   {'✓' if c['ok'] else '✕'} {c['label']} — {c['detail']}")
aid = a.get("id")
if not aid:
    sys.exit(1)
print("viewer approves      →", call("POST", f"/api/approvals/{aid}/decide", "u_viewer", {"decision": "approve", "confirm_phrase": a["confirm_phrase"]}).get("detail"))
print("requester approves   →", call("POST", f"/api/approvals/{aid}/decide", "u_engineer", {"decision": "approve", "confirm_phrase": a["confirm_phrase"]}).get("detail"))
print("wrong phrase         →", call("POST", f"/api/approvals/{aid}/decide", "u_approver", {"decision": "approve", "confirm_phrase": "hostel"}).get("detail"))
ok = call("POST", f"/api/approvals/{aid}/decide", "u_approver", {"decision": "approve", "confirm_phrase": a["confirm_phrase"]})
print("approver + phrase    →", ok.get("status"), ok.get("detail", ""))
for _ in range(30):
    d = call("GET", f"/api/approvals/{aid}", "u_viewer")
    if (d.get("apply") or {}).get("status") not in (None, "running"):
        break
    time.sleep(1)
run = d.get("apply") or {}
print("approval:", d["status"], "| apply:", run.get("status"), "| backup:", run.get("backup_ref"))
for s in run.get("steps", []):
    print(f"   {s['key']:<7} {s['status']:<7} {s['detail']}")
