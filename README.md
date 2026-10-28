# BabyTracker

One canonical repository for the BabyTracker application, OCR import, deployment,
backups, roadmap and future Baby Buddy, sleep intelligence and camera integrations.

## Repository layout
- `application/`: maintained Sprout Track derivative, including reviewed local OCR.
- `compose.yaml`: build/run the canonical app with existing production volume names.
- `scripts/`: backup, restore verification and upstream-release review.
- `docs/`: product requirements, architecture and migration evidence.

Fleet orchestration is a separate product: https://github.com/MulattoTech/Fleet-Control-Hub.
Both MJobs and BabyTracker use that shared source; their runtime state stays separate.

## Build and run
```powershell
cd C:\Tools\Dev\BabyTracker
.\scripts\backup.ps1
.\scripts\update-babytracker.ps1 -Build
```
The tracker remains bound to loopback port 3123. Existing HTTPS routing and the
`babytracker-sprout-db`, `babytracker-sprout-env` and `babytracker-sprout-files`
volumes must be preserved. Never delete these volumes to perform an update.
`BABYTRACKER_IMAGE` can pin a tested image; OCR can be disabled with
`BABYTRACKER_OCR_ENABLED=false` without disabling ordinary tracking.

## Development
```powershell
cd application
npm ci
npm run prisma:generate
npm run prisma:generate:log
npm test
npm run build
```
Upstream documentation and license are preserved under `application/`.
See `docs/REPOSITORY_CONSOLIDATION.md` for provenance, rollback and remaining gates.
Application history from BabyTracker-App is retained as merge ancestry, not discarded.
Historical branches are preserved under the `archive/babytracker-app/` namespace.

## Feature boundaries
OCR requires human review before committing imported events. Real handwriting,
Baby Buddy parity, sleep predictions and camera integration must not be described as
complete without their own acceptance evidence. Repository consolidation does not
claim those unfinished features are implemented.
