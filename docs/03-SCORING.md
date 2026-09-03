# Health & Risk Scoring

## Why Two Scores

`Health` = query/view construction quality.
`Risk` = how urgently it matters in the live system.

A complex unused legacy view may have Health 30, Risk 15. A moderately unhealthy view called 20k/day with regression may have Health 60, Risk 95.

## Health Score

Start 100. Subtract explainable penalties.

Candidate V1 rules:

- dependency depth > 3: up to -12.
- repeated physical base-table paths: up to -18.
- DISTINCT: -5 only when potentially unnecessary; initial heuristic must be labelled.
- UNION instead of UNION ALL: -6 heuristic.
- window functions: -4; do not imply ROW_NUMBER is inherently bad.
- non-SARGable function around join/filter: up to -12.
- scalar UDF: up to -10.
- wildcard SELECT: -3.
- high runtime IO evidence: up to -14.
- active performance regression: up to -16.
- very high blast radius: up to -8.

Important: syntax occurrence ≠ defect. Findings must distinguish `pattern detected` and `confirmed plan impact`.

## Risk Score

Suggested composition:

- 40% runtime cost percentile.
- 20% active regression severity.
- 15% `(100 - Health)`.
- 15% blast radius / centrality.
- 10% execution frequency/business exposure.

If runtime unavailable, renormalize and mark Risk confidence lower.

## Risk Levels

- 0–34 LOW
- 35–54 MEDIUM
- 55–74 HIGH
- 75–100 CRITICAL

## Evidence Confidence

Risk UI should show confidence/evidence grade separately. A `Critical, Evidence D` item means urgent-looking static structure but not proven runtime damage.
