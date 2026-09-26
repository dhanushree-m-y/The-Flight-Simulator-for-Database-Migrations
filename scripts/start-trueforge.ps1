# Start the TrueForge agent harness locally.
# TrueForge blocks MCP servers on localhost/private IPs by default (SSRF guard); DryRun's MCP server runs on
# localhost:8000, so we allow-list localhost explicitly. Keep TrueForge bound to localhost (standalone mode).
$env:OUTBOUND_URL_ALLOWED_HOSTS = '["localhost","127.0.0.1"]'
$env:PORT = "8790"
npx --yes @truefoundry/trueforge@latest
