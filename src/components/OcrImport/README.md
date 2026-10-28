# Document import review

The authenticated `/{familySlug}/ocr-import` route shares Sprout's selected-child context.
It uses only family-authorized `/api/ocr/documents` endpoints; source previews and downloads
are fetched with an authorization header and rendered from temporary blob URLs.

## Workflow

1. Choose a child, upload a supported image/PDF, choose server-side or browser-local printed-text recognition, and explicitly choose source date/clock/timezone context. Browser recognition sends bounded recognized text and normalized line locations with the original file to the authenticated OCR endpoint; no third-party service receives them.
2. Compare the original page with editable feeding, diaper and sleep drafts. Unknown handwriting can be manually transcribed.
3. Check individual approved rows or explicitly bulk-approve valid rows after review. Edits and timezone changes clear approval.
4. Save incomplete drafts without creating events. Preview approved rows against existing care records.
5. Resolve every reported duplicate as a deliberate skip or a distinct event, acknowledge source/warning review, and confirm the import.

Unchecked rows remain in the draft/audit and are not selected for canonical import. Confirmation finalizes
the whole document, including unchecked rows: resumable partial batches are not implemented in this slice.
The final confirmation warns about this explicitly. Committed documents are displayed as locked history.
Source deletion is an explicit separate action preserving care events
and audit history. No drafts or source images are persisted to browser storage by this component.

## Components

- `useOcrImport.ts`: scoped asynchronous state, cancellation, optimistic revision requests, draft/preview/commit actions.
- `UploadPanel.tsx`: bounded format intake, clock context, rotation and retention settings.
- `SourcePanel.tsx`: authorized previews, page selection, enlargement, download and deletion.
- `RowEditor.tsx`: original text/provenance, corrections, per-row approval, manual split and removal.
- `TimeChoice.tsx`: explicit selection of repeated DST clock occurrences.
- `ReviewActions.tsx`: selected-row preview, duplicate choices and final confirmation.
- `review-helpers.ts`: pure draft updates and validation helpers.

The English printed-text baseline is stated explicitly. Handwriting recognition is unsupported; unclear entries remain unknown until manually transcribed. Engine scores are not field correctness probabilities. Both recognition modes create only encrypted canonical OCR drafts; only the audited explicit confirmation endpoint writes care events.
Translation keys for the feature are collected in `translation-keys.json` for integration with the existing localization files.
