# One-click demo start (this laptop's demo setup).
# Opens 3 windows: TrueForge (8790), DryRun API (8001), DryRun web (3000), after starting the demo Postgres (5499).
# Stop everything by closing those windows.

$root = Split-Path -Parent $PSScriptRoot
$pgBin = "C:\Program Files\PostgreSQL\16\bin"
$pgData = "C:\pgtest_dryrun\data"

# 1. Demo Postgres with the Hostel OS data (port 5499)
& "$pgBin\pg_isready.exe" -h localhost -p 5499 | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Starting demo Postgres on 5499..."
  Start-Process -WindowStyle Hidden -FilePath "$pgBin\pg_ctl.exe" -ArgumentList @("-D", $pgData, "-o", "`"-p 5499`"", "-l", "C:\pgtest_dryrun\log.txt", "start")
  Start-Sleep -Seconds 5
}

# 2. TrueForge (allow-list localhost so it can reach DryRun's MCP server)
if (-not (Get-NetTCPConnection -LocalPort 8790 -State Listen -ErrorAction SilentlyContinue)) {
  Start-Process powershell -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-Command",
    "`$env:OUTBOUND_URL_ALLOWED_HOSTS='[`"localhost`",`"127.0.0.1`"]'; `$env:PORT='8790'; npx --yes @truefoundry/trueforge@latest")
  Write-Host "Starting TrueForge on 8790..."
  Start-Sleep -Seconds 12
}

# 3. DryRun API (agent mode, demo database)
if (-not (Get-NetTCPConnection -LocalPort 8001 -State Listen -ErrorAction SilentlyContinue)) {
  $api = @"
Set-Location '$root\api'
`$env:DRYRUN_PROD_DSN='postgresql://postgres@localhost:5499/hostel'
`$env:DRYRUN_SANDBOX_ADMIN_DSN='postgresql://postgres@localhost:5499/postgres'
`$env:DRYRUN_AGENT_MODE='trueforge'
`$env:DRYRUN_MCP_PUBLIC_URL='http://localhost:8001/mcp/'
`$env:DRYRUN_PROD_NAME='hostel-prod'
`$env:DRYRUN_AGENT_MODEL='openai/gpt-5-5'
`$env:QUESTION_TIMEOUT_S='1800'
.\.venv\Scripts\python -m uvicorn dryrun.main:app --host 127.0.0.1 --port 8001
"@
  Start-Process powershell -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $api)
  Write-Host "Starting DryRun API on 8001..."
  Start-Sleep -Seconds 8
}

# 4. DryRun web app
if (-not (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)) {
  Set-Content -Path "$root\web\.env.local" -Value "NEXT_PUBLIC_API_URL=http://localhost:8001" -Encoding utf8
  Start-Process powershell -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-Command", "Set-Location '$root\web'; npm run dev")
  Write-Host "Starting DryRun web on 3000..."
  Start-Sleep -Seconds 10
}

Write-Host ""
Write-Host "DryRun is starting. Open http://localhost:3000  (TrueForge: http://localhost:8790)"
Start-Process "http://localhost:3000"
