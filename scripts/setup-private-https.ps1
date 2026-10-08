# Tailscale Serve: tailnet-private TLS termination, NOT internet exposure.
$ErrorActionPreference = 'Stop'
if (-not (Get-Command tailscale -ErrorAction SilentlyContinue)) { throw 'Tailscale CLI is not installed' }
$status = & tailscale serve status
if ($LASTEXITCODE -ne 0) { throw 'Unable to read Tailscale Serve status' }
if (($status -join "`n") -notmatch 'No serve config') {
    throw 'Existing Tailscale Serve configuration detected. Refusing to overwrite it automatically.'
}
& tailscale serve --bg --https=443 http://127.0.0.1:3123
if ($LASTEXITCODE -ne 0) { throw 'Tailscale Serve failed or needs admin HTTPS approval' }
& tailscale serve status
Write-Host 'Private HTTPS configured. Never use tailscale funnel for private baby records.'
