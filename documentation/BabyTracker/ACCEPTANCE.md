# OCR acceptance evidence — 2026-10-27

Scope: the first reviewed local OCR vertical slice on the exact Sprout Track
1.6.7 source baseline. All verification documents and care records are synthetic.
This record does not declare the full OCR issue or a production release complete.

## Verified local gates

| Gate | Result |
| --- | --- |
| Full Vitest regression suite | 1,490 passed, 118 files |
| Production Next.js build | Passed, including TypeScript checking |
| Real native OCR and SQLite integration | Included in the full suite; 18 targeted tests also passed with a model-only `TESSDATA_PREFIX` |
| Browser upload/review/commit | Passed using official Chrome for Testing headless 145.0.7632.6 |
| Browser exact saved values | Corrected 95 mL feed at 2026-10-20T13:15:00Z and one diaper appeared in the existing timeline |
| Review confirmation | Upload and draft save wrote zero care events; final import button stayed disabled until explicit acknowledgment |
| Browser access controls | Unauthenticated request rejected; non-admin import request rejected |
| Responsive checks | 390×844 phone and 820×1180 tablet viewports had no horizontal overflow and reachable keyboard focus |
| Independent scoped code review | Two assistant reviewers; reported blocking findings resolved |
| Hosted GitHub Actions | Pending verification; local results do not substitute for this gate |
| Production rollout | Not performed |

The complete regression suite includes existing Sprout functionality. New tests
exercise parsing, ambiguity, correction, ML/OZ, DST gaps/folds, repeated source
uploads, near-time duplicates, explicit keep/skip, concurrent double commit,
atomic rollback, source encryption, cross-family denial and retention cleanup.
The browser exercised the actual application UI and ordinary timeline API.

Independent review found and resolved native process memory limits, physical
retention, source-directory test isolation, key-order-independent retry hashing,
DST fold sleep ordering, duplicate-resolution CPU work, metadata-only history,
unsaved duplicate decisions and unclear whole-document finalization wording.
The release-layout check additionally caught a missing named Tesseract output
configuration; explicit TSV output flags and protocol validation fixed it.

## Requirement traceability

The authoritative roadmap remains in `MulattoTech/BabyTracker`; do not create
duplicate OCR issues or close them on the basis of this source change alone.

| Existing issue | Evidence added here | Remaining acceptance |
| --- | --- | --- |
| #11 OCR parent, P0 | Full printed-log upload → review → canonical import path | Representative handwritten/mixed forms; all release gates |
| #37 intake | Images, multi-page PDFs, rotation, encrypted originals, resource limits | Representative smartphone photos, physical device acceptance |
| #38 extraction | Conservative event splitting, field provenance and uncertainty | Handwriting-engine comparison and measured field/event errors |
| #12 canonical import | Existing Sprout import executor, transactions, provenance, idempotency | Deployed end-to-end qualification |
| #25 privacy | Local recognition, encryption, family scope, retention and source deletion | Protected backup/restore qualification |
| #29 acceptance | Automated regression and browser evidence; independent review | Hosted CI, staging, rollback and owner-form evidence |

## Ten OCR criteria

| Criterion | Current evidence and limit |
| --- | --- |
| 1. Real multi-entry upload | Actual generated image and generated multi-page PDF pass; representative family document not yet evaluated |
| 2. Separate care events | Verified on printed synthetic rows and parser edge cases; messy handwriting not accepted |
| 3. Editable review | Actual browser corrected a recognized value and saved a draft |
| 4. Mark ambiguity | Parser/validation/UI tests cover missing dates, clocks, quantities and DST; representative handwriting remains necessary |
| 5. Accurate approved save | Actual browser and transactional DB tests verify exact values and UTC times |
| 6. Safe duplicate handling | Same-source, transformed-rescan, explicit keep/skip, exact retry and concurrency tests pass |
| 7. Original available | Authenticated encrypted source preview/download and explicit retention policy implemented; physical cleanup tested |
| 8. Automated tests | Parsing, validation, correction, native intake, transactional import and browser checks pass |
| 9. Existing tracking unaffected | Full inherited regression suite passes; production remains on the existing image; updated-image staging qualification pending |
| 10. CI and independent review | Scoped independent review complete; hosted CI must be verified for the published commit |

## Explicit limitations

- Tesseract is a printed-text baseline; no handwriting accuracy percentage is
  claimed. No source records leave the server for recognition.
- The Linux container is required for native resource limits and recognition.
- English OCR is the configured model. Hindi UI keys satisfy the existing
  translation gate; native-speaker localization review is still pending. Other
  newly added language keys use Sprout's existing English fallback behavior.
- Finalization locks the whole document, including unchecked rows. Incremental
  completion is a separate follow-up, with clear warnings in this slice.
- Synthetic Chromium viewport tests do not prove Safari, physical camera upload,
  offline import, medical accuracy, or a restored production deployment.
- No overall project completion percentage is inferred from these test counts.

See [staging and release gates](STAGING.md) and [OCR engine evaluation](OCR_ENGINES.md).
