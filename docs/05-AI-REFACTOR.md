# AI Refactor Contract

## Provider

Initial UI can default to DeepSeek. Backend must remain OpenAI-compatible/provider-abstracted. Model names change; do not hard-code marketing names into core logic.

## Context Pack

Send only what is needed:
- target view source.
- dependency sources required to understand semantics.
- output schema/metadata.
- base table schemas for referenced columns.
- current indexes.
- relevant statistics health summary.
- repeated dependency paths.
- runtime evidence.
- plan X-Ray findings.
- SQL Server version/compatibility.

Avoid sending unrelated business data rows. Source definitions and metadata are enough for refactor generation.

## Required AI Output

Prefer structured JSON envelope:

```json
{
  "summary": "...",
  "candidateSql": "...",
  "changes": [],
  "semanticRisks": [],
  "performanceHypotheses": [],
  "indexSuggestions": [],
  "validationChecks": [],
  "confidence": 0.0
}
```

## Prompt Guardrails

The model must be told:
- exact output semantics are mandatory.
- CTE does not guarantee materialization.
- no fake performance claims.
- every rewrite must explain why.
- preserve `UNION` duplicate semantics unless proven safe.
- preserve OUTER JOIN null-extension behavior.
- preserve arithmetic NULL/zero behavior such as `NULLIF`.
- preserve collation/data-type behavior.
- do not invent columns/indexes.
- no DDL execution.

## Candidate Lifecycle

1. `GENERATING`
2. `UNVALIDATED`
3. `STATIC_CHECK_PASSED`
4. `SEMANTICALLY_VALIDATED`
5. `BENCHMARKED`
6. `EXPORTED`

`DEPLOYED` should not exist until a future explicitly-designed deployment feature.
