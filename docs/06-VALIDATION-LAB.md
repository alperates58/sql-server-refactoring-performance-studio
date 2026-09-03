# Validation Lab

## Objective

Refactoring is accepted only when semantic equivalence is demonstrated to a useful degree and performance is measured separately.

## Stage 1 — Metadata Compatibility

Compare:
- output column count/order/name.
- SQL type/length/precision/scale.
- nullable metadata where derivable.

## Stage 2 — Static Semantic Review

Check critical invariants:
- joins and join type.
- WHERE/HAVING predicates.
- grouping.
- DISTINCT/UNION duplicate semantics.
- TOP/order behavior.
- window partitions/order.
- NULL/zero arithmetic handling.

## Stage 3 — Result Equivalence

Only after user action.
Possible methods depending on query:
- bounded representative predicates.
- both-direction `EXCEPT`.
- row count.
- deterministic checksum as secondary signal, never sole proof.

Warnings:
- `EXCEPT` has set semantics and eliminates duplicates; it cannot alone prove duplicate multiplicity.
- Use grouped row-hash/count approach if duplicate multiplicity matters.
- Large result comparisons may be expensive; allow cancellation/timeout.

## Stage 4 — Benchmark

Only explicit action.
Capture:
- elapsed time.
- CPU.
- logical reads.
- physical reads where relevant.
- row count.
- execution plan hash/id.
- warnings/spills.

Use multiple controlled runs where possible. Distinguish cold/warm cache tests. Do not clear production cache.

## Result Status

- PASS: checks support equivalence.
- FAIL: concrete differences.
- INCONCLUSIVE: insufficient proof or timeout.

Never map timeout to PASS.
