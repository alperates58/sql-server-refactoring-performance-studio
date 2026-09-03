# API Contract (V1)

All APIs are localhost-only and JSON.

## GET /api/health
Server health.

## GET /api/connection
Returns connection status only. Never returns password.

## POST /api/connection/test
Input: server, port, database, user, password, encrypt, trustServerCertificate.
Response: safe server/database metadata. Password is never returned.

## DELETE /api/connection
Close pool and clear in-memory connection profile.

## GET /api/capabilities
Returns SQL Server version/edition, compatibility, collation, Query Store status and detected permissions.

## POST /api/scan
Input: `{ "prefix": "AA_" }`.
Returns view summary objects + dependency edges. Full source definitions should be fetched lazily in future rather than returning all 600 definitions every scan.

## Future

- GET `/api/views/:objectId`
- GET `/api/views/:objectId/source`
- GET `/api/views/:objectId/graph?direction=both`
- GET `/api/views/:objectId/runtime?window=24h`
- GET `/api/views/:objectId/plans`
- POST `/api/views/:objectId/refactor`
- POST `/api/candidates/:id/validate`
- POST `/api/candidates/:id/benchmark`
- GET `/api/candidates/:id/export`

Use object IDs internally where possible. Never concatenate arbitrary object names into SQL.
