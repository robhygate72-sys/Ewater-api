---
name: eWater API endpoints
description: Confirmed live eWater API endpoints, response shapes, and quirks for eSense assets
---

## Auth
- POST https://auth.ewater.io/api/Auth/GetToken  body: {username, password} → {access_token, expires_in}

## Confirmed working endpoints for eSense charts

### Tank Height History (state API)
POST /api/Asset/GetTankHeightHistoryByDateRange
Body: { assetId: number, startDate: "2026-06-11T00:00:00", endDate: "2026-06-14T23:59:59" }
Response: { data: [{ lowerBound, upperBound, averageWaterTankHeight, minimumWaterTankHeight, maximumWaterTankHeight, averageChlorineTankHeight, minimumChlorineTankHeight, maximumChlorineTankHeight, waterTankConnectedFraction, chlorineTankConnectedFraction }] }
- Auto-aggregates: hourly for ≤7 days, daily for longer
- waterTank = vsen1, chlorineTank = vsen2 (chlorine all zeros if not connected)

### Daily Inflow (state API)
POST /api/Asset/GetInflowHistoryByDateRange
Body: { assetId: number, startDate, endDate }
Response: { data: [{ lowerBound, upperBound, estimateTotalLitres, readingCount, totalTicks, totalSeconds, totalCredits }] }
- Per-day aggregation for any range

### Power Status (query API)
GET /api/Asset/AssetPowerStatus?assetId={id}
Response: { lastKnownVoltage, lastKnownVoltageReadingDt, trendDirection, todayAverage, todayHigh, todayLow, todayLowBatteryEventCount, endOfDayDeclineConsecutiveDays, endOfDayDeclineTotalVoltageDrop }
- NO historical voltage time-series endpoint found (GetPowerHistoryByDateRange → 404)
- GetAssetSensorReadingsByDateRange with sensorDeviceId=1, sensorRegisterId=3 returns empty

### Asset Health Status (query API)
GET /api/Asset/AssetHealthStatus?assetId={id}
Returns bundle: { connectivityStatus, powerStatus, flowStatus, tankHeightStatus, assetUsageStatus }

## eSense asset identification
- purpose === 'eSense' (case-insensitive match)
- Active test assets: 2105, 2211, 1748, 1749
- Capabilities include: ["AutomaticValve","BulkCredit","Ewc","Sense","FlowMeter","Modem","BatteryVoltageReading"]

## API base URLs
- auth: https://auth.ewater.io
- query: https://query.ewater.io
- state: https://state.ewater.io
- command: https://command.ewater.io

## Codegen quirk — duplicate params type (resolved)
Adding query params to an OpenAPI endpoint causes Orval to generate `GetXxxParams` in BOTH:
- `lib/api-zod/src/generated/api.ts` (Zod schema)
- `lib/api-zod/src/generated/types/` (TypeScript interface)

**Why:** Orval `schemas: {path, type: "typescript"}` config generates TS types in a separate directory, and both it and the Zod schemas file get the same export name.

**Fix applied:** Removed `schemas: { path: "generated/types", type: "typescript" }` from `lib/api-spec/orval.config.ts` (zod output section), then deleted stale `lib/api-zod/src/index.ts` so Orval regenerates it without the conflicting re-export.
