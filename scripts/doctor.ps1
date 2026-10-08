# Non-destructive status check.
$ErrorActionPreference = 'Continue'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $project
try {
    & docker compose config --quiet
    if ($LASTEXITCODE -eq 0) { Write-Host 'COMPOSE_VALID' }
    & docker compose ps
    & docker inspect babytracker-sprout --format 'HEALTH={{if .State.Health}}{{.State.Health.Status}}{{else}}not-configured{{end}}'
    try {
        $result = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3123/' -TimeoutSec 12 -MaximumRedirection 4
        Write-Host "HTTP=$($result.StatusCode)"
    } catch { Write-Host "HTTP_CHECK_ERROR=$($_.Exception.Message)" }
    & tailscale serve status
    & docker volume ls --filter 'name=babytracker-sprout'
}
finally { Pop-Location }
