# Start the DryRun API (REST + SSE + MCP endpoint at /mcp/)
Set-Location "$PSScriptRoot\..\api"
if (-not (Test-Path .venv)) { python -m venv .venv; .\.venv\Scripts\pip install -r requirements.txt }
.\.venv\Scripts\python -m uvicorn dryrun.main:app --host 127.0.0.1 --port 8000
