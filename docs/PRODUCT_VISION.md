# Product Vision

## Vision

BabyTracker should become the family's single source of truth for infant and child care records: fast enough for real-time logging, rich enough for medical/caregiver handoff, and private enough to self-host.

## Core experience

A caregiver opens the app on a phone or iPad and can immediately:

- see what happened most recently;
- see what is currently active;
- start or stop a feed, pump, activity, or sleep session;
- log a diaper with one or two taps;
- see when a feed, dose, nap, or bedtime is likely due;
- view the next suggested sleep window;
- upload/import records produced elsewhere;
- hand off care to another caregiver without losing context.

## Target feature domains

### Care tracking
- breastfeeding, left/right/both, side timing, pause/resume, linked sessions
- bottle feeds, formula, breast milk, mixed feeds, units, reactions
- pumping, left/right totals, storage/fed/discarded actions, milk inventory
- food/solids, foods tried, first-100-foods view, allergens/reactions
- diapers, wet/dirty/both/dry, condition, color, amount, blowout, cream, notes
- sleep, naps/night sleep, start/end, location, quality, notes
- tummy time, play, walk, outdoor/indoor activity, bath
- mood and free-form notes
- temperature
- medication and supplements, dosing intervals, reminders
- vaccinations and supporting documents
- growth: weight, height/length, head circumference, BMI where useful
- milestones
- photos linked to events
- tags/categories for flexible grouping

### Family/caregiver operations
- multiple babies/children
- multiple caregivers
- caregiver attribution
- family-level permissions
- nursery/night mode
- handoff summary
- contacts/providers
- calendar and reminders
- push notifications
- dark mode
- localization
- accessibility

### Reporting and interoperability
- timeline and searchable full log
- day/week/month views
- calendar
- growth charts using CDC/WHO references
- corrected-age handling for prematurity
- feeding/sleep/diaper reports
- monthly report card
- CSV/XLSX/PDF export
- backup/restore
- full REST/OpenAPI API
- webhooks
- Home Assistant integration compatibility
- MCP/AI integration surface
- import from Baby Buddy and Sprout Track

### Intelligent sleep planning
- age-aware baseline wake windows
- personalized wake-window learning
- next nap/sleep-ready prediction
- wind-down start recommendation
- predicted nap duration
- predicted wake time
- bedtime projection and dynamic recalculation
- confidence range and explanation
- per-child model/history
- caregiver override/manual adjustment
- clear separation between planning assistance and medical guidance

### Document ingestion
- upload completed PDFs from daycare, hospital, caregivers, or worksheets
- extract embedded PDF form fields when available
- parse digital text
- support scanned pages/images where feasible
- map extracted records into canonical feed/diaper/sleep/etc. events
- show confidence and source provenance
- force human review for uncertain values
- deduplicate and reconcile with existing records
- retain the original source document according to configurable privacy policy

## Experience principles

1. **Fast first.** Common logging should take seconds.
2. **Never silently lose data.**
3. **Predictions are explainable suggestions, not hidden magic.**
4. **Imports are reviewable before becoming truth.**
5. **Caregiver mistakes must be easy to undo/correct.**
6. **The UI should remain useful on a tired, one-handed mobile workflow.**
7. **No cloud dependency should be required for core tracking.**
