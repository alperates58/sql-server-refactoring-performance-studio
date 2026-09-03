/* Read-only metadata query: AA_* view inventory + source text. */
SELECT
    s.name AS schema_name,
    v.name AS view_name,
    v.object_id,
    v.create_date,
    v.modify_date,
    OBJECT_DEFINITION(v.object_id) AS definition
FROM sys.views AS v
JOIN sys.schemas AS s ON s.schema_id = v.schema_id
WHERE v.is_ms_shipped = 0
  AND v.name LIKE '{{PREFIX}}%'
ORDER BY v.name;
