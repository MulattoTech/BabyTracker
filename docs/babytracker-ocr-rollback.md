# OCR staging rollback rehearsal

## Scope

This drill verifies that the original Sprout Track 1.6.7 image can read the two
canonical care events produced by the reviewed OCR slice after its additive
migration. It uses **only the disposable synthetic OCR stage**. It does not stop,
mount or restore production storage, downgrade a live database, or authorize
production promotion.

The original image is pinned by its already-cached immutable Docker ID:

```text
sha256:445b7dfd6cc8976e9e0ec313457c11b8336befea5a2fab69fd573ff55ac77a64
```

The allowed source container and Compose project are both
`babytracker-ocr-staging`. The only permitted source volumes are
`babytracker-ocr-staging_staging-db`, `babytracker-ocr-staging_staging-env` and
`babytracker-ocr-staging_staging-files`. The source container must have exactly
those mounts, the explicit synthetic-staging flag, and healthy/unpaused state.

## Run

Use **PowerShell 7**, not Windows PowerShell 5.1. Native arguments use
`ProcessStartInfo.ArgumentList` to avoid shell quoting and interpretation.
The stage must first pass the app repository's `scripts/ocr-staging-check.mjs`.
The original image and `alpine:3.21` copy helper must already be cached; the drill
does not pull images or use an external network.

```powershell
& 'C:\Program Files\PowerShell\7\pwsh.exe' -NoProfile -File `
  'C:\Tools\Dev\BabyTracker-Fleet\scripts\test-ocr-rollback.ps1'
```

The verifier requires the known synthetic family, child and two imported events.
It also permits the exact untouched, empty family/caretaker/settings defaults
created by Sprout's first-run seed. Additional children, configured seed records,
other family-associated records and references to the seed caretaker are refused.
It never removes records to make a fixture pass.

The script verifies identity, pauses only the immutable staging container ID,
copies its three volumes read-only into unique ownership-labelled volumes, and
resumes staging immediately in `finally`. It starts the original image on those
clones with no published ports, `--network none`, one CPU, 2 GiB RAM and a PID
limit. Ordinary authentication and timeline checks run inside that container.
Cleanup verifies ownership labels before removing only this invocation's
temporary containers and volumes. Credentials and record contents are not printed.

## Observed result — 2026-10-27

**PASS**, exit 0, against the staged application runtime built from
`7b94b2290e6989adc9b9a99a2fc694c54258ccd7`. The later app commit `04feb01` changes
only browser-test cleanup. Application PR [#2] is merged as `83326cf`; its
[hosted acceptance run] passed 1,490 tests, TypeScript, build and real Chromium
acceptance before merge.

| Check | Observed result |
| --- | --- |
| Original immutable image starts on cloned volumes | PASS |
| Ordinary caretaker authentication and care timeline | PASS |
| Exactly two canonical events, with unchanged complete rows, IDs and timestamps | PASS |
| OCR document and audit rows preserved | PASS |
| Exactly two original import-ledger mappings preserved | PASS |
| Encrypted original and preview bytes preserved | PASS, two files |
| Staging resumed and temporary resources removed | PASS |
| Staging subsequently returns HTTP 200 and healthy status | PASS |
| Production health and original start time unchanged | PASS |

The synthetic canonical digest was
`3e3016f05622ab207d22f73204990b20b9558600cb4bf6bb3be64cfbfe1ed161`.
Hashes cover full rows, not just event counts. An initial preflight refusal
correctly stopped before pausing because the first helper did not recognize the
stock seed. The reviewed helper now verifies that seed's exact defaults and
empty relationships. During the successful pause/copy, a health probe briefly
reported unhealthy; subsequent checks confirmed recovery without restarting
staging or production.

## Separate production gates

The existing October 7 backup separately passed an isolated restore integrity
check for both SQLite databases and required encryption/configuration key
presence. That old archive is **not a current production backup**. A fresh backup,
representative handwritten-form acceptance, physical phone/tablet checks and a
reviewed production promotion remain open under [#11], [#29] and [#30]. This
synthetic drill does not prove every production-data migration or PostgreSQL
rollback scenario.

[#2]: https://github.com/MulattoTech/BabyTracker-App/pull/2
[hosted acceptance run]: https://github.com/MulattoTech/BabyTracker-App/actions/runs/40456178992
[#11]: https://github.com/MulattoTech/BabyTracker/issues/11
[#29]: https://github.com/MulattoTech/BabyTracker/issues/29
[#30]: https://github.com/MulattoTech/BabyTracker/issues/30
