# Deploy a clean canonical revision without resetting or deleting production data.
[CmdletBinding()]
param([string]$Image, [switch]$Build, [switch]$ValidateOnly)
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $project
try {
    $revision = (& git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Git revision unavailable' }
    if (-not $Image) { $Image = 'babytracker:git-' + $revision.Substring(0,12) }
    if ($Image -notmatch '^[A-Za-z0-9][A-Za-z0-9._/:-]{1,199}$') { throw 'Invalid image reference' }
    & docker compose config --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Invalid canonical Compose configuration' }
    if ($ValidateOnly) {
        Write-Output "VALIDATION_OK=$revision; image=$Image; no build, stop or mutation requested"
        return
    }
    if (@(& git status --porcelain).Count -gt 0) { throw 'Use a clean accepted checkout; preserve uncommitted work first' }
    if ($Build) {
        & docker build --label 'org.opencontainers.image.source=https://github.com/MulattoTech/BabyTracker' --label "org.opencontainers.image.revision=$revision" -t $Image ./application
        if ($LASTEXITCODE -ne 0) { throw 'Canonical image build failed; production was not changed' }
    }
    $details = (& docker image inspect $Image | ConvertFrom-Json)[0]
    if ($LASTEXITCODE -ne 0 -or -not $details) { throw 'Image is not available locally; build it or explicitly pull the accepted image first' }
    if ($details.Config.Labels.'org.opencontainers.image.source' -ne 'https://github.com/MulattoTech/BabyTracker' -or $details.Config.Labels.'org.opencontainers.image.revision' -ne $revision) {
        throw 'Image provenance must match this exact canonical checkout; no production change was made'
    }
    & (Join-Path $PSScriptRoot 'backup.ps1')
    if (-not $?) { throw 'Backup failed; update cancelled' }
    & (Join-Path $PSScriptRoot 'test-restore.ps1')
    if (-not $?) { throw 'Restore verification failed; update cancelled' }
    $envPath = Join-Path $project '.env'
    if (-not (Test-Path $envPath)) { throw 'Missing local .env; existing configuration is required' }
    $old = Get-Content $envPath -Raw
    if ([regex]::Matches($old,'(?m)^BABYTRACKER_IMAGE=').Count -gt 1) { throw 'Duplicate image configuration' }
    Copy-Item $envPath (Join-Path $project ('backups/.env-before-update-' + (Get-Date -Format 'yyyyMMdd-HHmmss')))
    $line = 'BABYTRACKER_IMAGE=' + $Image
    $new = if ($old -match '(?m)^BABYTRACKER_IMAGE=') { [regex]::Replace($old,'(?m)^BABYTRACKER_IMAGE=.*$', $line) } else { $old.TrimEnd() + "`n" + $line + "`n" }
    [IO.File]::WriteAllText($envPath, $new, [Text.UTF8Encoding]::new($false))
    & docker compose up -d --no-build --wait --wait-timeout 180 sprout
    if ($LASTEXITCODE -ne 0) { throw 'Health gate failed. Preserve the snapshot and inspect before rollback; no volumes were deleted or restored automatically' }
    Write-Output "UPDATE_OK=$revision; image=$Image; existing named volumes retained"
} finally { Pop-Location }
