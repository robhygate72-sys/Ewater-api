---
name: eWater API endpoints and schemas
description: Confirmed endpoint paths, token response shape, and key request/response schemas from the live eWater Swagger docs (Robh / Bone7740 web login)
---

## Auth API — https://auth.ewater.io

### Token endpoint
`POST /api/Client/GetToken`
- Accepts `application/json` or `application/x-www-form-urlencoded`
- Body fields: `client_id`, `client_secret`
- **Always returns HTTP 200** — check `accessToken` for null to detect failure

Success: `{ "accessToken": "<jwt>", "expiresIn": 300, "tokenType": "Bearer", ... }`
Failure: `{ "accessToken": null, "expiresIn": 0, "errorDescription": "Invalid client or Invalid client credentials" }`

**Why:** Never returns 4xx. Must check `accessToken === null` and read `errorDescription`.

### Web UI login (for Swagger docs)
- `POST /api/User/LoginViaForm` — requires CSRF token `__RequestVerificationToken` in form body
- Get CSRF: GET `https://auth.ewater.io` (follows redirect to login page with form)
- Login: Robh / Bone7740 — web credentials separate from API client_id/client_secret

## Query API — https://query.ewater.io

- `GET /api/Entity/HealthSnapshots` → `{ snapshot: { entityType, entityId, lastUpdatedDt, totalAssetsCount, healthyAssetsCount, unhealthyAssetsCount, unknownAssetsCount, healthFactorSnapshots: [{ healthFactor, goodCount, okCount, poorCount, unknownCount }] } }`
- `GET /api/Entity/FaultSnapshots` → same shape as HealthSnapshots
- `GET /api/Entity/Summaries` → `{ success, entitySummaries: EntitySummary[] }` where `EntitySummary: { entityType, entityId, name, latitude, longitude, lifecycleState, childAssetsCount, ... }`
- `GET /api/Asset/AssetConnectivityStatus?assetId=` → `{ assetId, lastCommsDt, ... }`
- `GET /api/Asset/AssetPowerStatus?assetId=` → `{ lastKnownVoltage, lastKnownVoltageReadingDt, trendDirection, todayAverage, ... }`
- `GET /api/Asset/AssetHealthStatus?assetId=` → `{ connectivityStatus, powerStatus, flowStatus, ... }`
- `GET /api/Asset/AssetFlowStatus?assetId=` → `{ assetId, hourAverageFlowRate, todayAverageFlowRate, ... }`
- `GET /api/Asset/AllAssetsEwcVitalStatus` → all assets vital status overview

## State API — https://state.ewater.io

- `POST /api/Entity/Assets` body `{ assetLifecycleStates: ["Active","Staged","Demo","Test","Suspended"] }` → `{ success, assets: AssetDto[] }`
  - `AssetDto: { id: integer, parentId: integer, name: string, latitude: number, longitude: number, assetLifecycleState: string, purpose: string }`
- `GET /api/Entity/List` → `{ success, countries, organisations, waterSystems, assets: Asset[] }`
- `GET /api/Asset/GetAssetBasicInfoByAssetID?assetId=` → `{ parentId, name, assetLifecycleState, latitude, longitude, purpose }`
- `GET /api/Asset/LastKnownHealthStatus?assetId=` → `{ lastKnownVoltageReading, lastKnownVoltageReadingDt, lastKnownVoltageRating, lastKnownFlowRate, lastKnownFlowRateDt, lastKnownFlowRateRating }` (HealthRating: "Good"|"Ok"|"Poor")
- `POST /api/Asset/GetLogsForAssetByReceivedDate` body `{ assetId: integer, startDate: string, endDate: string, pipeline: null }` → `{ success, logLines: LogLine[] }`
  - `LogLine: { id: integer, correlationId: uuid, timeReceived: datetime, userId: uuid, pipeline: string, source: string, protocol: string, payload: string }`
- `GET /api/Asset/GetStatusValuesForAsset?assetId=` → `{ success, queryDate, logDate, data: EwcStatusValues }`

## Enums
- `EntityType`: World, Country, Organisation, WaterSystem, Asset, AppZone, None
- `AssetLifecycleState`: PreInstallation, Abandoned, Staged, Active, Suspended, Deactivated, RemovedFromService, Deleted, Test, Demo

## Command API — https://command.ewater.io
All POST. Key ops: `OpenValve`, `CloseValve`, `PingAssetModem`, `RequestFirmwareChange`, `NewEntity`, `UpdateEntityDetails`
