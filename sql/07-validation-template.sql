/* TEMPLATE ONLY. Run only after explicit user action and with safe timeout/row limits. */
-- Goal: compare old and candidate outputs in a controlled environment.
-- 1) Validate metadata separately (columns/order/types/nullability).
-- 2) Compare row counts only where bounded and safe.
-- 3) Use EXCEPT in both directions when deterministic and affordable.
-- 4) Benchmark with SET STATISTICS IO, TIME ON only in an explicitly approved lab run.

-- SELECT * FROM old_result EXCEPT SELECT * FROM candidate_result;
-- SELECT * FROM candidate_result EXCEPT SELECT * FROM old_result;
