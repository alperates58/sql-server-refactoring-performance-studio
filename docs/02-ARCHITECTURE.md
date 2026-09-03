# Architecture

## Runtime

Browser → localhost Node.js → SQL Server / AI Provider

Browser never connects directly to SQL Server or AI provider with persisted credentials.

## Backend Modules

### Connection Manager
Owns an in-memory `mssql` connection pool. Future multi-profile support must encrypt secrets using OS capabilities.

### Capability Detector
On connection:
- SQL Server version/edition.
- compatibility level.
- Query Store state.
- database collation.
- permissions available.
- database size/approx table row counts from metadata.

### Metadata Scanner
Reads:
- sys.views
- sys.schemas
- sys.sql_modules
- sys.sql_expression_dependencies
- sys.objects
- sys.columns
- sys.types
- sys.indexes/index_columns
- sys.stats + dm_db_stats_properties when permitted

### Dependency Engine
Produces directed graph with:
- direct dependencies
- transitive downstream dependencies
- reverse/upstream dependents
- depth
- fan-in/fan-out
- cycles
- unresolved/ambiguous refs
- repeated base-table paths

### Static Analyzer
V1 regex heuristics; evolve toward AST/parser.
Findings should include exact source range once parser is available.

### Runtime Evidence Engine
Preferred order:
1. Query Store.
2. plan cache (`dm_exec_query_stats`).
3. cached plan XML.
4. historical snapshots created by Studio.

Never imply perfect per-view accounting when evidence is heuristic.

### Plan X-Ray
Parse execution plan XML for:
- Index/Table Scan/Seek
- Nested Loops / Hash / Merge
- Key Lookup
- Sort
- Spool
- spills/warnings
- implicit conversion warnings
- missing index hints
- memory grant
- estimated vs actual rows when actual plan evidence exists
- parallelism
- scalar operators/UDF

### Snapshot Store
Future recommended: local SQLite database, not SQL Server, to avoid modifying ERP DB.
Store scans, object hashes, metrics, regressions, candidate history. Secrets excluded.

### AI Adapter
Provider interface:
- `buildContext()`
- `generateCandidate()`
- `normalizeResponse()`
Providers: DeepSeek, OpenAI-compatible, future local.

### Validation Engine
Runs only explicit user-approved checks. Must apply timeout/row-limit strategies and cancellation.

## Suggested Domain Objects

```js
ViewObject {
  id, schema, name, definitionHash, modifyDate,
  healthScore, riskScore, riskLevel,
  findings[], runtimeEvidence[], dependencyStats
}

DependencyEdge {
  sourceId, targetId, targetType,
  resolved, ambiguous, source: 'sql_expression_dependencies'|'parser'
}

Finding {
  code, title, severity, healthPenalty,
  evidenceGrade, explanation, sourceLocation?, metadata
}

RuntimeEvidence {
  source: 'query_store'|'plan_cache'|'snapshot',
  grade: 'A'|'B'|'C'|'D', attributionMethod,
  queryId?, planId?, executionCount?, avgDuration?, logicalReads?, cpu?
}

RefactorCandidate {
  id, viewId, createdAt, provider, model,
  sourceHash, sql, rationale, risks, suggestedIndexes,
  status: 'UNVALIDATED'|'SEMANTICALLY_VALIDATED'|'BENCHMARKED'|'EXPORTED'
}
```
