/* Parameterize @qualifiedViewName in production. Do not concatenate user input. */
SELECT
    column_ordinal,
    name,
    system_type_name,
    is_nullable,
    error_number,
    error_message
FROM sys.dm_exec_describe_first_result_set(
    N'SELECT * FROM dbo.AA_EXAMPLE_VIEW',
    NULL,
    0
)
ORDER BY column_ordinal;
