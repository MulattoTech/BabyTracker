# Deployment status — 2026-10-07

## Running baseline

- Host: MulattoTechBox, Windows 11, Docker Desktop
- Deployment path: `C:\Tools\Dev\BabyTracker`
- Repository: `MulattoTech/BabyTracker` (private)
- Docker Compose service: `babytracker-sprout`
- Upstream image: `sprouttrack/sprout-track:1.6.7`
- Retrieved image digest: `sha256:445b7dfd6cc8976e9e0ec313457c11b8336befea5a2fab69fd573ff55ac77a64`
- Host listener: `127.0.0.1:3123` (loopback only; not accessible directly from LAN)
- Local endpoint: http://localhost:3123
- Remote-access design: tailnet-private HTTPS using Tailscale Serve at https://mulattotechbox.tail8e12aa.ts.net
- Tailscale status as of initial test: **requires one-time tailnet owner approval**, no Serve config yet
- **No public ingress** or Tailscale Funnel enabled
- Reboot policy: Docker service `restart: unless-stopped`; Docker Desktop itself must be running

## Verified results

- Compose file validation: PASS
- Docker container healthcheck: HEALTHY
- Local HTTP request: 200
- 3 persistent volumes: `babytracker-sprout-db`, `babytracker-sprout-env`, `babytracker-sprout-files`
- Snapshot archive created under ignored local `backups/` path
- Snapshot tar contents verified: two SQLite DBs, `env/.env`, file volume
- Restore rehearsal used three **temporary** isolated volumes; both SQLite `PRAGMA integrity_check` returned `ok`
- Required encryption and JWT configuration keys present in snapshot
- PowerShell scripts parsed without syntax errors
- GitHub CLI release watcher created issues for Sprout Track 1.6.7 and Baby Buddy v2.11.0
- Windows Task Scheduler: `BabyTracker - Upstream Release Watch` registered for Mondays 9:00 AM; only when logged in; issue creation only; never changes production

## Not yet completed

- First-run family/baby/caretaker wizard and default PIN/admin password change (user login required)
- Tailscale Serve authorization for private HTTPS / PWA
- Phone and iPad browser/PWA smoke test
- Combined Baby Buddy-specific features, PDF ingestion, sleep predictions (future work)

## GitHub Actions

Initial hosted runner **did not start**. GitHub's check annotation cites account billing/payment/spending limit. See issue #32. Local validation succeeded; scheduled local upstream watcher is the temporary fallback. The repository includes an Actions release-watch workflow for when billing is resolved.

## Safety boundaries

- Do not delete production volumes or run `docker compose down -v`.
- Keep `.env`, volume backups, and raw infant care records out of GitHub.
- Never expose upstream default admin/PIN credentials to public network.
- Update only after a verified backup and isolated compatibility qualification.
