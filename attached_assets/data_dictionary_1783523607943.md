# eWater Dashboard — Data Dictionary

Source: `eWater Dashboard.SemanticModel` (Power BI Project / TMDL). Extracted from `definition/tables/*.tmdl`, `definition/relationships.tmdl`, `definition/model.tmdl`, `definition/expressions.tmdl`, cross-checked against the live databases via the local ODBC DSNs (`state`, `credits`, `assetcontroller`, `ewater_reporting`, `ewater_central`, `pulse`).

Compatibility level 1600, culture `en-GB`. Six numbered query groups load order is fixed in `model.tmdl`.

> **Note on provenance.** There is **no official eWater DB-table wiki** — eWater confirmed (Slack `#support`, 2026-06-18, Bryn) that no such document exists; this file is the de-facto reference. Facts below tagged "(Slack, …)" come from the eWater engineers (Bryn Dukes / Iain Ballard) answering data-mechanics questions directly in `#support`, and should be treated as authoritative but un-versioned (re-verify against the live DBs where a query is given).

---

## 0. System architecture — "old system" (asset controller) vs. "Data Waterfall"

eWater runs **two parallel telemetry/reporting systems**, and almost every "where does this number come from?" question resolves to which of the two you are reading (Slack `#support`, 2026-06-18 / 2026-06-24, Bryn):

| | "Old system" (asset controller) | "New system" — **Data Waterfall** |
|---|---|---|
| Backing DBs | `assetcontroller` (raw `waterdisbursement`, `assetpropertysnapshot`, `DispenseLimitEvents`) | `state.public.ztrilist_*` rollup families + `ewater_reporting` `*_UTC` tables |
| History | Full, back to **2015** | **Only from ~July 2025 onward** |
| Flow-rate method | derived from `DispenseLimitEvents` (count of ticks in a window) — see §2.3 | readings ÷ timestamp — see §2.3 |
| Per-interval behaviour | `assetpropertysnapshot` **forces a datapoint every interval** | `ztrilist_supplybyasset_0of6` **drops 0-flow events** |

**Critical consequence — the ~July-2025 cutover.** The Data Waterfall (`ztrilist_generalwateruse_*`, the `*_UTC` reporting tables) **only started getting populated around July 2025** (Slack, 2026-06-19, Bryn). Any **lifetime / cumulative** figure (total spend, total topups vs. current balance, "ever used" reconciliation) built **only** on the Data Waterfall **understates older tags** and will surface **false "deficits"** for tags that were active before the cutover. For pre-July-2025 lifetime usage by tag/asset, query the legacy `assetcontroller.public.waterdisbursement` directly.

**This qualifies §4** below: `ztrilist_generalwateruse_*` is a valid drop-in replacement for the live-`GROUP BY`-over-145M-rows pattern **for the recent (post-cutover) window**, but it is **not** a complete historical replacement until the backfill is done. Backfilling old data into the Waterfall (for a true single source of truth) is a **backlog item that eWater has not yet prioritised** (Slack, 2026-06-19, Bryn).

---

## 1. Data sources

| DSN (ODBC) | Backend DB | Schema.Table(s) used | Consuming model tables |
|---|---|---|---|
| `state` | `state` | `public.asset`, `public.assetlifecyclehistory`, `public.country`, `public.organisation`, `public.watersystem`, `public.ztrilist_supplybyasset_0of6`, `public.ztrilist_disbursementbytag_2of6_perday`, **`public.ztrilist_generalwateruse_*`, `public.wateruserid`** (new, see §4) | Asset Detail (Usage), AssetLifecycleHistory, Country Detail, Organisation Detail, System Detail, Supply (All), DisbursementByTag |
| `ewater_reporting` | `ewater_reporting` | `public."AssetDowntime_UTC"` | AssetDowntime_UTC |
| `credits` | `credits` | `public.tag`, `public.tagtopup`, `public.stronhouseholdmetertopup` | Tags, tagtopup, STS Topups |
| `assetcontroller` | `assetcontroller` | `public.waterdisbursement` | waterdisbursement (DQ) |
| `pulse` | `pulse` | `public.partinstance` | STS Lookup |
| `ewater_central` | `ewater_central` | `public.household`, `public."User"` | household, eWs Users |
| Google Sheets (CSV export) | — | spreadsheet `1dgsvuTuPPbDtH7dxmPsipAiZgVazdnV2uRc5mYx4ONY` | SchoolTags |
| Google Sheets (CSV export) | — | spreadsheet `1gsybgDG3_JjaoaHUQsFpwAV8jG1r_KH4dFoG7ICIQEQ` | Village Asset Lookup (Usage), Village Asset Lookup (Tags) |
| mWater API export | — | `https://api.mwater.co/v3/integrations/exports/da75de0c0ccf4c1d80eb97a5093ae2d6.csv` | mWater Survey |
| Local CSV file | — | `C:\Users\cbail\...\Driving Water Usage 2025-04-03.csv` (hardcoded personal path, `excludeFromModelRefresh`) | Tag Household Locations |

Six independent Postgres-style microservice databases sit behind the six DSNs, reflecting eWater's service architecture: state (asset/org/system/water-use), reporting (uptime), credits (wallet/tag/topup), assetcontroller (raw telemetry), pulse (hardware/parts), ewater_central (users/households).

**Reference-only tables (Slack-documented, NOT yet wired into the semantic model)** — relevant to NRW / flow / credit analysis, see §0 and §2.3–§2.5:

| Backend DB | Schema.Table | Purpose |
|---|---|---|
| `ewater_reporting` | `public."DailySupply_UTC"` | **Per-asset daily litres supplied (eSense), the canonical "litres supplied" feed for NRW.** Bryn called it "LitresSupplied_UTC" on Slack (2026-06-24) but the actual table is `DailySupply_UTC`; there is no `LitresSupplied_UTC`. Columns: `AssetID`, `SystemID`, `LogDay` (int days since **2000-01-01**), `Litres` (double), `AggregationID`, `HourlySupply` (24-element hourly-litres array). **Verified 2026-06-24** aligned to `ztrilist_supplybyasset_0of6` to <0.2% per day. Per-asset tick→litre conversion already applied. |
| `ewater_reporting` | `public."DailyDisbursement_UTC"` | Source of the on-tap **hour-of-day average-flow chart**; averages come from its `HourlyDisbursement` column (Slack, 2026-06-18, Bryn). Supply analogue: `DailySupply_UTC.HourlySupply`. |
| `state` | `public.ztrilist_supplybyasset` (+ `_0of6` grain) | Per-asset litres supplied (`totallitres_value`); event grain. **Verified aligned to `DailySupply_UTC`** (Slack, 2026-06-24, Bryn). Used (spike-filtered at 300 L/min) by the NRW supply calc and the manual-meter accuracy check. |
| `state` | `public.ztrilist_disbursementsperasset_1of6_perhour` (+ `_Nof6_*` family) | Per-asset per-hour litres + seconds of flow, incl. `longflow` columns — basis for flow-by-hour (Slack, 2026-06-18, Bryn) |
| `state` | `public.cascadingsettings` | Cascading per-asset/system config; `settingkey='PreloadThreshold'` governs tag-flashing/NRW (Slack, 2026-06-24, Bryn/Iain) |
| `assetcontroller` | `public.assetpropertysnapshot` | Old-system per-interval asset property time series — drives the dashboard eSense flow chart |
| `assetcontroller` | `DispenseLimitEvents` | Tick-count-in-window events the old-system flow rate is derived from |

**Shared M parameters/functions** (`expressions.tmdl`):
- `Query1` — calendar-generator function used by `DateTable` (from 2021-01-01 to today).
- `load_days` = 14 — incremental lookback window for `AssetDowntime_UTC`, `tagtopup`, `waterdisbursement (DQ)`.
- `load_days2` = 14 — incremental lookback window for `DisbursementByTag`.

---

## 2. Tables

### 2.1 Dimension tables

#### `Country Detail` / `Country Filter`
Source: `state.public.country`. `Country Filter` is a pass-through copy (`let Source = #"Country Detail" in Source`) used as an independent slicer.

| Column | Type | Notes |
|---|---|---|
| CountryID | int64 | PK |
| Country Name | string | renamed from `name` |
| parentid | int64 | |
| countrylifecyclestate | int64 | |
| latitude, longitude | double | |

#### `Organisation Detail` / `Organisation Filter`
Source: `state.public.organisation`. `Organisation Filter` is a pass-through copy.

| Column | Type | Notes |
|---|---|---|
| OrganisationID | string (uuid) | PK, renamed from `id` |
| Org Name | string | renamed from `name` |
| CountryID | int64 | FK → Country Detail |
| organisationlifecyclestate | int64 | |
| latitude, longitude | double | |

#### `System Detail` / `System Filter`
Source: `state.public.watersystem`. `System Filter` is a pass-through copy.

| Column | Type | Notes |
|---|---|---|
| SystemID | int64 | PK, renamed from `id` |
| SystemName | string | renamed from `name` |
| OrganisationID | string | FK → Organisation Detail |
| watersystemlifecyclestate | int64 | |
| latitude, longitude | double | |

Measure: `Tags Registered / num housholds` = `[Registered Tags] / ([# Assets] * 250)` (cross-table reference into `Tags` and `waterdisbursement (DQ)`; 250 = assumed households per asset).

#### `Asset Detail (Usage)` / `Asset Filter (User)`
Source: `state.public.asset`, enriched with a lifecycle-state lookup against `AssetLifecycleHistory` (filtered to state 4 = Active, grouped by AssetID for `State4StartDT`/`State4EndDT`). `Asset Filter (User)` is a pass-through copy (decoupled relationship-wise from the rest of the model, used purely as a slicer).

| Column | Type | Notes |
|---|---|---|
| AssetID | int64 | PK, renamed from `id` |
| Tap Name | string | renamed from `name` |
| Purpose | string | |
| SystemID | int64 | FK → System Detail |
| Latitude, Longitude | double | |
| SystemName | string | calculated, `RELATED('System Detail'[SystemName])` |
| Country.Name | string | calculated, chained `LOOKUPVALUE` through System Detail → Organisation Detail → Country Detail |
| Asset State | int64 | renamed from `assetlifecyclestate` |
| Asset State Name | string | calculated decode: -10 Deleted, -2 Test, -1 Demo, 1 PreInstallation, 2 Abandoned, 3 Staged, 4 Active, 5 Suspended, 6 Deactivated, 7 RemovedFromService, else Unknown |
| State4StartDT, State4EndDT | dateTime | min/max of Active-state windows per asset |

Measures: `Live Assets` (distinct AssetID count active as of a given date), `Assets Commissioned` (AssetID count whose State4StartDT falls in the selected range).

#### `AssetLifecycleHistory`
Source: `state.public.assetlifecyclehistory`. Tracks every state transition an asset has gone through (state 4 = Active is the one consumed elsewhere).

| Column | Type | Notes |
|---|---|---|
| AssetID | int64 | FK → Asset Detail (Usage) |
| AssetLifecycleState | int64 | 4 = Active (see decode above) |
| StartDT, EndDT | dateTime | EndDT blank = currently in that state |
| Reason | string | |
| UserID | string | |

#### `Tags` — central tag/account dimension
Source: `credits.public.tag`. Uppercases `nfcid`, dedupes on `nfcid`, drops several operational columns, **filters to `signupdt <> null`** (i.e. only tags that have actually been activated/registered are in the model).

| Column | Type | Notes |
|---|---|---|
| nfcid | string | PK, 8-char hex, uppercased |
| favassetid, lastassetid | int64 | |
| mobilenumber | string | |
| signupdt, deleteddt, lastusagedt, lastreconciliationdt, firstusagedt, usageresetdt | dateTime | |
| disbursementcount, topupcount | int64 | |
| credits | double | wallet balance, raw units |
| householdid | string | FK → household |
| Asset ID Master | int64 | calculated: favassetid, or household's assetid if favassetid = 0 |
| Signup Date | date | calculated from signupdt |
| Status Summary, Tag Status, In Use, Usage 30 High (While in Use) | string | calculated status/segmentation columns |
| credits (bins), Outstanding Credit Bin, Topup Count Bin | string/binned | reporting buckets |
| Uses 49d, Litres 49d, Topups 49d (+ Bucket variants) | numeric/string | calculated from `DisbursementByTag`/`tagtopup` within 49 days of signup |

15 measures cover registration counts, active/inactive/never-used segmentation, litres-per-active-tag, KES credit conversion (`credits * 0.2109`), and "last used" logic. **A ≥5-litres-per-day threshold is the de-facto "genuine usage" filter** used throughout (Active Tags, Tags Ever Used, Tag Last Used) to exclude noise/test dispensing.

#### `household`
Source: `ewater_central.public.household` (PII columns removed: previouswatersources, mobileuseconsent, stats, acceptedtermsdt, organisationid, dataregionid).

| Column | Type | Notes |
|---|---|---|
| householdid | string | PK |
| name, address, mobilenumber, mainmembergender | string | |
| quantity | int64 | |
| createddt, deleteddt, lastactivedt | dateTime | |
| createdbyuserid | string | FK → eWs Users |
| systemid, assetid | int64 | denormalised pointers to favoured system/asset |
| minimumpriceconsent | double | |
| Duplicate Count | int64 | calculated, count of rows sharing the same `name` |

#### `eWs Users`
Source: `ewater_central.public."User"` (most PII columns dropped: MSISDN, Email, PasswordHash, Salt, PrivateKeyEncrypted, WalletAddress, etc.).

| Column | Type | Notes |
|---|---|---|
| UserID | int64 | PK |
| FirstName, LastName | string | |
| Name | string | calculated concat |
| KeycloakUserId | string | |

#### `STS Lookup`
Source: `pulse.public.partinstance`, filtered to `partid = '7e1f3c2a-4b5d-4e8a-9c2e-1a6b7f8d9e0c'` (the STS-meter part type), deduped on serial number.

| Column | Type | Notes |
|---|---|---|
| assetid | int64 | FK → Asset Detail (Usage) |
| stronmeterid | string | renamed from `serialnumber`, cleaned, deduped |
| createddt | dateTime | |
| partid | string | |
| status | string | |

#### `SchoolTags` (Google Sheet)
| Column | Type | Notes |
|---|---|---|
| System, School, Type | string | |
| Tag | string | FK → Tags.nfcid |
| Teachers, Day Pupils, Boarding Pupils, Total | int64 | |

#### `Village Asset Lookup (Usage)` / `Village Asset Lookup (Tags)` (Google Sheet)
`(Tags)` is a pass-through copy of `(Usage)`.

| Column | Type | Notes |
|---|---|---|
| Asset Name | string | |
| AssetID | int64 | FK → Asset Detail (Usage) / Asset Filter (User) |
| Village, CHP | string | CHP = Community Health Promoter |

#### `Tag Household Locations` (local CSV — fragile)
Source: a **hardcoded personal OneDrive path** (`Tag Household Locations 2025-04-03.csv`), `excludeFromModelRefresh = true` — will not refresh on service/scheduled refresh, only on the author's own machine. Originates from an mWater-style enumerator survey ("Driving Water Usage"), filtered to GPS accuracy < 15 m, deduped on Tag ID.

| Column | Type | Notes |
|---|---|---|
| Deployment, Name | string | |
| Record the household location via GPS. (latitude/longitude/accuracy) | double | |
| Tag ID | string | FK → Tags.nfcid |
| Distance to Tap | double | calculated flat-earth haversine approximation vs. Asset Filter (User) lat/long |
| Distance to Tap (bins) | binned | |

#### `mWater Survey` (live API export — orphan table)
Source: live mWater API CSV export, filtered to `Status = "Final"`, GPS parsed out of a GeoJSON column.

| Column | Type | Notes |
|---|---|---|
| Deployment, Enumerator, Status, Name, Gender | string | |
| Survey Date | dateTime | |
| Has eWATER Tag | string | |
| nfcid | string | cleaned/uppercased to match Tags.nfcid format |
| Topup Count | int64 | |
| Tag Last Used, Main Challenge, Cost Sentiment, Walk Time, Alternative Water Source, Home Connection Interest | string | survey free-text/categorical answers |
| Latitude, Longitude, GPS Accuracy (m) | double | |

**Not wired into `relationships.tmdl`** despite having an `nfcid` column that obviously joins to `Tags.nfcid` — currently an island table in the model.

#### Static / helper "DATATABLE" tables (disconnected by design — drive SWITCH measures and slicers)
- `CurrencyChoice` — Choice: "Local" / "GBP"
- `Litre Currency Choice` — Choice: "Litres" / "Currency"
- `Litres/Asset Bin` — BinIndex/BinName/Bin Start/Bin End, 8 fixed litres-per-asset bins
- `Usage Metric Selector` — Metric: Total Litres / Litres per Day / Revenue (KES) / Topups (KES) / Revenue per 20 Litres — drives `waterdisbursement (DQ)[Usage (Selected Metric)]`
- `HHC Metric Selector` — Metric: Litres Purchased / Litres Dispensed / Litres per Day per Asset / Revenue (KES) — drives `Usage Metric Selector[HHC Usage (Selected Metric)]`
- `Active Window` — Days: 7 / 14 — drives the 7-day/14-day toggle via `Active Window Days Selected`

#### `DateTable` (calendar dimension)
M-generated via the shared `Query1` function, 2021-01-01 → today. ~35 columns covering Year/Quarter/Month/Day breakdowns, ISO week, fiscal year/quarter/period (fiscal start month = February, param = 2), offsets vs. today, completed-period flags. Measures: `Max DT`, `Min DT`.

---

### 2.2 Fact tables (legacy / current production)

#### `waterdisbursement (DQ)` — primary usage/transaction fact (legacy)
Source: raw SQL pushdown via `Odbc.Query("dsn=assetcontroller", ...)`, incremental on `load_days` (14-day lookback):
```sql
SELECT assetid, nfcid, CAST(logdt AS date) AS "Date",
       SUM(litres) AS "Litres (Daily)",
       SUM(startcredit - endcredit) AS credit
FROM public.waterdisbursement
WHERE logdt >= DATE '<cutoffDateText>'
GROUP BY assetid, nfcid, CAST(logdt AS date)
```
Pre-aggregated to one row per asset/tag/day. Backing table `assetcontroller.public.waterdisbursement` holds ~145.5M raw (per-event) rows back to 2015 (with some sentinel/future dates beyond 2026).

| Column | Type | Notes |
|---|---|---|
| assetid | int64 | FK → Asset Detail (Usage) |
| nfcid | string | FK → Tags |
| Date | date | day grain |
| Litres (Daily) | double | summed litres for that asset/tag/day |
| credit | double | summed (startcredit − endcredit) for that asset/tag/day |

18 measures (the model's busiest table): `Sum Litres`, `Litres/Day`, `Litres/Asset/Day`, `Revenue (KES)` (`0.2109 * SUM(credit)`), `Revenue/Litre (KES)`, `# Users` (`DISTINCTCOUNT(nfcid) * 4.7` household-size multiplier), `# Assets` (alias of `Live Assets`), `Usage (Selected Metric)` switch measure, trailing 7-day/4-week variants, YTD, % of total, etc.

#### `DisbursementByTag` — tag-level pre-aggregated rollup (legacy, narrower scope)
Source: raw SQL pushdown via `Odbc.Query("dsn=state", ...)` against `state.public.ztrilist_disbursementbytag_2of6_perday`, incremental on `load_days2`:
```sql
SELECT LPAD(TO_HEX(entityid), 8, '0') AS nfcid,
       CAST(lowerbound AS date) AS "Date",
       totallitres_value AS "Litres (Daily)",
       totalcredits_value AS credit,
       totalseconds_value AS seconds
FROM public.ztrilist_disbursementbytag_2of6_perday
WHERE lowerbound >= DATE '<cutoffDateText>'
```
Here `entityid` is a **tag-only** rollup key (hex-encodes directly to nfcid — no asset dimension). Used only as a feeder for `Tags` calculated columns `Uses 49d` / `Litres 49d` (no measures of its own).

| Column | Type | Notes |
|---|---|---|
| nfcid | string | FK → Tags, decoded `LPAD(TO_HEX(entityid),8,'0')` |
| Date | date | |
| Litres (Daily) | double | |
| credit | double | |
| seconds | double | |

#### `tagtopup` — wallet top-up fact (credits domain, NOT usage — not replaced by generalwateruse)
Source: raw SQL pushdown via `Odbc.Query("dsn=credits", ...)`, incremental on `load_days`:
```sql
SELECT nfcid, assetid, credits, createddt, origin,
       supertapposition AS "Topup collected"
FROM public.tagtopup
WHERE createddt >= TIMESTAMP '<cutoffTx>'
```

| Column | Type | Notes |
|---|---|---|
| nfcid | string | FK → Tags |
| assetid | int64 | FK → Asset Detail (Usage) |
| credits | double | |
| createddt, Date | dateTime/date | |
| origin | string | e.g. "Safaricom M-Pesa", "Direct transfer in credit dashboard", "Tag Subsidy" |
| Topup collected | int64 | inverted flag (`supertapposition = 0` → 1) — **verified wrong, see caveat below** |
| KES Value | double | calculated, `0.2109 * credits` |

Measures: `Subsidy Owed`, `Topup Value (KES)`, `Topup (KES)`.

**`Topup collected` is verified wrong (2026-06-18) — don't use it for delivery status.** Cross-checking `supertapposition` against the real status field (`credits.public.tagtopup.currenttagtopupstateid` joined to `credits.public.tagtopupstate.state`, which has a genuine small enum: `collected`, `awaitingcollection`, `acknowledged`, `awaitingdownload`, `awaitingslot`, `downloading`, `deleted`, `erasing`, `moving`, `retracting`, `erased`) shows `supertapposition` doesn't correlate with delivery at all: `supertapposition = 0` rows are 95.8% `collected`, `supertapposition ≠ 0` rows are 99.3% `collected` — i.e. both groups are overwhelmingly collected regardless of the flag, so the model's `if supertapposition = 0 then 1 else 0` logic is built on a false premise. `currenttagtopupstateid`/`tagtopupstateid` itself is also a trap — it looks like a status code by name but is actually a near-unique per-row id (1.59M distinct values across 1.59M rows); the real enum only appears after joining to `tagtopupstate.state`. For genuinely stuck/uncollected topups, use: `state NOT IN ('collected','deleted','erased')` on topups older than a grace window — validated live at ~1.36% of topups 2+ days old.

#### `Supply (All)` — eSense bulk-supply flow meter time series (3 assets only — unnecessarily narrow)
Source: `state.public.ztrilist_supplybyasset_0of6`, **hand-filtered to `entityid = 2015 or 2211 or 2105`** — i.e. this is a diagnostic feed for 3 specific assets, not a full fleet supply table. These `entityid`s are `asset.purpose = 'eSense'` devices — **flow meters on the bulk water-supply line feeding a system**, not tap/dispensing points (see §4.5/§5 eSense caveat).

**eWater-confirmed (2026-06-18): this hardcoded filter should be removed.** Querying the unfiltered source live shows `ztrilist_supplybyasset_0of6` actually carries 43 distinct assets — 24 `purpose='eSense'` and **19 `purpose='CommunityTap'`** — so removing the 3-asset hardcode would both (a) bring in the other 21 eSense devices for supply monitoring, and (b) bring in genuinely useful asset-level flow data for 19 real community-tap assets that the table currently drops entirely. The M query's `Table.SelectRows(..., each [entityid] = 2015 or [entityid] = 2211 or [entityid] = 2105)` step should simply be deleted (still apply the 300 L/min spike filter below to whatever comes through, and keep `Purpose` on hand via a join to `Asset Detail (Usage)` so eSense vs. CommunityTap rows can be told apart in visuals).

| Column | Type | Notes |
|---|---|---|
| entityid | int64 | = AssetID for these 3 eSense supply-meter assets |
| lowerbound, upperbound | dateTime | event window |
| totallitres_value | double | |
| totalseconds_count/value, totalticks_value | numeric | |
| Date, Time, RoundedTime | date/time | |
| Night Time Flag | string | "Y" if Time > 20:00 or < 01:00 |

Measure: `flow rate l/hr` = `sum(totallitres_value) / (sum(totalseconds_value)/3600)`.

**Known fault mode — spike filtering required:** eSense meters intermittently report freak spike readings. Before aggregating, discard any row implying a flow rate over **300 litres/minute (18,000 L/hr)** — `totallitres_value / (totalseconds_value/60) > 300`. The current `flow rate l/hr` measure has no such cap and should not be trusted unfiltered.

**How this relates to `generalwateruse` (§4) — there is no direct relationship, only a manual join:** `Supply (All)` and `generalwateruse` are sourced from two different `ztrilist_*` families with different entity-key grains:
- `Supply (All).entityid` **is the AssetID directly** (from `ztrilist_supplybyasset_0of6`, asset-only, no tag dimension).
- `generalwateruse.entityid` is **not** an asset id — it's `wateruserid.uniqueid`, a junction key for an (assetid, tagid) combination.

To cross-reference the same physical eSense device between the two: `Supply (All).entityid = wateruserid.assetid`, then `wateruserid.uniqueid = generalwateruse.entityid`. This is one-to-many — verified live, asset 2015 has 147 distinct `tagid` rows in `wateruserid`, 2105 has 103, 2211 has 82 (eSense devices aren't real NFC scans, so these "tagids" are meaningless per-session artifacts, which is also why the same physical fault fragments across many different `generalwateruse.entityid`s rather than appearing as one continuous stream).

**Coverage mismatch:** there are 44 `asset.purpose='eSense'` rows in total. Only 3 are wired into `Supply (All)` (the hardcoded `entityid` filter above — eWater confirms this should be removed, see the `Supply (All)` table section). 18 of the 44 have logged activity in `wateruserid`/`generalwateruse` — including `eSense Mutanga` / assetid 2471 (the 17M-litre spike example), which is **not** one of the 3 in `Supply (All)`. So `Supply (All)` is a narrow hand-picked diagnostic subset, while `generalwateruse` incidentally captures a broader (but still partial — 18 of 44) set of eSense devices, simply because it's keyed off every asset with any transaction-shaped row. Any eSense-wide audit needs `asset.purpose='eSense'` directly, not either of these two tables alone.

**eWater-confirmed (2026-06-18) — why eSense "tagid" values in `generalwateruse`/`wateruserid` are never real:** eSense devices are flow meters, not NFC readers — they should never have a genuine NFCID against their usage. Confirmed live: real `CommunityTap` assets carry random-looking 8-hex-char NFCIDs decoded from `wateruserid.tagid` (e.g. `1029294602 → 3D59CA0A`, a real signed-up tag in `credits.tag`). eSense assets instead carry **sequential placeholder integers** (`16000000`, `23000000`, `24000000`, `26000000`...) — these exist as stub rows in `credits.tag` but with `signupdt = NULL` and no household, i.e. never real customer registrations. The `Tags` model table already filters to `signupdt <> null`, so these placeholder rows don't leak into the existing dashboard's `Tags`/`Registered Tags` measures — but they will appear unfiltered in any raw `generalwateruse`/`wateruserid` query, which is one more reason `Purpose <> 'eSense'` must be applied explicitly for any disbursement-by-tag analysis (§4.5).

#### `STS Topups`
Source: `credits.public.stronhouseholdmetertopup`.

| Column | Type | Notes |
|---|---|---|
| stronmetertopupid, stronmeterid, creditchargeid, token | string | |
| litresissued, creditscharged | double | |
| createddt, Date | dateTime/date | |
| disbursementrecorded, dwdisbursementrecorded | string | |
| KES Topup | double | calculated, `creditscharged * 0.2109` |

Measure: `STS Litres/Day/Meter`.

#### `AssetDowntime_UTC`
Source: `ewater_reporting.public."AssetDowntime_UTC"`, incremental on `load_days`. Unpivots ConnectivityHours/SupplyHours/PowerHours/Tap Downtime into long format.

| Column | Type | Notes |
|---|---|---|
| AssetID | int64 | FK → Asset Detail (Usage) |
| LogDate | date | FK → DateTable |
| Problem | string | "Connectivity" / "Supply" / "Power" / "Tap Downtime" |
| Hours, Hours Capped | double | capped at 24 |
| Asset Date | string | composite key `LogDate-AssetID` |

9 measures covering downtime/uptime % (overall, supply-only, connectivity-only), 7-day and 4-week windows.

---

### 2.3 Flow rate & litres-supplied mechanics (Slack-confirmed)

How the litres/flow numbers are actually produced — this is the core of any NRW or eSense flow analysis. All confirmed by eWater engineers in `#support` (2026-06-18 → 2026-06-24).

**Litres supplied comes from the raw eSense tick accumulator.** "Does litres supplied come from raw eSense tick-accumulator readings?" → **"Yes"** (Bryn, 2026-06-24). This matches the settled volume method recorded in project memory: cumulative `tickaccumulator` delta × litres/tick (see `[[project-manual-meter-accuracy]]`). Do **not** integrate the instantaneous `flowrate` property for volume — that path is a spot reading, not d(ticks)/dt.

**Flow-rate derivation is system-dependent (§0):**
- **Old system / asset controller** — flow rate is derived from **`DispenseLimitEvents`**, which is a **count of ticks in a window** (NOT ticks ÷ timestamp). **This is what drives the current flow-rate chart on the water dashboard**, and it reads from `assetcontroller.public.assetpropertysnapshot` (Bryn, 2026-06-19).
- **New system / Data Waterfall** — flow rate is the readings **÷ timestamp** (Bryn, 2026-06-24).

So the same physical device can yield slightly different flow-rate series depending on which system computed it — reconcile against the system, not just the asset.

**Best tables for litres-supplied-per-asset / NRW** (Bryn, 2026-06-24): either
- `ewater_reporting."DailySupply_UTC"` (reporting DB; Bryn said "LitresSupplied_UTC" but the real table is `DailySupply_UTC` — daily grain, `LogDay` = int days since 2000-01-01, `HourlySupply` array), **or**
- `state.public.ztrilist_supplybyasset` (`_0of6`, `totallitres_value`, event grain).

"They should be aligned" — **verified 2026-06-24**: identical per-day to <0.2% for Kinamba (asset 2520). Prefer these over re-deriving from raw telemetry. The NRW supply calc and the manual-meter accuracy check both read `ztrilist_supplybyasset_0of6.totallitres_value` (spike-filtered at 300 L/min).

**Per-meter tick→litre conversion VARIES — never hardcode it, and don't trust `litresconversionfactor`.** Verified across the 10 Kenya eSense supply meters (2026-06-24): effective L/tick (`SUM(totallitres_value)/SUM(totalticks_value)`) ranges **1, 10, 13, 80, 100** by meter. The `litresconversionfactor` property in `assetpropertysnapshot` is unreliable/garbage on some meters (Karandi logs a mix of `0.1 / 27 / 365`), so deriving litres = ticks × (1/lcf) gives wrong volumes — use `totallitres_value` / `DailySupply_UTC.Litres` (conversion already applied) instead.

**A large manual-vs-eSense gap is non-revenue water (a leak), NOT a meter error.** The manual bulk meter and the eSense supply meter sit at different points, so when the manual reading is far above eSense litres supplied, the difference is water lost between them. **Kaareni (asset 1846) runs ~−90%** (manual ~24.7M L vs eSense ~2.41M L over the span) — eWater confirmed (2026-06-24) the eSense meter and its 10 L/tick conversion are **correct**; this is a **confirmed large physical leak**, exactly the signal the manual-meter accuracy check exists to surface. Do not "correct" eSense for it.

**Per-asset flow rate by hour-of-day.** There is **no table that stores it in that shape** (Bryn, 2026-06-18). Two ways to get it:
- **Build it** from `state.public.ztrilist_disbursementsperasset_1of6_perhour`, which carries **total litres** and **total seconds of flow** per asset/hour, plus **`longflow`** columns. Flow (L/min) = `litresinlongflow / (secondsinlongflow / 60)`. Using the **long-flow** figures **filters out short flashing disbursements** (see §2.4) — i.e. this is the clean "real flow" signal.
- **The on-tap dashboard chart** (the average-flow-by-hour graph you see on a tap) is sourced from `ewater_reporting."DailyDisbursement_UTC"`; its averages are computed from the **`HourlyDisbursement`** column (Bryn, 2026-06-18).
- **For eSense SUPPLY flow-by-hour** (the supply analogue), use **`ewater_reporting."DailySupply_UTC".HourlySupply`** — a 24-element hourly-litres array per asset/day, tick-derived and spike-free. This is the correct source for an eSense "flow rate over time" / time-of-day profile, in preference to the instantaneous `flowrate` property (see below), which overstates and reports phantom flow.

**The `flowrate` property is an instantaneous spot reading, NOT volume/time.** Sampled ~15 min (`flowconversionfactor` = 65535, a separate scaling path), it is *not* d(ticks)/dt: integrating it over a window overstates true throughput ~1.7× and it reports non-zero flow in intervals where the tick odometer didn't move at all (verified 2026-06-24, Kinamba: ∫flowrate ≈ 6,600–6,800 L vs tick-true 3,860 L; e.g. a 37.5 L/min reading with 0 ticks). Use `flowrate` only for "is it flowing right now / does outflow reach zero overnight" (leak detection), never for volume or a quantitative flow-rate-over-time chart.

### 2.4 NRW & "tag flashing" (analytical context + config table)

**Tag flashing** = a tag tapped repeatedly, each tap dispensing a tiny amount of water **below the charging threshold**, so water is dispensed but **no credit is charged**. This inflates **NRW (non-revenue water)**. At Kinamba it was the dominant NRW driver — ~50% NRW with no physical leaks; one tag tapped 1,350 times in 14 days (2026-06-22 thread).

**Controlled by `PreloadThreshold`** — the number of meter ticks that must accrue before charging starts. Stored in **`state.public.cascadingsettings`** where `settingkey = 'PreloadThreshold'` (`SELECT * FROM cascadingsettings WHERE settingkey = 'PreloadThreshold'`, Bryn 2026-06-24; DB is `state`, Iain 2026-06-24). Notes:
- The threshold count **starts the instant the tag is read** — there is **no delay** between tag presentation and tick counting (Ian E via Bryn, 2026-06-22). So a threshold of **0** charges anyone presenting a tag for a credit check or top-up collection when their balance isn't already zero.
- 36 ticks was the (too-high) value seen; **~18 ticks ≈ ¼ litre on a V3 flow meter**. Firmware V2 vs V3 differs only in the default flow-meter settings.
- Observed impact of lowering it at Kinamba: NRW ~50% → ~0% next day, ~halved by day two (Charlie, 2026-06-23 / 06-24).

**Data-side complement:** the `longflow` filtering in §2.3 excludes exactly these flashes when computing real flow — so flow/NRW analysis should prefer the long-flow figures.

### 2.5 Credit / balance data-quality — known corruption modes (Slack-confirmed)

Beyond the `supertapposition` / `tagtopupstate.state` issue documented under `tagtopup` (§2.2), two distinct credit-corruption modes were confirmed in `#support` (2026-06-19 → 2026-06-22). Both matter for any tag-balance / topup reconciliation:

- **Huge balances (~452,886 KES):** the Beam **"compare-exchange top-up" bug** — when a top-up is updated and collected at the same time it can corrupt and **write the maximum credit value**. **Beam-modem only**, rare (~3 known cases). A fix exists pending a global Beam update (Iain/Bryn, 2026-06-19).
- **Excess credit (top-up redelivery loop):** **server-side**, on **Gadwall**-modem assets whose **EWC clock is far out of sync** (e.g. stuck at the 2015 default, or 10 days out). Supertap top-up **collection matching uses the EWC log date**; if the clock is wildly off, the collection never matches, the top-up is never marked collected, so it is **re-pushed to the EWC again and again**, inflating the balance. The Beam updates the EWC clock on every sync, so **Beam is immune** — this is Gadwall-specific (Bryn, 2026-06-19 / 06-22).
- **Apparent deficits are NOT a real issue.** They arise from (a) counting **uncollected** top-ups against spend, and (b) the **Data Waterfall not reaching before ~July 2025** (§0) — so `generalwateruse`-based lifetime spend understates older tags. For accurate older lifetime usage use `assetcontroller.public.waterdisbursement` (Bryn, 2026-06-19). Use `tagtopupstate.state` (not `supertapposition`) to exclude uncollected top-ups.

### 2.6 Asset operating mode (BULK / Tag / Tap)

An asset/account runs in one of **BULK** (bulk-meter account, e.g. a school — logs in with a PIN, can be empty), **Tag**, or **Tap** mode. Notes (Slack, 2026-06-22 / 06-23, Bryn):
- **Mode changes are not currently audit-traceable** — there's no interface to see who changed an asset's mode/when (planned, not built).
- **Subsidy on a tag** is a **bonus applied on top of purchased top-ups**, **not** an automatic scheduled payment. **Bulk-meter accounts cannot be subsidised** currently (would need new work).
- Operational aside: **swapping the battery closes the valve**; the server re-opens it automatically (can take up to ~20 min).

---

## 3. Relationships

All single-direction (many→one), active, unless marked otherwise.

| From | To | Notes |
|---|---|---|
| AssetDowntime_UTC.AssetID | Asset Detail (Usage).AssetID | |
| AssetDowntime_UTC.LogDate | DateTable.Date | |
| Asset Detail (Usage).SystemID | System Detail.SystemID | |
| Organisation Detail.CountryID | Country Detail.CountryID | |
| System Detail.OrganisationID | Organisation Detail.OrganisationID | |
| Tags.householdid | household.householdid | |
| waterdisbursement (DQ).assetid | Asset Detail (Usage).AssetID | |
| waterdisbursement (DQ).nfcid | Tags.nfcid | |
| tagtopup.nfcid | Tags.nfcid | auto-detected |
| Tags.nfcid | SchoolTags.Tag | |
| Asset Filter (User).SystemID | System Filter.SystemID | |
| Tags.'Asset ID Master' | Asset Filter (User).AssetID | |
| System Filter.OrganisationID | Organisation Filter.OrganisationID | |
| Organisation Filter.CountryID | Country Filter.CountryID | |
| household.createdbyuserid | eWs Users.UserID | |
| **Village Asset Lookup (Tags).AssetID** | **Asset Filter (User).AssetID** | **bidirectional**, one-to-one |
| **Asset Detail (Usage).AssetID** | **Village Asset Lookup (Usage).AssetID** | **bidirectional**, one-to-one |
| waterdisbursement (DQ).Date | DateTable.Date | |
| Supply (All).Date | DateTable.Date | |
| Supply (All).entityid | Asset Detail (Usage).AssetID | |
| **Tag Household Locations.'Tag ID'** | **Tags.nfcid** | **bidirectional** |
| STS Lookup.assetid | Asset Detail (Usage).AssetID | auto-detected |
| STS Topups.Date | DateTable.Date | |
| STS Topups.stronmeterid | STS Lookup.stronmeterid | |
| AssetLifecycleHistory.AssetID | Asset Detail (Usage).AssetID | |
| tagtopup.Date | DateTable.Date | |
| DisbursementByTag.nfcid | Tags.nfcid | |
| DisbursementByTag.Date | DateTable.Date | |

**Star-schema shape:** `DateTable` is the shared date dimension; `Asset Detail (Usage)` is the asset dimension (rolling up through System Detail → Organisation Detail → Country Detail); `Tags` is the tag/account dimension (joined to household, SchoolTags, and the usage/topup facts). `mWater Survey` and the 6 static helper tables are not part of the relationship graph.

---

## 4. New combined usage tables — `ztrilist_generalwateruse_*` / `wateruserid`

These are **not yet wired into the semantic model**. They live in `state.public` and follow the same time-rollup pattern already used elsewhere in the model (`ztrilist_supplybyasset_0of6`, `ztrilist_disbursementbytag_2of6_perday`), but combine **asset + tag + time** into one fact family at every granularity, replacing the need to query the raw `assetcontroller.public.waterdisbursement` table directly.

> **⚠ Historical-coverage caveat (see §0).** This family is part of the **Data Waterfall**, which only began populating **~July 2025** (Slack, 2026-06-19, Bryn). The "verified date range" of 2023-04-15 → 2026-03-31 below reflects event timestamps present in the rollups, but eWater confirms the Waterfall is **not a reliable source of pre-July-2025 lifetime totals** — older tags' cumulative usage is understated, producing false "deficits" in balance reconciliations. So treat the replacement below as valid **for the recent/post-cutover window**, and use `assetcontroller.public.waterdisbursement` for anything that must span full history. A backfill is a non-prioritised backlog item.

### 4.1 `state.wateruserid` — the entity key lookup

| Column | Type | Notes |
|---|---|---|
| uniqueid | bigint | PK — this is the `entityid` referenced in every `ztrilist_generalwateruse_*` table |
| assetid | int | = `Asset Detail (Usage).AssetID` |
| tagid | bigint | decimal tag identifier — decodes to `nfcid` via `LPAD(UPPER(TO_HEX(tagid)), 8, '0')` |

Confirmed live (2026-06-18): 176,066 rows; tagid→hex decoding matches `assetcontroller.public.waterdisbursement.nfcid` exactly for sampled rows (e.g. `tagid 464343506 → hex 1BAD51D2`, which is the real nfcid recorded against `assetid 318` in the legacy table). So `wateruserid` is the **(asset, tag) combination dimension** — one row per distinct asset/tag pairing that has ever transacted, analogous to a junction/bridge table between `Asset Detail (Usage)` and `Tags`.

### 4.2 `ztrilist_generalwateruse_*` — the 7-level time rollup family

Same column shape in every table (column order/position of `dedupehash` varies slightly):

| Column | Type | Meaning |
|---|---|---|
| entityid | bigint | FK → `wateruserid.uniqueid` (asset+tag combo) |
| position | bigint | this row's key at its own grain (e.g. a day-number, week-number, month-number, or year) |
| parentposition | bigint | the `position` of the parent row one grain up (e.g. a day's `parentposition` = its week's `position`) — `null`/`0` at the top (`6of6_alltime`) |
| lowerbound, upperbound | timestamp | first/last event timestamp actually observed inside this rolled-up window |
| totallitres_count / totallitres_value | bigint / numeric | count of underlying raw rows and summed litres dispensed |
| totalseconds_count / totalseconds_value | bigint / numeric | dispensing duration (seconds) |
| totalticks_count / totalticks_value | bigint / numeric | raw meter "ticks" |
| totalcredits_count / totalcredits_value | bigint / numeric | credits consumed in the window — **note:** at the raw (`0of6`) grain this equals one event's own credit delta; at rolled grains it is *not* a naive SUM, it works out to `(maximumstartcredit_value − minimumendcredit_value) / 1000` — i.e. the highest start-credit reading minus the lowest end-credit reading seen in the window, scaled by 1000 (verified against sample rows) |
| maximumstartcredit_count / maximumstartcredit_value | bigint / numeric | highest "start credit" meter reading seen in the window (i.e. the earliest/largest balance before depletion) |
| minimumendcredit_count / minimumendcredit_value | bigint / numeric | lowest "end credit" meter reading seen in the window (i.e. the latest/smallest balance after depletion) |
| dedupehash | int | de-duplication hash for raw rows (only meaningfully populated in `0of6`) |

| Table | Grain | `position` represents | Verified row count (2026-06-18) | Verified date range |
|---|---|---|---|---|
| `ztrilist_generalwateruse_0of6` | raw event | unique transaction id | 91,636,243 normal-date rows (+2,443 with sentinel placeholder dates `2000-01-01`/`2086-01-01` — see caveat below) | 2023-04-15 → 2026-03-31 (real data; sentinel rows outside this) |
| `ztrilist_generalwateruse_1of6_perhour` | hour | hour-bucket key | — | same span |
| `ztrilist_generalwateruse_2of6_perday` | day | day-bucket key | 6,969,388 | same span |
| `ztrilist_generalwateruse_3of6_perweek` | week | week-bucket key | — | same span |
| `ztrilist_generalwateruse_4of6_permonth` | month | month-bucket key | — | same span |
| `ztrilist_generalwateruse_5of6_peryear` | year | calendar year | — | same span |
| `ztrilist_generalwateruse_6of6_alltime` | all-time | constant `1` | 1 row per `entityid` | full history per entity |

176,033 distinct `entityid` values appear in `0of6` (vs. 176,066 rows in `wateruserid` — a handful of registered asset/tag combos have no transactions yet).

**Caveat:** 2,443 rows (0.003%) in `0of6` carry placeholder bounds of exactly `2000-01-01 00:00:00` / `2086-01-01 00:00:00` — treat these as bad/unset timestamps and filter them out (`lowerbound >= '2010-01-01' AND upperbound <= '2030-01-01'`) before using `0of6` for anything date-sensitive.

### 4.3 How this replaces the legacy usage tables

| Legacy table/query | Replace with | Why |
|---|---|---|
| `waterdisbursement (DQ)` (live SQL `GROUP BY assetid, nfcid, day` against `assetcontroller.public.waterdisbursement`, 145M-row raw table, `dsn=assetcontroller`) | `state.public.ztrilist_generalwateruse_2of6_perday` joined to `wateruserid` (to get `assetid`/`nfcid` back out of `entityid`) | Same day-grain, same asset+tag dimensionality, already pre-aggregated server-side — avoids a live `GROUP BY` over a 145M-row table on every refresh, and avoids the separate `assetcontroller` DSN entirely (one fewer database dependency). `totallitres_value` ≡ `Litres (Daily)`; credit consumed ≡ `(maximumstartcredit_value − minimumendcredit_value)/1000` ≡ legacy `credit` (= `SUM(startcredit-endcredit)`). |
| `DisbursementByTag` (`ztrilist_disbursementbytag_2of6_perday`, tag-only entity, `dsn=state`) | Superseded entirely — `generalwateruse_2of6_perday` already carries the tag dimension (via `wateruserid.tagid`) plus the asset dimension that `DisbursementByTag` lacked. Tags' `Uses 49d`/`Litres 49d` calculated columns can read directly from `generalwateruse_2of6_perday` filtered to the relevant `entityid`s for that `nfcid`. | One fewer narrow, asset-blind table to maintain. |
| Any future "litres per hour/week/month/year/all-time" reporting that today would require re-aggregating `waterdisbursement (DQ)` in DAX | Pull directly from the matching `generalwateruse_Nof6_*` grain | The hourly/weekly/monthly/yearly/all-time rollups are already computed server-side — no need for `SUMMARIZE`/`TOTALYTD`-style DAX gymnastics across day-level data. |
| `Supply (All)` (flow-rate diagnostic, 3 hardcoded assets, `ztrilist_supplybyasset_0of6`) | **Not replaced.** This is asset-only (no tag dimension) flow telemetry for a hand-picked diagnostic subset — a different use case from dispensing-by-tag. | Different entity key family (`ztrilist_supplybyasset_*`, not `wateruserid`). |
| `tagtopup` (wallet top-ups) | **Not replaced.** Top-ups are a credits/wallet event, not a water-dispensing event — `generalwateruse` only covers litres/seconds/ticks/credit-spend from dispensing, not top-up transactions. | Different domain. |

### 4.4 Suggested M/SQL pattern to replace `waterdisbursement (DQ)`

```sql
SELECT
    w.assetid,
    LPAD(UPPER(TO_HEX(w.tagid)), 8, '0') AS nfcid,
    CAST(g.lowerbound AS date)           AS "Date",
    g.totallitres_value                  AS "Litres (Daily)",
    (g.maximumstartcredit_value - g.minimumendcredit_value) / 1000.0 AS credit
FROM public.ztrilist_generalwateruse_2of6_perday g
JOIN public.wateruserid w ON w.uniqueid = g.entityid
WHERE g.lowerbound >= DATE '<cutoffDateText>'
  AND g.lowerbound >= DATE '2010-01-01' AND g.upperbound <= DATE '2030-01-01'  -- drop sentinel rows
```
Run against the `state` DSN (replacing `dsn=assetcontroller`). Same output shape as the current `waterdisbursement (DQ)` partition, so the relationship to `Asset Detail (Usage)` and `Tags`, and all of its downstream measures (`Sum Litres`, `Revenue (KES)`, etc.), would not need to change.

### 4.5 Worked example — litres/day, last 7 days, by country

Because `asset`/`watersystem`/`organisation`/`country` all live in the same `state` schema as `generalwateruse`, country-level cuts need no extra joins outside `state`:

```sql
SELECT
    g.lowerbound::date AS usage_date,
    w.assetid,
    SUM(g.totallitres_value) AS litres
FROM public.ztrilist_generalwateruse_2of6_perday g
JOIN public.wateruserid w  ON w.uniqueid = g.entityid
JOIN public.asset a        ON a.id = w.assetid
JOIN public.watersystem s  ON s.id = a.parentid
JOIN public.organisation o ON o.id = s.parentid
JOIN public.country c      ON c.id = o.parentid
WHERE c.name = 'Kenya'
  AND g.lowerbound >= current_date - interval '7 days'
  AND g.lowerbound >= DATE '2010-01-01' AND g.upperbound <= DATE '2030-01-01'  -- drop sentinel rows
GROUP BY 1, 2
ORDER BY 1, 2
```
Verified live (2026-06-18): 341 distinct Kenyan assets have recorded usage in the trailing 7 days via this path.

**Critical caveat — exclude eSense from disbursement, cap spikes on supply:** `asset.purpose = 'eSense'` rows are **flow meters on the bulk supply line feeding each water system** (upstream of the tap/dispensing assets) — not NFC-tag dispensing points. They are a different physical measurement (supply into the system, not litres dispensed to a household/tag) and have a known fault mode producing **freak spikes** in their readings. Confirmed live: `eSense Mutanga` (assetid 2471) logged ~17M litres in a single multi-hour session, inflating a naive Kenya-wide daily disbursement total from a realistic ~100-127k litres/day to 200M+.

Rules (eWater-confirmed, 2026-06-18):
- **Disbursement/usage analysis** (litres dispensed to tags/households — `waterdisbursement (DQ)`, `generalwateruse`, any "litres used" metric): **always exclude `asset.purpose = 'eSense'` entirely.** eSense assets never represent real disbursement and must not be summed into tap-usage totals. Add `AND a.purpose <> 'eSense'` to any `generalwateruse`/asset-joined query that aggregates "all assets".
- **Supply-level analysis** (using eSense flow data intentionally, e.g. `Supply (All)` or the raw `state.public.ztrilist_supplybyasset_0of6` feed, to look at bulk supply into a system): eSense data is valid and useful, but **must have spike-filtering applied** — discard any reading implying a flow rate **over 300 litres/minute** (18,000 L/hr) before aggregating, since rates above this are sensor-fault artifacts, not real supply. `Supply (All)[flow rate l/hr]` currently has no such cap — this should be added (e.g. exclude rows where `totallitres_value / (totalseconds_value/60) > 300`, or equivalently `totallitres_value / (totalseconds_value/3600) > 18000`) before the measure sums litres/seconds.
- The legacy `Asset Detail (Usage)`/`waterdisbursement (DQ)` measures (`Live Assets`, `Sum Litres`, etc.) are sourced from `assetcontroller.public.waterdisbursement`, which is populated by tag-scan dispensing events only — eSense assets don't write to that table, so the existing dashboard's disbursement totals are not at risk from this issue. The risk is specific to any **new** query against `generalwateruse`/`wateruserid` (§4) or the existing `Supply (All)` table that joins/aggregates "all assets" without filtering `Purpose`.

---

## 5. Cross-cutting notes / known issues

- **KES conversion constant `0.2109`** is hardcoded in DAX in four places (`Tags[Credits (KSH)]`, `tagtopup`'s KES measures, `STS Topups['KES Topup']`, `waterdisbursement (DQ)[Revenue (KES)]`) — not parameterised, so an exchange-rate change requires editing multiple measures. **This value is correct for Kenya specifically, not universal.** The real per-country rate lives in `ewater_central.public."Country".CreditExchangeRate` (joined to `ewater_central.public."Currency"` for the currency code), and `CountryID` there matches `state.public.country.id` exactly. Confirmed live (2026-06-18): Kenya `0.2109 KES`, Gambia `0.070755 GMD`, UK `0.00111 GBP`, Portugal `0.00134 EUR`, Tanzania `3.409095 TZS`, Ghana `0.006765 GHS` (Austria's row maps to GMD with rate `1.0` — clearly junk/test config, not a real rate). Any credit-to-currency conversion outside Kenya must use this table, not the hardcoded `0.2109`.
- **Household-size multiplier `4.7`** in `waterdisbursement (DQ)[# Users]` (`DISTINCTCOUNT(nfcid) * 4.7`) has the same problem — it's Kenya's `AvgPeoplePerHousehold` from `ewater_central.public."Country"`, hardcoded as if universal. Other countries differ (UK 4.26, Gambia 8.23, Tanzania 4.9, Ghana 4.05, Portugal 0/no data) — the measure under/over-states beneficiary counts for any non-Kenya country.
- **5-litres/day threshold** is the de facto "genuine usage" filter throughout `Tags` and `waterdisbursement (DQ)` measures.
- **Passthrough "Filter" tables** (`Asset Filter (User)`, `Country Filter`, `Organisation Filter`, `System Filter`, `Village Asset Lookup (Tags)`) are independent in-memory copies of their "Detail" counterparts (`let Source = #"<Detail>" in Source`), not new queries — used to give report authors slicers without circular filter context.
- **Three bidirectional relationships** (Village Asset Lookup ↔ Asset Filter, Asset Detail ↔ Village Asset Lookup (Usage), Tag Household Locations ↔ Tags) — intentional, to let geography slicers filter both ways.
- **`mWater Survey`** has an `nfcid` column but no relationship to `Tags.nfcid` — currently an orphan table.
- **`Tag Household Locations`** points at a hardcoded personal OneDrive path and is excluded from scheduled refresh — will silently go stale unless refreshed manually on that machine.
- **`Supply (All)`** is filtered at source to only 3 eSense bulk-supply meter assets (`entityid = 2015, 2211, 2105`) — not a fleet-wide table, and not the same thing as tap disbursement. See the eSense caveat in §4.5 for the disbursement-exclusion / 300 L/min supply-spike-filter rules.
  - **The on-dashboard eSense flow-rate chart is NOT driven by this table.** It comes from the **old system** (`assetcontroller.public.assetpropertysnapshot`), not `ztrilist_supplybyasset_0of6` (Slack, 2026-06-19, Bryn). Behavioural difference that matters when reconciling the two: `assetpropertysnapshot` **forces a datapoint every interval** (so a ~4-hr idle window renders as a flat ~0.1 L/min rather than ~3.5 hr at 0 + a short real burst), whereas **`ztrilist_supplybyasset_0of6` filters out 0-flow sense events** (so the supply series has genuine gaps where there was no flow). See §2.3.
- `waterdisbursement (DQ)` and `Supply (All)` both carry a `PBI_ResultType = Exception` partition annotation — leftover Desktop metadata, not necessarily indicating a current refresh failure, but worth checking next refresh.
- Legacy `assetcontroller.public.waterdisbursement` holds ~145.5M raw rows (2015 → 2092, including sentinel future dates) — querying it live on every refresh (as `waterdisbursement (DQ)` does today) is the most expensive part of the current refresh; §4 above is the fix.
