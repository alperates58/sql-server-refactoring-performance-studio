/* Read-only dependency edges. Includes referenced views/tables/functions when resolvable. */
SELECT
    OBJECT_SCHEMA_NAME(d.referencing_id) AS source_schema,
    OBJECT_NAME(d.referencing_id) AS source_name,
    d.referencing_id AS source_object_id,
    d.referenced_schema_name AS target_schema,
    d.referenced_entity_name AS target_name,
    d.referenced_id AS target_object_id,
    CASE
      WHEN d.referenced_id IS NULL THEN 'UNRESOLVED'
      ELSE COALESCE(o.type_desc, 'UNKNOWN')
    END AS target_type,
    d.is_ambiguous
FROM sys.sql_expression_dependencies AS d
LEFT JOIN sys.objects AS o ON o.object_id = d.referenced_id
WHERE OBJECT_NAME(d.referencing_id) LIKE '{{PREFIX}}%'
ORDER BY source_name, target_name;
