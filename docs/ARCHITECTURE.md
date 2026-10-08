# Architecture Direction

## Guiding principle

Do not literally merge Baby Buddy's Django/Python tree with Sprout Track's Next.js/TypeScript tree.

The combined application should have one canonical data model and a small number of explicit boundaries.

## Proposed logical architecture

```text
Phone / iPad / desktop
        |
        v
Mobile-first Web/PWA
        |
        v
Canonical BabyTracker API
        |
        +----------------------+
        |                      |
        v                      v
Primary database         Import subsystem
(PostgreSQL)             (PDF/CSV/external)
        |
        +----------------------+
        |                      |
        v                      v
Sleep intelligence       Integration adapters
module/service           (Baby Buddy/HA/MCP/webhooks)
```

## Core boundaries

### 1. Canonical tracker core

Owns:

- children
- caregivers/families
- activities
- feeds
- diapers
- sleep
- health/growth
- medications/vaccines
- foods/allergens
- media
- timeline/reporting

No imported source should be allowed to define its own permanent schema inside the core.

### 2. Import subsystem

Every import should pass through:

```text
source document/file
  -> source parser
  -> normalized candidate events
  -> validation
  -> dedupe/reconciliation
  -> human review
  -> canonical commit
```

### 3. Sleep intelligence subsystem

Consumes canonical historical records and returns predictions. It should not own the authoritative event history.

### 4. Compatibility adapters

Adapters can expose:

- Baby Buddy-compatible endpoints where useful
- Home Assistant-friendly events/entities
- MCP resources/tools
- signed webhooks
- external import/export mappings

## Deployment target

Recommended production deployment:

```text
docker compose
  babytracker-web/api
  postgres
  sleep-intelligence (optional separate service)
  worker/queue (if needed)
  reverse proxy (optional)
```

Core logging must remain functional even if sleep intelligence or AI/document parsing is unavailable.

## Platform requirements

- amd64 and arm64 images
- health checks
- versioned migrations
- backup before destructive migrations
- restore verification
- local filesystem/object storage abstraction for attachments
- secrets via environment variables/secrets files
- no hard dependency on commercial APIs for normal tracking
