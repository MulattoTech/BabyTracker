# ExternalImport

Family-scoped external-platform import flow.

The component supports Baby Buddy CSV exports and Huckleberry care log CSV exports, and guides family administrators through:

1. selecting CSV files;
2. previewing detected records and warnings;
3. configuring child destination, source timezone and source units;
4. reviewing the planned import;
5. executing the import and viewing created/already-imported counts.

## Photo/PDF feeding and diaper logs

The experimental **Photo or PDF care log** path accepts JPEG, PNG, WebP, BMP, and PDF files. PDF.js extracts embedded text when present and renders pages locally when image recognition is needed. Tesseract.js and its English model are bundled and served by this application; uploads are not sent to a third-party OCR service. The scanned file, page preview, and raw recognized text stay in the browser. The commit request contains only selected, corrected event fields and a SHA-256 source fingerprint with page/line provenance.

OCR is a rough first draft. Tesseract is not tuned for handwriting, and recognition may miss or misread entries. Caregivers must compare each selected row with its source page and explicitly mark it reviewed. Date, time, feeding method, bottle amount/unit, and diaper kind remain unresolved until chosen or corrected; the server rejects incomplete rows. Ambiguous dates and 12-hour times without AM/PM are not guessed. Nonexistent or repeated daylight-saving local times are rejected until the caregiver chooses an unambiguous time.

Rows can be edited, split at a line break, merged with another row on the same page, removed, or added manually. Import writes are additive and use the existing family-scoped `ExternalImportRecord` uniqueness key for repeat-submit deduplication. Baby ownership comes from the authenticated family. The first slice recognizes feeding and diaper events only; it does not infer sleep, health, or growth records.

`npm run dev` and `npm run build` run `scripts/prepare-ocr-assets.mjs` to copy pinned local worker, WebAssembly, PDF.js, and English model assets from the lockfile dependencies into `public/ocr/`. Third-party licenses and notices are copied alongside those assets. No source documents or OCR text are persisted by this path.

External imports are additive. The importer does not use database restore endpoints and does not modify or delete existing Sprout Track records.

## Skipped files, activity-only children, and medication imports

- Files that don't match a supported Baby Buddy export are skipped rather than aborting the whole import. The Configure step surfaces a "Files that will be skipped" warning listing each skipped file and its reason; if none of the uploaded files are usable, the preview step blocks progression with an error instead.
- Children that only appear in activity files (no accompanying Child export) are still listed for mapping, but can only be added to an existing baby — the destination defaults to "existing" and the new-baby option is not offered for them. If no existing babies are available yet, the card prompts the user to create one first or include the Child export file.
- Medication export files import as medicine logs. Doses without an amount import with a quantity of 0, surfaced via the `medication-dosage-missing` warning.
- When two or more imported children are mapped to the same existing baby, the Configure and Review steps show a non-blocking "Same destination selected for multiple children" warning (their records would be combined under one baby). Deliberate merging remains possible.

## Huckleberry care logs

Huckleberry exports do not identify the child, so the care log must be mapped to an existing Sprout Track baby. Feed, diaper, and pumping rows are supported. Source `ml` or `oz` amounts are preserved per record. Unsupported activity types are counted in the preview and skipped.

Huckleberry does not export pumping duration, so pumping rows use the event time for both start and end and import with a zero-minute duration. Deterministic row fingerprints make repeated cumulative exports idempotent, including exact duplicate rows.
