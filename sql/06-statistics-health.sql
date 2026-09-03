/* Selected tables statistics freshness. */
SELECT
    OBJECT_SCHEMA_NAME(s.object_id) AS schema_name,
    OBJECT_NAME(s.object_id) AS table_name,
    s.name AS stats_name,
    sp.last_updated,
    sp.rows,
    sp.rows_sampled,
    sp.modification_counter,
    CASE WHEN sp.rows > 0 THEN CAST(sp.modification_counter * 100.0 / sp.rows AS decimal(10,2)) END AS modification_pct
FROM sys.stats s
CROSS APPLY sys.dm_db_stats_properties(s.object_id, s.stats_id) sp
WHERE s.object_id IN (/* selected table ids */ 0)
ORDER BY modification_pct DESC;
