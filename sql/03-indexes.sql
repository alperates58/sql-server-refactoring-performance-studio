/* Index inventory for base tables involved in a selected view graph. */
SELECT
    s.name AS schema_name,
    t.name AS table_name,
    i.name AS index_name,
    i.index_id,
    i.type_desc,
    i.is_unique,
    i.is_primary_key,
    i.is_disabled,
    STRING_AGG(CASE WHEN ic.is_included_column = 0 THEN c.name END, ', ') WITHIN GROUP (ORDER BY ic.key_ordinal) AS key_columns,
    STRING_AGG(CASE WHEN ic.is_included_column = 1 THEN c.name END, ', ') AS included_columns
FROM sys.tables t
JOIN sys.schemas s ON s.schema_id = t.schema_id
JOIN sys.indexes i ON i.object_id = t.object_id
LEFT JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
LEFT JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
WHERE t.object_id IN (/* parameterized selected base table ids */ 0)
GROUP BY s.name,t.name,i.name,i.index_id,i.type_desc,i.is_unique,i.is_primary_key,i.is_disabled
ORDER BY t.name,i.index_id;
