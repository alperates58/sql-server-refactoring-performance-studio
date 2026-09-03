/* Query Store sample. Mapping a view to runtime cost is heuristic because views are expanded into calling queries. */
SELECT TOP (200)
    q.query_id,
    qt.query_sql_text,
    p.plan_id,
    rs.last_execution_time,
    rs.count_executions,
    rs.avg_duration,
    rs.avg_cpu_time,
    rs.avg_logical_io_reads,
    rs.avg_rowcount
FROM sys.query_store_query AS q
JOIN sys.query_store_query_text AS qt ON qt.query_text_id = q.query_text_id
JOIN sys.query_store_plan AS p ON p.query_id = q.query_id
JOIN sys.query_store_runtime_stats AS rs ON rs.plan_id = p.plan_id
WHERE rs.last_execution_time >= DATEADD(HOUR, -24, SYSUTCDATETIME())
ORDER BY rs.avg_logical_io_reads DESC;
