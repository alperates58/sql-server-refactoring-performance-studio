# Implementation Checklist

## Connection
- [ ] timeout/cancel
- [ ] safe TLS options
- [ ] capability detection
- [ ] no secret logs
- [ ] disconnect state

## Inventory
- [ ] lazy source loading
- [ ] definition hashes
- [ ] object output schema
- [ ] unresolved deps
- [ ] cycles
- [ ] reverse graph

## Static Analyzer
- [ ] finding codes
- [ ] severity vs confidence
- [ ] AST/parser migration path
- [ ] source line/range

## Runtime
- [ ] Query Store available/unavailable UI
- [ ] plan cache volatility warning
- [ ] evidence grades
- [ ] baselines
- [ ] regression thresholds
- [ ] plan-id change detection

## Plan X-Ray
- [ ] estimated/actual distinction
- [ ] spills
- [ ] memory grants
- [ ] implicit conversions
- [ ] lookup counts
- [ ] scans/seeks
- [ ] parallelism

## Refactor
- [ ] provider abstraction
- [ ] context preview before send
- [ ] structured response validation
- [ ] candidate state machine
- [ ] no direct deployment

## Validation
- [ ] metadata compare
- [ ] duplicate-aware result compare
- [ ] timeout/cancel
- [ ] explicit benchmark consent
- [ ] no production cache flush
- [ ] inconclusive state

## UX
- [ ] loading skeletons
- [ ] empty states
- [ ] error retry
- [ ] keyboard search
- [ ] large graph performance
- [ ] responsive fallback
- [ ] export/share report
