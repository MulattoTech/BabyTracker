# Sleep Intelligence

## Objective

Implement adaptive sleep planning that provides Huckleberry-style user value while using independently designed logic and BabyTracker-owned data.

## Required outputs

For each child, when sufficient data exists:

- next likely sleep-ready window;
- suggested wind-down start;
- predicted nap duration;
- predicted wake time;
- projected bedtime;
- confidence interval;
- explanation of the main contributing factors.

## Inputs

Potential features:

- chronological age
- corrected age when premature
- time since last wake
- recent wake-window history
- nap index within the day
- previous nap duration
- recent total daytime sleep
- overnight sleep
- time of day/circadian position
- recent feeding timing
- recent feeding amount/type where useful
- day-of-week/caregiver/environment only if validated as useful
- user-configured schedule constraints

## Progressive model

### Phase 1 — deterministic baseline

Age/corrected-age reference wake windows plus caregiver-configurable offsets.

### Phase 2 — personalized statistics

Per-child rolling medians/quantiles by:
- nap index
- time of day
- previous nap length
- recent sleep debt

### Phase 3 — supervised prediction

Compare simple interpretable models before complex ML:
- regularized regression
- gradient boosting/random forest
- quantile prediction

Do not ship a more complex model unless it measurably beats the simpler baseline.

## Prediction types

### A. Next-sleep-start prediction

Primary user-facing feature.

```text
last wake
 + personalized wake-window estimate
 -> predicted sleep-ready interval
```

### B. Nap-duration / wake prediction

Once sleep begins:

```text
sleep start + predicted duration -> expected wake
```

### C. Day re-planning

After every completed sleep:

- update actual-vs-predicted error;
- recalculate remaining naps;
- recalculate bedtime;
- notify only when the change is meaningful.

## Confidence

Predictions should show ranges rather than false precision.

Example:

> Next nap likely 1:42–2:02 PM. Start wind-down around 1:25 PM. Confidence: high, based on 11 similar wake windows.

## Evaluation

Store prediction snapshots so accuracy can be measured without hindsight leakage.

Metrics:
- mean absolute error for sleep start
- median absolute error
- interval coverage
- nap-duration error
- bedtime projection error
- accuracy by age and nap index

## Guardrails

- prediction must degrade gracefully with sparse data;
- caregivers can ignore/override recommendations;
- never present sleep planning as a medical diagnosis;
- corrected age should be available for premature babies;
- model changes require regression evaluation against saved histories.
