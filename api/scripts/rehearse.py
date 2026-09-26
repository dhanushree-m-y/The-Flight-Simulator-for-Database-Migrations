"""Dev helper: start a rehearsal through the API and print the verdict. Usage: python scripts/rehearse.py NAME "UP_SQL" ["DOWN_SQL"]"""
import json, sys, time, urllib.request

API = "http://127.0.0.1:8001"
name, up = sys.argv[1], sys.argv[2]
down = sys.argv[3] if len(sys.argv) > 3 else None
req = urllib.request.Request(f"{API}/api/rehearsals", data=json.dumps({"connection_id": __import__("os").environ.get("CONN", "conn_prod"), "name": name, "up_sql": up, "down_sql": down}).encode(),
                             headers={"Content-Type": "application/json", "X-DryRun-User": "u_engineer"})
rid = json.load(urllib.request.urlopen(req))["id"]
for _ in range(int(__import__("os").environ.get("WAIT", "120"))):
    d = json.load(urllib.request.urlopen(f"{API}/api/rehearsals/{rid}"))
    if d["status"] not in ("queued", "running"):
        break
    time.sleep(1)
print(f"{rid}  STATUS {d['status']}  RISK {d['risk']}  | {d['headline']}")
if d["error"]:
    print("ERROR", d["error"])
for s in d["stages"]:
    print(f"  stage {s['key']:<10} {s['status']:<8} {s['duration_ms']}ms  {s['detail']}")
for c in d["checks"]:
    print(f"  check {c['status']:<4} {c['group']:<10} {c['title']}  [{c['affected_rows']}]{' +rows' if c['has_rows'] else ''}")
print("  locks", [(l["table"], l["mode"], l["duration_ms"], l["source"]) for l in d["locks"]])
print("  risk", d["risk_parts"], "| policy", [v["message"] for v in d["policy_violations"]])
rb = d["rollback"] or {}
print("  rollback", rb.get("status"), rb.get("identical"), rb.get("message"))
print("  impact", [(i["name"], i["status"]) for i in d["impact"] if i["status"] != "unchanged"])
