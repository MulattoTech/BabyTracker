# ADR 0001 — Fast, safe initial deployment

**Status:** Accepted for Phase 0

## Why Sprout Track first?

Sprout Track already covers most daily tracking tasks with excellent mobile/PWA UX, built-in PDF **export** (not arbitrary uploaded PDF parsing), data imports, monthly reporting, multiple caregivers and optional integrations.

Baby Buddy provides valuable API/maturity features but running both against independent databases would create split-brain logs. One authoritative record store is safer and simpler.

## Decision

1. Create a dedicated private `MulattoTech/BabyTracker` repository.
2. Deploy Sprout Track **unmodified**, pinned to an explicit version, using isolated Docker named volumes.
3. Keep web listener bound to loopback on the host. Use existing Tailscale Serve for private HTTPS access to mobile/iPad when possible.
4. Do not publish public access (no Funnel, no router port forwards).
5. Retain encrypted-file key/config volume along with database and attachment volumes; never store secrets in GitHub.
6. Keep updaters opt-in and backup-first. CI can *propose* upgrades, never auto-merge a migration.
7. Feature additions live in optional services/adapters or a minimal-upstream-diff fork.
8. No promise of complete feature union or Huckleberry prediction until implemented and validated.

## Follow-on phases

- Phase 1: tested backup/restore, mobile UX, corrected-age/temperature gap audit, feature matrix.
- Phase 2: Baby Buddy API import/compatibility, Home Assistant/MCP adapters.
- Phase 3: filled-PDF import with field provenance and review; never auto-commit uncertain handwriting.
- Phase 4: independent adaptive nap/bedtime and predicted wake models, evaluated against baseline.
- Phase 5: unified branding, mature automated upstream qualification.

## Licensing

Sprout Track's license includes non-commercial and share-alike conditions. Do not copy Sprout code into a differently licensed public product or commercialize without obtaining rights/independent legal review.
