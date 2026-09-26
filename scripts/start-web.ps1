# Start the DryRun web app on http://localhost:3000
Set-Location "$PSScriptRoot\..\web"
if (-not (Test-Path node_modules)) { npm install }
npm run dev
