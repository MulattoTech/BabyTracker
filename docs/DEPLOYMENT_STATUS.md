# Deployment status — 2026-10-07

## Running baseline

- Host: MulattoTechBox (Windows 11 / Docker Desktop)
- Local source path: `C:\Tools\Dev\BabyTracker`
- Repository: `MulattoTech/BabyTracker` (private)
- Docker service: `babytracker-sprout`
- Image: `sprouttrack/sprout-track:1.6.7`
- Initial image digest: `sha256:445b7dfd6cc8976e9e0ec313457c11b8336befea5a2fab69fd573ff55ac77a64`
- Host listener: `127.0.0.1:3123` only
- Tailnet-private HTTPS: https://mulattotechbox.tail8e12aa.ts.net
- Tailscale Serve: ENABLED (not Funnel); HTTPS test returned 200
- Application environment: `COOKIE_SECURE=true`, configured in ignored local `.env`
- Reboot policy: Docker `restart: unless-stopped`; Docker Desktop itself must start to run containers

## Tests completed

- [x] Compose YAML resolved and validated
- [x] Docker healthcheck = healthy
- [x] HTTPS response = 200 (valid private Tailscale Serve route)
- [x] Three persistent volumes: database, encrypted-file/env secrets, attachments
- [x] Offline tar backup of all three volumes
- [x] Tar manifest inspected (2 SQLite DBs, `env/.env`, files)
- [x] Restore into three disposable volumes
- [x] SQLite `PRAGMA integrity_check` = ok on main and log DBs
- [x] Backup contains encryption/JWT configuration keys
- [x] Temporary restore volumes cleaned up
- [x] PowerShell script syntax validated
- [x] Local upstream watcher created review issues for current releases
- [x] Windows Task Scheduler release-watch task created and executed, exit code 0
- [x] Deduplication demonstrated: second watch created no duplicate issues

## Pending household setup / roadmap

- [ ] Complete first-run family, baby, caregiver setup and replace stock PIN/admin password
- [ ] Confirm mobile phone and iPad access with user's Tailscale-authenticated devices; install PWA
- [ ] Build Baby Buddy-only missing features and adapters
- [ ] Implement filled/scanned/handwritten PDF import and review
- [ ] Implement independent adaptive nap/bedtime prediction

## Upstream update policy

Production updates are manual and backup-first. Weekly Monday 9 AM watcher opens GitHub review issues but never changes running images, records, or migrations.

GitHub Actions runner provisioning is blocked by the account's billing/payment/spending-limit warning. See issue #32. Local validation and scheduled upstream watching are operational.

## Safety

- No public port forwarding, no Tailscale Funnel.
- No secrets, uploaded PDFs, or backup archives committed to GitHub.
- Do not run `docker compose down -v` or delete the production volumes.
- Onboarding passwords/PINs must be changed before real family data is entered.
