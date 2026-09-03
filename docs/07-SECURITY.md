# Security & Permission Model

## Default

Localhost-bound Node server (`127.0.0.1`). Do not expose to LAN by default.

## Secrets

- SQL password in process memory only.
- AI API key in process memory/request scope only.
- never echo keys in errors/logs.
- never persist to browser storage.
- future persistence must use OS secret storage.

## SQL Permissions

Use a dedicated account. Exact permissions depend on SQL Server version and runtime features.
Aim for least privilege:
- connect to target database.
- VIEW DEFINITION for object metadata.
- permissions required to read Query Store metadata.
- VIEW DATABASE STATE / equivalent only when required for DMVs.

Do not grant db_owner/sysadmin merely for convenience.

## Write Operations

V1 has no DB writes. Candidate SQL is export-only.

## AI Data Boundary

Before sending context, UI must show what metadata/source will leave the machine. Business row samples should not be sent by default.
