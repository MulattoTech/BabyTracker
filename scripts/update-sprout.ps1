# Opt-in, backup-first upstream image update. Do not automatically upgrade production.
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version
)
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $project
try {
    Write-Host "Checking upstream Sprout Track image tag $Version..."
    & docker manifest inspect "sprouttrack/sprout-track:$Version" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Tag $Version not available" }
    & (Join-Path $PSScriptRoot 'backup.ps1')
    if (-not $?) { throw 'Backup did not succeed: update cancelled' }
    $envPath = Join-Path $project '.env'
    if (-not (Test-Path $envPath)) { throw 'Missing local .env configuration' }
    $old = Get-Content -Path $envPath -Raw
    $replace = "SPROUT_IMAGE=sprouttrack/sprout-track:$Version"
    if ($old -match '(?m)^SPROUT_IMAGE=') {
        $new = [regex]::Replace($old, '(?m)^SPROUT_IMAGE=.*$', $replace)
    } else { $new = "$replace`r`n$old" }
    Set-Content -Path $envPath -Value $new -Encoding UTF8
    & docker compose pull sprout
    if ($LASTEXITCODE -ne 0) { throw 'Image pull failed' }
    & docker compose up -d --wait
    if ($LASTEXITCODE -ne 0) {
        throw 'Health check failed; restore the snapshot if migration damaged data (image downgrade alone is not a safe rollback)'
    }
    Write-Host "UPDATED_TO=$Version"
    Write-Host 'Review functionality and submit an update PR to change the tracked image version.'
}
finally { Pop-Location }
