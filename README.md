# BabyTracker

Private M-TechLabs family baby tracker project. The working name is **BabyTracker**; a final name has not been chosen.

## Reality: what works now

Phase 0 deploys **unmodified Sprout Track v1.6.7** in an isolated Docker Compose project, with persistent SQLite, encryption/configuration volume, and file attachments. This means you can log feeds, diapers, sleep, pumping, medicine, growth, milestones, vaccines, photos and more from a phone or iPad immediately after the app's first-run wizard.

**Not yet implemented** in this repo: a unified codebase, first-class Baby Buddy-compatible REST API, scanned/handwritten PDF parsing, independent Huckleberry-like predictions, and any claimed cross-app bidirectional sync. Those are tracked development requirements, not live features.

## Quick start (MulattoTechBox)

```powershell
cd C:\Tools\Dev\BabyTracker
docker compose config -q
docker compose up -d
docker compose ps
```

Local URL: http://localhost:3123

Private HTTPS URL (Tailscale Serve, when enabled):
https://mulattotechbox.tail8e12aa.ts.net

For a Pixel/iPad: join the same Tailscale network, open the HTTPS URL in Chrome/Safari, complete onboarding, then add it to your home screen as a PWA.

### Essential first-run security

The stock upstream installer may initially use PIN `111222` and Family Manager admin password `admin`. **Change both before entering real records**, choose individual caretaker PINs, and never expose the app through Tailscale Funnel/public port forwarding. The stock setup wizard lets you configure family/caretaker settings; admin password is managed under `/family-manager`.

### Backup before every update

```powershell
.\scripts\backup.ps1
.\scripts\update-sprout.ps1 -Version 1.6.8 # example only after reviewing actual upstream release
```

The backup script briefly stops **only** the BabyTracker container to get a consistent snapshot of all three Docker volumes. Encryption keys are part of the backup. Never commit the backups or `.env` to Git.

### Commands

```powershell
docker compose ps
docker compose logs --tail=100 sprout
docker compose restart sprout
docker compose down # does NOT delete persistent data volumes
```

**Do not run `docker compose down -v`** or delete the three `babytracker-sprout-*` volumes unless intentionally destroying records.

## Architecture direction

- One canonical data source tonight: stock upstream Sprout Track, version pinned.
- Separate owned repository controls deployments, adapters, import/review, compatibility, tests and predictive services.
- Treat upstream Baby Buddy as a compatibility/reference source, **not a second active data store**.
- Avoid making intrusive changes to Sprout's upstream tree; when needed, isolate changes in a maintained fork with tracked upstream.
- Keep document OCR/AI and predictive sleep optional: the tracker must keep working if either service goes down.
- A future PostgreSQL migration is supported by Sprout's backup/restore, but is intentionally not required for the first release.
- Preserve Sprout's **custom non-commercial/share-alike** license if distributing derivative source; Baby Buddy uses BSD-2-Clause.

## Project documents

- [Product vision](docs/PRODUCT_VISION.md)
- [Feature matrix](docs/FEATURE_PARITY_MATRIX.md)
- [Architecture](docs/ARCHITECTURE.md)
- [PDF import specification](docs/IMPORT_PIPELINE.md)
- [Sleep planning specification](docs/SLEEP_INTELLIGENCE.md)
- [Upstream policy](docs/UPSTREAM_STRATEGY.md)
- [Naming candidates](docs/NAME_IDEAS.md)
- [Initial architecture decision](docs/DECISION-0001.md)

## Source projects

- [Sprout Track](https://github.com/Oak-and-Sprout/sprout-track)
- [Baby Buddy](https://github.com/babybuddy/babybuddy)

Current [BabyTracker master issue #21](https://github.com/MulattoTech/BabyTracker/issues/21), [Phase 0 setup issue #30](https://github.com/MulattoTech/BabyTracker/issues/30), and the earlier [M-TechLabs planning PR](https://github.com/MulattoTech/M-TechLabs/pull/66).


## Verified deployment and release monitoring

See [deployment status](docs/DEPLOYMENT_STATUS.md) for what has actually passed and what still needs user setup.

The PC runs a weekly low-privilege Windows task, **BabyTracker - Upstream Release Watch**, Mondays at 9:00 AM (when signed in). It creates GitHub review issues for new Sprout Track and Baby Buddy releases but does **not** upgrade production. Manual check: `powershell -NoProfile -File .\scripts\check-upstreams.ps1`.

GitHub Actions release review is also configured but hosted jobs are currently blocked by [an account billing restriction](https://github.com/MulattoTech/BabyTracker/issues/32).

After running `scripts/backup.ps1`, verify a restore using `scripts/test-restore.ps1`; it uses disposable volumes and never mutates the production database.
