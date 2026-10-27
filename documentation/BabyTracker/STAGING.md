# OCR staging and release gates

Use `compose.ocr-staging.yml` with synthetic records. It has a distinct project,
container and three persistence volumes, a loopback-only port, and a two-CPU,
3 GiB, 256-PID runtime budget. It never mounts production storage.

The separate staging network defaults to `10.254.73.0/28`; check existing Docker
networks and host routes first, or set `BABYTRACKER_STAGING_SUBNET` to another
verified unused private range. This avoids consuming an exhausted automatic
address pool. It does not remove or reconfigure existing networks. Docker Desktop
requires a regular bridge for the loopback port publication; this network is not
an outbound firewall. The OCR adapter itself makes no external recognition call.

```sh
docker compose -f compose.ocr-staging.yml build
docker compose -f compose.ocr-staging.yml up -d
docker compose -f compose.ocr-staging.yml ps
```

Open `http://127.0.0.1:3124` on the Docker host. Complete normal Sprout setup with a
clearly named synthetic family and synthetic child. Authentication remains
required for OCR. No public tunnel or access-policy change is part of this file.
Do not enter real infant data into this acceptance environment.

For a new empty acceptance environment, the guarded HTTP check creates a fixed
synthetic family and child, then exercises native image recognition, draft save,
approval, exact retry, original-source access and the existing timeline:

```sh
docker compose -f compose.ocr-staging.yml exec -T app node scripts/ocr-staging-check.mjs
```

The check refuses to run without both explicit staging/OCR flags or if any other
child exists. Its first run creates two synthetic care events; later runs verify
the same receipt without adding events. A random, UI-compatible caretaker PIN is
stored only in `/app/env/ocr-staging-access.json` with mode 0600; it is never
printed in logs or committed. The synthetic family slug is `ocr-staging`, login
ID `01`. This check is for a disposable staging deployment, never production.

## Browser verification

After `npm run build`, run `npm run test:ocr-browser`. This script creates a fresh
temporary SQLite database, encryption key, synthetic identities and encrypted-file
directory, and starts one local test server. It uploads an actual generated image,
edits the recognized quantity, explicitly approves rows, checks the confirmation
gate, and verifies exact saved values through the ordinary timeline endpoint.
It also checks access denial, phone/tablet layout overflow and keyboard focus.
It closes its server and browser and removes its temporary storage afterward.

Playwright supplies the default Chromium binary. To use an already installed
official compatible binary, set `BABYTRACKER_TEST_BROWSER_PATH` to its executable.
This option is only consumed by the acceptance script. Screenshots and the JSON
report are written to ignored `test-results/`; only synthetic evidence belongs
there. Synthetic Chromium viewport tests do not establish physical iOS/Safari or
Android camera-upload acceptance.

Tests and local development may set `BABYTRACKER_OCR_FILES_DIR` to an isolated
server-side directory. Production normally uses the existing `Files/ocr` volume.
Never point a disposable database's retention sweep at another database's files.

## Production gates

1. Hosted acceptance CI passes for the exact reviewed commit.
2. Independent review findings are resolved and repository protections pass.
3. The same image passes synthetic staging upload/review/import tests.
4. A recent consistent backup includes database, configuration/encryption key and
   source files; a separate restore drill proves integrity and application startup.
5. An older-image rollback against migrated staging storage is verified without
   deleting OCR tables or canonical events.
6. Representative handwritten and mixed forms are evaluated privately, with an
   explicit transcription reference and row/field error accounting.

The current engine is an English printed-text baseline. OCR is not fully accepted
until the handwriting and real-document requirements are demonstrated. Whole-
document finalization is intentional in this slice: unchecked rows are excluded
and the document becomes read-only. The UI warns before confirmation and in the
receipt; incremental completion is a separate follow-up.

No merge, production image update or production data migration is implied by a
successful local test or a running synthetic staging container.
