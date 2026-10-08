# External Document and PDF Import Pipeline

## Goal

A caregiver should be able to upload an external completed PDF containing feeding, diaper, sleep, medication, or other care information and turn that document into proposed BabyTracker records.

This includes:

- fillable PDFs with form fields;
- digitally generated PDFs containing text/tables;
- scanned PDFs;
- photographed/handwritten worksheets where recognition quality is sufficient.

## Safety model

An import is never authoritative merely because parsing succeeded.

Every extracted record must preserve:

- source document identifier;
- source page;
- extraction method;
- raw source snippet/field;
- parsed value;
- confidence;
- mapping decision;
- reviewer decision;
- created canonical record ID.

## Parsing tiers

### Tier 1 — native PDF fields

Prefer AcroForm/XFA-style field extraction when available.

Advantages:
- highest precision
- field names often encode meaning
- no OCR required

### Tier 2 — embedded text/table extraction

Parse text and geometry from digital PDFs.

Use:
- page coordinates
- table structure
- labels
- nearby values
- date/time context

### Tier 3 — visual/scanned extraction

Render pages and apply document/image understanding or OCR only when necessary.

Requirements:
- retain page image for review
- never auto-commit low-confidence handwriting
- support manual correction

## Candidate event schema

All parsers should emit a common structure similar to:

```json
{
  "source": {
    "documentId": "...",
    "page": 2,
    "parser": "pdf-form-v1"
  },
  "eventType": "feeding",
  "babyId": null,
  "occurredAt": "2026-10-06T08:15:00-05:00",
  "fields": {
    "amount": 65,
    "unit": "mL",
    "feedType": "formula"
  },
  "confidence": 0.96,
  "warnings": []
}
```

## Review UX

The reviewer should see:

- original page beside extracted records;
- field-level confidence/warnings;
- duplicate warnings;
- ability to edit values;
- select/deselect candidate rows;
- bulk approve only when confidence is high;
- final import summary.

## Deduplication

Use combinations of:

- child
- event type
- timestamp window
- amount/duration
- source record ID
- existing imported-document provenance

Never silently overwrite an existing record.

## Supported first-pass PDF use cases

1. Feeding logs
2. Diaper logs
3. Sleep logs
4. Medication logs
5. Temperature/vitals
6. Growth measurements

Later:
- mixed caregiver shift sheets
- daycare daily sheets
- hospital/NICU-style logs
- pediatric visit summaries

## Privacy

Original documents may contain sensitive health information.

Required:
- local processing where practical;
- explicit retention configuration;
- encryption-at-rest option for source documents;
- redaction/deletion workflow;
- do not send files to third-party AI services unless explicitly configured and acknowledged.
