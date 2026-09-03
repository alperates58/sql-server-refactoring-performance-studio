/* Robust read-only SQL Server capability and permission detection */
DECLARE @has_qs bit = 0;
DECLARE @qs_actual nvarchar(60) = 'NOT_SUPPORTED';
DECLARE @qs_desired nvarchar(60) = 'NOT_SUPPORTED';

IF OBJECT_ID('sys.database_query_store_options') IS NOT NULL
BEGIN
    SET @has_qs = 1;
    EXEC sp_executesql N'
        SELECT TOP 1
            @act = actual_state_desc,
            @des = desired_state_desc
        FROM sys.database_query_store_options;',
        N'@act nvarchar(60) OUTPUT, @des nvarchar(60) OUTPUT',
        @act = @qs_actual OUTPUT,
        @des = @qs_desired OUTPUT;
END

SELECT
    CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)) AS product_version,
    CAST(SERVERPROPERTY('ProductLevel') AS nvarchar(128)) AS product_level,
    CAST(SERVERPROPERTY('Edition') AS nvarchar(128)) AS edition,
    CAST(SERVERPROPERTY('MachineName') AS nvarchar(128)) AS machine_name,
    DB_NAME() AS database_name,
    d.compatibility_level,
    d.collation_name,
    d.is_read_committed_snapshot_on,
    d.snapshot_isolation_state_desc,
    @has_qs AS query_store_supported,
    COALESCE(@qs_actual, 'OFF') AS query_store_state,
    COALESCE(@qs_desired, 'OFF') AS query_store_desired_state,
    HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'VIEW DEFINITION') AS can_view_definition,
    HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'VIEW DATABASE STATE') AS can_view_database_state,
    COALESCE(HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'VIEW DATABASE PERFORMANCE STATE'), 0) AS can_view_performance_state,
    (SELECT COUNT(*) FROM sys.tables WHERE is_ms_shipped = 0) AS user_table_count,
    (SELECT COUNT(*) FROM sys.views WHERE is_ms_shipped = 0) AS user_view_count,
    (SELECT COALESCE(SUM(p.rows), 0) FROM sys.partitions p JOIN sys.tables t ON t.object_id = p.object_id WHERE p.index_id IN (0, 1) AND t.is_ms_shipped = 0) AS approx_total_rows,
    (SELECT COALESCE(SUM(CAST(size AS bigint) * 8 / 1024), 0) FROM sys.database_files) AS approx_size_mb
FROM sys.databases d
WHERE d.database_id = DB_ID();

