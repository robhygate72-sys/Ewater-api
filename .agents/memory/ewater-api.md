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

### Daily Water Dispensed / Usage (state API)  ← USE THIS for the usage bar chart
POST /api/Asset/GetDisbursementHistoryByDateRange
Body: { assetId, startDate, endDate, includeTickAccumulatorDerivedDisbursement: true }
Response: { data: [{ lowerBound, upperBound, tickAccumulatorDerivedTotalLitres, estimateTotalLitres, totalTicks, ... }] }
- **Use `tickAccumulatorDerivedTotalLitres`** — matches AssetUsageStatus.litresDispensedToday exactly
- `estimateTotalLitres` is wrong/underestimated (30× off); `tickAccumulatorDerivedTotalLitres` is accurate
- Returns daily buckets; missing days = gaps (zero-fill server-side)
- lowerBound dates are UTC with "Z" suffix, use .slice(0,10) for date key

### GetInflowHistoryByDateRange (state API) — DO NOT use for usage chart
POST /api/Asset/GetInflowHistoryByDateRange
Body: { assetId: number, startDate, endDate }
Response: { data: [{ lowerBound, upperBound, estimateTotalLitres, totalTicks, totalCredits, tickAccumulatorDerivedTotalLitres (null) }] }
- Returns individual tap event buckets (not daily); `estimateTotalLitres` is badly wrong
- Correct formula: totalTicks / GetTicksPerLitre = actual litres (matches disbursement history)
- **GetTicksPerLitre LIVES ON THE `state` BASE** (https://state.ewater.io), NOT query/command.
  GET https://state.ewater.io/api/Asset/GetTicksPerLitre?assetId={id} → { ticksPerLitre, success, errorMessage }.
  Confirmed 2026-06-27 asset 2706 → ticksPerLitre:71, exactly matching settings LitresConversion=71.
  Calling it on the `query` base 404s — that was the earlier "unusable" mistake.

### LitresDispensedPerDay (query API) — returns empty for individual assets
GET /api/Entity/LitresDispensedPerDay?entityType=Asset&entityId={id}&startDt=...&endDt=...
- Returns empty litresDispensedPerDay array for individual assets; may work for higher entity levels

### Power Status (query API)
GET /api/Asset/AssetPowerStatus?assetId={id}
Response: { lastKnownVoltage, lastKnownVoltageReadingDt, trendDirection, todayAverage, todayHigh, todayLow, todayLowBatteryEventCount, endOfDayDeclineConsecutiveDays, endOfDayDeclineTotalVoltageDrop }
- NO historical voltage time-series endpoint found (GetPowerHistoryByDateRange → 404)
- GetAssetSensorReadingsByDateRange with sensorDeviceId=1, sensorRegisterId=3 returns empty

### Asset Health Status (query API)
GET /api/Asset/AssetHealthStatus?assetId={id}
Returns bundle: { connectivityStatus, powerStatus, flowStatus, tankHeightStatus, assetUsageStatus }

### Asset Flow Status (query API) — average flow rates for the Water Usage panel
GET /api/Asset/AssetFlowStatus?assetId={id}
Response (FLAT, no `data` wrapper): { assetId, hourAverageFlowRate, todayAverageFlowRate, yesterdayAverageFlowRate, weekAverageFlowRate, monthAverageFlowRate }
- **Field names are `*AverageFlowRate` prefixed by period (hour/today/week), NOT `averageFlowRateThisHour/Today/ThisWeek`.** Reading the wrong names silently yields null (the Water Usage flow-rate rows stayed blank because of exactly this). Confirmed 2026-06-27 asset 662.
- These are the AVERAGE flow rates shown in the Water Usage panel; distinct from the per-session flowRateHistory chart computed from datalog packets.

### Asset Usage Status (query API)
GET /api/Asset/AssetUsageStatus?assetId={id}
Response (FLAT): { assetId, litresDispensedToday, lastUsageDt }

## EWC2.5 DATALOG Packet — 39-byte layout (CONFIRMED from protocol spec)

```
byte[0]      = 0x44  (HDR)
bytes[1–4]   = EWC_ID (4 bytes)
byte[5]      = EE  event/error code
bytes[6–8]   = SS MM HH  (BCD seconds, minutes, hours) ← NOT the flow counter
bytes[9–11]  = DD MT YY  (BCD day, month, year)
bytes[12–15] = card UID (4 bytes, MSB first)
byte[16]     = AN  battery ADC; volts = ADC/256 × 15
byte[17]     = RS  reserved
bytes[18–19] = UC UC  usage counter
bytes[20–23] = SCR SCR SCR SCR  start credit (MSB first), in MITs (MilliCredits)
bytes[24–27] = ECR ECR ECR ECR  end credit (MSB first)  ← in DISPENSE events only
bytes[28–30] = FC FC FC  per-session flow count (MSB, MID, LSB)  ← THE FLOW COUNTER
bytes[31–32] = FT FT  flow time in seconds (MSB, LSB)
bytes[33–34] = CONVH CONVL  FCF ticks/credit (MSB, LSB)  ← this is the FCF, NOT the LCF
bytes[35–36] = DLPH DLPL  datalog pointer
byte[37]     = ETX (0x03)
byte[38]     = XOR checksum
```

### Flow rate formula (correct)
```
flow_rate [L/min] = 60 × FC / (LCF × FT)
```
- FC is **per-session** (not cumulative). No delta needed.
- **LCF (ticks/litre) does NOT come from the packet.** bytes[33–34] is the FCF
  (ticks/credit). Two sources, both on the `state` base: (1) GetSettingsMapForAsset
  → settingKey `LitresConversion`; (2) GetTicksPerLitre → `ticksPerLitre`.
  **Resolution order (decided): LitresConversion primary, GetTicksPerLitre fallback
  when the setting is absent/≤0.** If neither yields a value, do not fabricate one
  (no `?? 360` fallback) — report null/skip.
- **The two sources can DISAGREE on coverage.** Some assets (e.g. 1846) have NO
  LitresConversion setting in the settings map yet GetTicksPerLitre returns a valid
  value — so GetTicksPerLitre resolves an LCF for more assets. That's why it's the
  fallback. The returned value is a real LCF, not a placeholder.
- **LCF can be fractional and <1, and that is normal — 0.1 (1 tick per 10 L) is a
  typical, valid LCF for a sense asset.** Do NOT treat fractional/small LCFs as
  suspicious or as defaults. Never assume integer or ≥1 when consuming it; only
  reject values ≤0.
- FT is at bytes[31–32] (MSB, LSB big-endian). Filter: FT > 10 s.
- Dispense event types: 0x09 (tag removed / session end), 0x0B (dispense-limit intermediate)
- Exclude: 0x19 (HEALTH_STATE periodic) — FC semantics differ for health reports.

### Event codes (key ones)
- 0x09 = No card (tag removed) — normal end-of-dispense event
- 0x0B = Dispense Limit — intermediate packet during long VALVE ON session
- 0x19 = HEALTH_STATE — periodic system status report (not a dispense event)

### Tick accumulator (meter reading) — HEALTH_STATE (0x19) packets
- The device's **lifetime tick accumulator** is an **8-byte big-endian** value at **offset 21** (bytes[21..28], i.e. 1-based "bytes 22–29"). Confirmed against eWater portal: bytes `00 00 00 00 00 11 DA 8D` = 0x0011DA8D = 1,170,061.
- Do NOT read it as the 4-byte ECR at bytes[24–27] — that gives a wrong, much smaller number (the ECR end-credit field, not the lifetime tick total).
- Meter litres = ticks / LCF, where LCF is the EWC settings `LitresConversion`
  (NOT bytes[33–34], which is the FCF). Example asset 2706: settings LCF=71,
  FCF=100; packet bytes[33–34]=100 confirmed = FCF.
- Read high/low 32-bit halves and combine (`high*2^32 + low`) to stay in JS safe-integer range.

### Common mistake (do NOT repeat)
bytes[6–8] are SS MM HH (BCD time), NOT the flow counter.
bytes[9–10] are DD MT (BCD date), NOT the flow time.
FC is always at bytes[28–30] and FT at bytes[31–32].
Tick accumulator is the 8-byte field at offset 21, NOT the 4-byte ECR at offset 24.

## eSense asset identification
- purpose === 'eSense' (case-insensitive match)
- Active test assets: 2105, 2211, 1748, 1749
- Capabilities include: ["AutomaticValve","BulkCredit","Ewc","Sense","FlowMeter","Modem","BatteryVoltageReading"]

## Reset tick accumulator (command base)
- POST https://command.ewater.io/api/Ewc/ResetTickAccumulator
  body: { correlationId: null, secondaryUserId: null, imei, assetId, litreValue }
- **litreValue is LITRES sent DIRECTLY — NO litres→ticks conversion.** The device
  does its own conversion. An earlier impl wrongly multiplied by LCF and sent
  `newValue` ticks; that is wrong.
- Requires the device **IMEI** (not just assetId). Resolve via state base
  `/api/Asset/GetIdentifiersByAssetId?assetId=...` → { identifiers:[{imei,...}] };
  scan for first non-empty imei (rows can be blank/stale).
- Effect is deferred: the accumulated meter value updates only on the EWC's next
  health packet — surface that to the user, do not expect an immediate reading change.

## Multi-IMEI assets (an asset can have more than one over its lifetime)
`GetIdentifiersByAssetId` can return multiple `identifiers` rows (e.g. after a device
swap) — treat IMEI as `string[]`, not a single value, everywhere (tech status, packet
log fetch/filter, reset-meter command target). Dedup by value; packet logs must be
fetched per-IMEI and merged, since the eWater logs API (`GetLogsInDateRangeByImei`) is
keyed by a single IMEI. For a command needing exactly one IMEI (e.g. reset-meter), use
the most recently registered one (last in the identifiers list) since that's the module
actually in service — don't just take `idList[0]`.

## Multiple wire protocols share one packet log stream
`GetLogsInDateRangeByImei` returns packets from several concrete protocols mixed together
(seen: `Ewc2_5`, `CommandApi_1`, `Gadwall`, `CommandApi_Gadwall_1`, plus CBOR/LwM2M-based
NB-IoT modules). Decoding must try each known decoder against the raw payload and fall
back gracefully (not assume one protocol per asset) — don't gate a decoder by asset type
or purpose, since coexisting protocols show up in the same stream.

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

## Dispense-volume calibration analysis (decided conventions)
- Typical dispense = Gaussian KDE peak (Silverman h = 0.9·min(sd, IQR/1.34)·n^(−1/5), 0.05 L grid), NOT bin midpoint or median.
- Fixed window 10–30 L, 1 L bins (30 L exactly counts in the last bin); require ≥10 in-range samples else report null.
- Preload is MEASURED, not modeled: event-type 0x01 "no credit" DATALOG packets carry unmetered ticks (valve-close overrun) at bytes[18–19] MSB-first; measuredPreload = average over the chart period (null when none → treated as 0 in the formula). NOT the FC field — FC on 0x01 packets is the session's real flow (user-confirmed against their packet viewer: unmetered ≈ 241 while FC was 9927).
- Suggestion is LCF-ONLY: suggestedLcf = round((kdePeak × currentLcf − measuredPreload) / 20); result ≤ 0 → no suggestion.
- **Why:** user-directed. The unmetered offset is directly observable from no-credit events, so use the measured value and correct the ticks-per-litre conversion itself. Supersedes all earlier models (bent LCF, factory-360 pair, preload-only).
- 0x01 packets are sparse (some assets emit none for days) but their unmetered-tick values are tight (~190–245 on the asset observed) — the "no measurement → assume 0" path is common and must stay visible in the UI.
- v3 flow meters (LCF ≈ 71) are NOT excluded — the formula scales with the current LCF so it handles them. (An earlier exclusion directive was reversed by the user; do not re-add a v3Meter flag.)
- One-click apply writes BOTH "LitresConversion" (= suggested LCF) and "Preload" (= measured preload rounded to int, 0 when none measured) via command API `POST /api/Ewc/RequestSettingChange` {correlationId:null, secondaryUserId:null, assetId, settingKey, newValue} — one call per setting, managed desired-value path, device applies on next check-in. NEVER auto-fire; user-confirmed dialog only (writes to real dispensers).
- Volumes come from dispense events 0x09/0x0B only (FC ÷ LCF), no FT filter for volumes (unlike flow-rate which needs FT > 10 s).

## Live-tail logs — must poll (no upstream push)
eWater provides **no push/websocket**; near-real-time log tailing is poll-only end-to-end.
Device cadence is sporadic (health-state ~hourly, dispense-on-use), so "Live" is NOT a
fast console — set that expectation. Implemented as an **opt-in** toggle (OFF by default),
30s poll of the newest page, dedup by id against known set, prepend newest-first.
**Why:** user explicitly chose opt-in over always-on; avoids needless upstream load.
