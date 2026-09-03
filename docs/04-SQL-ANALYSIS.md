# SQL Server Analysis Specification

## Inventory

Target by default: user views matching `AA_%`.
Make prefix configurable.

Capture:
- schema/name/object_id
- create/modify date
- definition
- definition hash
- referenced entities
- output columns/types (via metadata APIs where safe)

## Dependency Algorithm

Build direct edges from `sys.sql_expression_dependencies`.
Supplement unresolved dynamic/ambiguous references with parser findings.
Calculate:
- max downstream depth
- max upstream depth
- direct dependency count
- transitive dependency count
- dependent count
- base tables reached
- number of distinct paths to same base table
- circular paths

Repeated access finding should say `multiple dependency paths`, not automatically `multiple physical scans`. Physical scan claim requires plan evidence.

## Static Patterns

Detect and explain:
- SELECT DISTINCT
- UNION vs UNION ALL
- ROW_NUMBER/RANK/DENSE_RANK
- scalar UDF calls
- correlated subqueries
- CROSS/OUTER APPLY
- TOP without deterministic ORDER BY where relevant
- SELECT *
- expressions/functions around indexed predicate columns
- implicit-conversion risk from mismatched join types
- `LIKE '%x'` patterns
- OR-heavy predicates
- NOT IN nullable-subquery risk
- ISNULL/COALESCE in predicates/joins
- CAST/CONVERT on date/key columns
- repeated identical subqueries/aggregates
- GROUP BY + DISTINCT redundancy candidate
- nesting/derived-table complexity

No pattern should be called a performance bug solely because it exists.

## Runtime

### Query Store
Use for history when enabled. Aggregate by time interval and plan. Detect baseline vs current median/p95 where enough samples exist.

### Plan Cache
Fallback only. Clearly warn that restart/cache eviction resets data.

### Snapshot History
Studio should periodically persist aggregate metadata locally only when user explicitly enables scan history. This is not an automation requirement; it can occur on manual scans.

## Regression Detection

Minimum recommended conditions:
- enough execution samples.
- baseline window vs current window.
- duration/reads/cpu ratio threshold.
- absolute threshold to avoid noise.

Example:
- baseline median 0.94s
- current median 284s
- execution count sufficient
- plan id changed
→ high-confidence regression.

## Statistics Health

Read `sys.dm_db_stats_properties` where permitted.
Show last updated, rows, sampled rows, modification counter, modification %.
Do NOT automatically run UPDATE STATISTICS.

## Index Recommendations

Combine:
- existing index inventory.
- plan operators.
- query predicates/joins/order/group.
- missing index DMV/plan hints as supporting evidence only.

Never blindly accept SQL Server missing-index hints. Check overlap/redundancy/write cost.
