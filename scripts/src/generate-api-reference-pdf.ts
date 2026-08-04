/**
 * Generates a PDF reference document covering:
 *  1. eWater upstream API endpoints consumed by this app
 *  2. MCP server tools exposed by this app
 */

import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "..", "exports");
const HTML_PATH = path.join(OUT_DIR, "eWater-API-Reference.html");
const PDF_PATH = path.join(OUT_DIR, "eWater-API-Reference.pdf");

const CHROMIUM_PATH =
  "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium";

const CSS = `
  @page { margin: 0; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
    color: #1a1f2b;
    font-size: 10.5pt;
    line-height: 1.55;
    padding: 52px 60px;
  }
  h1 {
    font-size: 20pt;
    color: #0b3d5c;
    border-bottom: 3px solid #0b7285;
    padding-bottom: 8px;
    margin-top: 0;
  }
  h1.pb { page-break-before: always; margin-top: 0; }
  h2 {
    font-size: 13pt;
    color: #0b3d5c;
    margin-top: 28px;
    border-bottom: 1px solid #cdd7dd;
    padding-bottom: 3px;
    page-break-after: avoid;
  }
  h3 {
    font-size: 11pt;
    color: #0b5c7a;
    margin-top: 20px;
    page-break-after: avoid;
  }
  p, li { font-size: 10pt; margin: 4px 0; }
  ul { margin: 4px 0 8px 0; padding-left: 20px; }
  code {
    background: #f1f4f6;
    border-radius: 3px;
    padding: 1px 5px;
    font-family: "SF Mono", Consolas, Menlo, monospace;
    font-size: 8.8pt;
    color: #a4262c;
  }
  pre {
    background: #0d2d40;
    color: #d6eaf5;
    padding: 10px 14px;
    border-radius: 5px;
    font-size: 8.2pt;
    page-break-inside: avoid;
    white-space: pre-wrap;
    word-break: break-word;
    margin: 6px 0;
  }
  pre code { background: none; color: inherit; padding: 0; font-size: 8.2pt; }
  table {
    border-collapse: collapse;
    width: 100%;
    margin: 10px 0;
    font-size: 9pt;
    page-break-inside: avoid;
  }
  th, td { border: 1px solid #cdd7dd; padding: 4px 8px; text-align: left; vertical-align: top; }
  th { background: #eaf3f6; color: #0b3d5c; }
  hr { border: none; border-top: 1px solid #cdd7dd; margin: 20px 0; }
  .eb {
    background: #f7fafb;
    border: 1px solid #cdd7dd;
    border-radius: 5px;
    padding: 10px 13px;
    margin: 12px 0;
    page-break-inside: avoid;
  }
  .tb {
    background: #f2f8fc;
    border: 1px solid #b8d8e8;
    border-radius: 5px;
    padding: 10px 13px;
    margin: 12px 0;
    page-break-inside: avoid;
  }
  .mg  { background:#1a7a4a; color:#fff; padding:1px 6px; border-radius:3px; font-size:8pt; font-weight:bold; font-family:monospace; }
  .mp  { background:#0b5c9a; color:#fff; padding:1px 6px; border-radius:3px; font-size:8pt; font-weight:bold; font-family:monospace; }
  .md  { background:#8b2020; color:#fff; padding:1px 6px; border-radius:3px; font-size:8pt; font-weight:bold; font-family:monospace; }
  .hn  { display:inline-block; background:#444; color:#fff; padding:1px 7px; border-radius:3px; font-size:8pt; font-family:monospace; }
  .hs  { display:inline-block; background:#1a5c7a; color:#fff; padding:1px 7px; border-radius:3px; font-size:8pt; font-family:monospace; }
  .hq  { display:inline-block; background:#4a1a7a; color:#fff; padding:1px 7px; border-radius:3px; font-size:8pt; font-family:monospace; }
  .hc  { display:inline-block; background:#7a3a00; color:#fff; padding:1px 7px; border-radius:3px; font-size:8pt; font-family:monospace; }
  .sec { display:inline-block; background:#0b7285; color:#fff; border-radius:3px; padding:1px 7px; font-size:8pt; margin-right:6px; vertical-align:middle; }
  .cover { height:100vh; display:flex; flex-direction:column; justify-content:center; page-break-after:always; }
  .ctitle { font-size:27pt; color:#0b3d5c; font-weight:700; margin-bottom:4px; }
  .csub { font-size:12pt; color:#0b7285; margin-bottom:36px; }
  .cmeta { font-size:9.5pt; color:#555; line-height:2; }
  .toc { font-size:10pt; }
  .te { display:flex; padding:2px 0; }
  .te a { color:#0b3d5c; text-decoration:none; }
  .td { flex:1; border-bottom:1px dotted #aaa; margin:0 6px; position:relative; top:-3px; }
  .ind { padding-left:18px; }
`;

const DATE = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });

const mG = `<span class="mg">GET</span>`;
const mP = `<span class="mp">POST</span>`;

function row(host: string, method: string, endpoint: string, summary: string, desc: string, body?: string, resp?: string) {
  const hcls = { state: "hs", query: "hq", command: "hc" }[host] ?? "hn";
  const m = method === "GET" ? mG : mP;
  return `
<div class="eb">
  <p style="margin:0 0 5px"><span class="${hcls}">${host}.ewater.io</span> &nbsp; ${m} <code>${endpoint}</code></p>
  <p style="margin:0 0 3px"><strong>${summary}</strong></p>
  <p style="margin:0">${desc}</p>
  ${body ? `<p style="margin:4px 0 1px"><strong>Body:</strong></p><pre>${body}</pre>` : ""}
  ${resp ? `<p style="margin:4px 0 1px"><strong>Key response fields:</strong> ${resp}</p>` : ""}
</div>`;
}

function tool(name: string, desc: string, inputs: string) {
  return `
<div class="tb">
  <p style="margin:0 0 5px"><code style="font-size:9.5pt;color:#0b3d5c;font-weight:bold">${name}</code></p>
  <p style="margin:0 0 5px">${desc}</p>
  ${inputs ? `<p style="margin:3px 0 1px"><strong>Inputs:</strong></p>${inputs}` : ""}
</div>`;
}

function ptable(rows: [string, string, string][]) {
  return `<table><tr><th>Parameter</th><th>Type / default</th><th>Description</th></tr>
${rows.map(([n, t, d]) => `<tr><td><code>${n}</code></td><td>${t}</td><td>${d}</td></tr>`).join("")}
</table>`;
}

const CONTENT = `
<div class="cover">
  <div class="ctitle">eWater Monitor</div>
  <div class="csub">API Reference — Upstream eWater Endpoints &amp; MCP Tools</div>
  <div class="cmeta">
    <strong>Part 1:</strong> eWater upstream API endpoints consumed by this application<br/>
    <strong>Part 2:</strong> MCP server tools exposed at <code>/api/mcp</code><br/>
    <br/>
    eWater API base URLs: <code>state.ewater.io</code> · <code>query.ewater.io</code> · <code>command.ewater.io</code><br/>
    Auth: cookie-based session via <code>auth.ewater.io/User/LoginViaForm</code><br/>
    All upstream requests carry <code>Authorization: Bearer &lt;token&gt;</code><br/>
    <br/>Generated: ${DATE}
  </div>
</div>

<div class="toc">
  <div class="te"><span>Part 1 — eWater Upstream API</span><span class="td"></span></div>
  <div class="te ind"><span>Authentication</span><span class="td"></span></div>
  <div class="te ind"><span>Entity &amp; Asset hierarchy</span><span class="td"></span></div>
  <div class="te ind"><span>Asset detail &amp; status</span><span class="td"></span></div>
  <div class="te ind"><span>EWC settings &amp; calibration</span><span class="td"></span></div>
  <div class="te ind"><span>Logs &amp; packets</span><span class="td"></span></div>
  <div class="te ind"><span>Tank height &amp; inflow charts</span><span class="td"></span></div>
  <div class="te ind"><span>Tags, households &amp; disbursements</span><span class="td"></span></div>
  <div class="te ind"><span>Commands</span><span class="td"></span></div>
  <div class="te" style="margin-top:6px"><span>Part 2 — MCP Server Tools</span><span class="td"></span></div>
  <div class="te ind"><span>Overview &amp; auth</span><span class="td"></span></div>
  <div class="te ind"><span>Hierarchy tools</span><span class="td"></span></div>
  <div class="te ind"><span>Asset tools</span><span class="td"></span></div>
  <div class="te ind"><span>Tag &amp; household tools</span><span class="td"></span></div>
  <div class="te ind"><span>Disbursement tools</span><span class="td"></span></div>
  <div class="te ind"><span>Log tools</span><span class="td"></span></div>
</div>

<!-- =========================================================== -->
<h1 class="pb"><span class="sec">PART 1</span> eWater Upstream API Endpoints</h1>

<p>These are the eWater API endpoints called by this application. All requests use <code>Authorization: Bearer &lt;token&gt;</code>.
The token is obtained by logging in via <code>auth.ewater.io</code> (see Authentication below) and is automatically refreshed on 401.</p>

<p>
  <span class="hs">state</span> &nbsp; <code>https://state.ewater.io</code> — asset data, logs, settings, calibration<br/>
  <span class="hq">query</span> &nbsp; <code>https://query.ewater.io</code> — live status snapshots<br/>
  <span class="hc">command</span> &nbsp; <code>https://command.ewater.io</code> — device commands<br/>
  <span class="hn">auth</span> &nbsp; <code>https://auth.ewater.io</code> — login / token
</p>

<h2>Authentication</h2>
<p>Token acquisition is a two-step web-login flow (no OAuth or dedicated token endpoint):</p>

<div class="eb">
  <p style="margin:0 0 5px"><span class="hn">auth.ewater.io</span> &nbsp; ${mG} <code>/</code></p>
  <p style="margin:0 0 3px"><strong>Step 1 — Fetch login page</strong></p>
  <p style="margin:0">Returns an HTML login form. The app extracts the hidden <code>__RequestVerificationToken</code> CSRF field value and the <code>.AspNetCore.Antiforgery.*</code> cookie from the response headers.</p>
</div>

<div class="eb">
  <p style="margin:0 0 5px"><span class="hn">auth.ewater.io</span> &nbsp; ${mP} <code>/User/LoginViaForm</code></p>
  <p style="margin:0 0 3px"><strong>Step 2 — Submit credentials</strong></p>
  <p style="margin:0">Form-encoded POST. On success responds <code>302</code> with <code>Set-Cookie: access_token=&lt;jwt&gt;</code>. The app extracts the token and caches it for ~1 hour, then retries automatically on 401.</p>
  <p style="margin:4px 0 1px"><strong>Body (form-encoded):</strong></p>
  <pre>Username=user@example.com
Password=…
ReturnUrl=/swagger
__RequestVerificationToken=&lt;csrf from step 1&gt;</pre>
</div>

<h2>Entity &amp; Asset Hierarchy</h2>

${row("state", "GET", "/api/Entity/List", "Full entity hierarchy", "Returns countries, organisations, water systems, and a shallow asset list in one call. Used to resolve water system names, country names, and asset counts throughout the application.",
  undefined,
  `<code>countries[]</code> · <code>organisations[]</code> · <code>waterSystems[]</code> · <code>assets[]</code> (each with <code>id</code>, <code>name</code>, <code>parentId</code>, <code>assetLifecycleState</code>, <code>purpose</code>, <code>latitude</code>, <code>longitude</code>)`
)}

${row("state", "POST", "/api/Entity/Assets", "Pageable assets list", "Returns the full asset list with lifecycle filtering. Preferred over the shallow assets array inside <code>/api/Entity/List</code> when a dedicated asset listing is needed.",
  `{ "assetLifecycleStates": ["PreInstallation","Active","Staged","Demo","Test","Suspended"] }`,
  `<code>assets[]</code> — same shape as Entity/List assets`
)}

<h2>Asset Detail &amp; Status</h2>

${row("state", "GET", "/api/Asset/GetAssetBasicInfoByAssetID?assetId={id}", "Basic asset info", "Returns name, purpose, assetLifecycleState, parentId (water system), latitude, longitude.",
  undefined,
  `<code>name</code> · <code>purpose</code> · <code>assetLifecycleState</code> · <code>parentId</code> · <code>latitude</code> · <code>longitude</code>`
)}

${row("state", "GET", "/api/Asset/LastKnownHealthStatus?assetId={id}", "Last known health", "Returns the most recent health/voltage rating from the health monitoring system.",
  undefined,
  `<code>lastKnownVoltageReading</code> · <code>lastKnownVoltageRating</code> · <code>lastKnownFlowRateRating</code>`
)}

${row("query", "GET", "/api/Asset/AssetConnectivityStatus?assetId={id}", "Connectivity status", "Live connectivity snapshot including last communication timestamp and tap event rates.",
  undefined,
  `<code>lastCommsDt</code> · <code>lastNetwork</code> · <code>tapEventsPerMinuteToday</code> · <code>tapEventsPerMinuteThisWeek</code>`
)}

${row("query", "GET", "/api/Asset/AssetPowerStatus?assetId={id}", "Battery / power status", "Live battery voltage snapshot with trend and today's high/low.",
  undefined,
  `<code>lastKnownVoltage</code> · <code>trendDirection</code> · <code>todayHigh</code> · <code>todayLow</code> · <code>todayLowBatteryEventCount</code>`
)}

${row("query", "GET", "/api/Asset/AssetFlowStatus?assetId={id}", "Flow rate status", "Average flow rates over the last hour, today, and this week.",
  undefined,
  `<code>hourAverageFlowRate</code> · <code>todayAverageFlowRate</code> · <code>weekAverageFlowRate</code>`
)}

${row("query", "GET", "/api/Asset/AssetUsageStatus?assetId={id}", "Usage status", "Today's litres dispensed and last usage timestamp.",
  undefined,
  `<code>litresDispensedToday</code> · <code>lastUsageDt</code>`
)}

${row("state", "GET", "/api/Asset/GetStatusValuesForAsset?assetId={id}", "Status values (health flags, tamper)", "Returns the device's current status values including health flags and tamper switch state.",
  undefined,
  `<code>data.healthFlags.value</code> · <code>data.tamperSwitchState.value</code>`
)}

${row("state", "GET", "/api/Asset/GetFirmwareStatusByAssetId?assetId={id}", "Firmware status", "Returns firmware device types and their last known versions for all modules on this asset.",
  undefined,
  `<code>deviceChanges[].deviceType</code> · <code>lastKnownFirmwareName</code> · <code>commandPhase</code> · <code>lastKnownDate</code>`
)}

${row("state", "GET", "/api/Asset/GetIdentifiersByAssetId?assetId={id}", "IMEI identifiers", "Returns all IMEI/modem identifiers registered to this asset. An asset can have multiple (e.g. after device swap). Note: secondary devices like Shengda NB-IoT meters may NOT appear here — only discovered via log scanning.",
  undefined,
  `<code>identifiers[].imei</code> · <code>modemType</code> · <code>createdDate</code>`
)}

${row("state", "GET", "/api/Asset/GetCommandsForAsset?assetId={id}&pageSize=20&pageIndex=0", "Recent device commands", "Returns the most recent commands sent to the device.",
  undefined,
  `<code>commands[].id</code> · <code>state</code> · <code>priority</code> · <code>createdDate</code> · <code>correlationId</code>`
)}

${row("query", "GET", "/api/Entity/HealthSnapshots", "Fleet-wide health snapshots", "Returns aggregated health counts across all entities (online/offline/unknown per factor).",
  undefined,
  `<code>snapshots[].totalAssetsCount</code> · <code>healthyAssetsCount</code> · <code>unhealthyAssetsCount</code> · <code>lastUpdatedDt</code> · <code>healthFactorSnapshots[].healthFactor</code> · <code>goodCount</code> · <code>poorCount</code>`
)}

${row("query", "GET", "/api/Entity/FaultSnapshots", "Fleet-wide fault snapshots", "Returns aggregated active fault counts across all entities.",
  undefined,
  `<code>snapshots[].activeFaultCounts[].faultId</code> · <code>activeCount</code>`
)}

<h2>EWC Settings &amp; Calibration</h2>

${row("state", "GET", "/api/Asset/GetSettingsMapForAsset?assetId={id}", "Full EWC settings map", "Returns all EWC device settings as a key-value map. Each entry has a settingKey and a value object with lastKnownValue and lastKnownDate. This is the authoritative source for LCF (LitresConversion) and all calibration parameters.",
  undefined,
  `<code>data.settings[].settingKey</code> · <code>value.lastKnownValue</code> · <code>value.lastKnownDate</code><br/>
  Key setting keys: <code>LitresConversion</code> (LCF — ticks per litre), <code>FlowConversion</code> (FCF — ticks per credit), <code>CurrencyConversion</code> (FX), <code>Preload</code>, <code>FlowPreloadCharge</code>, <code>FlowPreloadThreshold</code>, <code>ValveDriveTime</code>, <code>DispenseTimeLimit</code>, <code>DispenseFlowLimit</code>, <code>NoFlowCycleCount</code>, <code>LowBatteryWarning</code>, <code>HealthStateReportPeriod</code>, <code>MiFareBlockAddress</code>, <code>EncryptionControl</code>, <code>EwcId</code>, <code>PowerCount</code> …`
)}

${row("state", "GET", "/api/Asset/GetTicksPerLitre?assetId={id}", "Ticks per litre (fallback)", "Fallback LCF source used when LitresConversion is absent from the settings map. Returns a single numeric value.",
  undefined,
  `<code>ticksPerLitre</code> (number)`
)}

<h2>Logs &amp; Packet Data</h2>

${row("state", "POST", "/api/Asset/GetLogsForAssetByReceivedDate", "Asset communication logs", "The primary log endpoint. Returns raw log lines for an asset over a date range, including EWC 2.5 datalog packets, command replies, and outgoing commands. The <code>payload</code> field is base64-encoded binary. Used by: asset logs view, flow-rate computation, calibration analysis, meter reading, tag usage lookup, eSense charts, IMEI discovery.",
  `{ "assetId": 662, "startDate": "2026-07-25T00:00:00Z", "endDate": "2026-08-04T00:00:00Z", "pipeline": null }`,
  `<code>logLines[].id</code> · <code>timeReceived</code> · <code>pipeline</code> (MQTT/UDP/CmdApi) · <code>protocol</code> (Ewc2_5/CommandApi_1/4CCv1/Gadwall) · <code>payload</code> (base64 binary) · <code>source</code> (JSON string containing IMEI)`
)}

${row("state", "POST", "/api/Logs/GetLogsInDateRangeByImei", "IMEI-based raw packet logs", "Returns raw NB-IoT packet logs for a specific IMEI over a date range. Used for Shengda NB-IoT meter packet browsing. Each entry is decoded server-side using DescribeRawData.",
  `{ "imei": "869595067005701", "startDate": "2026-08-03T00:00:00Z", "endDate": "2026-08-04T00:00:00Z" }`,
  `<code>logLines[].id</code> · <code>timeReceived</code> · <code>pipeline</code> · <code>protocol</code> · <code>payload</code> (base64) · <code>source</code>`
)}

${row("state", "GET", "/api/Logs/DescribeRawData?data={base64}", "Decode raw packet payload", "Returns a human-readable description string for a base64-encoded raw packet payload. Called once per entry in the IMEI packet log.",
  undefined,
  `Plain text string — human-readable decoded packet description`
)}

<h2>Tank Height &amp; Inflow Charts</h2>

${row("state", "POST", "/api/Asset/GetTankHeightHistoryByDateRange", "Tank height history", "Returns per-period average water and chlorine tank depths in metres. Used by the eSense charts view and sensor-range auto-detection.",
  `{ "assetId": 662, "startDate": "2026-08-01T00:00:00Z", "endDate": "2026-08-04T00:00:00Z" }`,
  `<code>data[].lowerBound</code> · <code>upperBound</code> · <code>averageWaterTankHeight</code> · <code>averageChlorineTankHeight</code> (all in metres)`
)}

${row("state", "POST", "/api/Asset/GetDisbursementHistoryByDateRange", "Daily inflow / disbursement history", "Returns per-day dispensed volume used for the Daily Inflow chart. Set <code>includeTickAccumulatorDerivedDisbursement: true</code> to include meter-derived estimates when direct measurements are absent.",
  `{ "assetId": 662, "startDate": "2026-07-25T00:00:00", "endDate": "2026-08-04T00:00:00", "includeTickAccumulatorDerivedDisbursement": true }`,
  `<code>data[].lowerBound</code> · <code>upperBound</code> · <code>aggregatedValue</code> (litres for the period)`
)}

<h2>Tags, Households &amp; Disbursements</h2>

${row("state", "GET", "/api/Reference/GetTagIdsByRegisteredWaterSystem?waterSystemId={id}", "Registered NFC tag IDs", "Returns an array of all fully-registered NFC tag ID strings for a water system.",
  undefined,
  `JSON array of NFC tag ID strings, e.g. <code>["A7370000","DBDA4ED2",…]</code>`
)}

${row("state", "GET", "/api/Reference/GetTagInfo?tagId={nfcId}", "NFC tag registration info", "Returns registration details for one tag. <code>favAssetId</code> is the primary asset. Credits are in mits (1/1000 of a local currency unit).",
  undefined,
  `<code>nfcId</code> · <code>favAssetId</code> (primary asset ID) · <code>favSystemId</code> · <code>favCountryId</code> · <code>householdId</code> (UUID) · <code>credits</code> · <code>disbursementCount</code> · <code>topUpCount</code> · <code>signUpDt</code> · <code>createdDt</code> · <code>lastUsageDt</code> · <code>deletedDt</code> · <code>blackListDt</code>`
)}

${row("state", "GET", "/api/Reference/GetHouseholdInfo?householdId={uuid}", "Household details", "Returns the registered household name and metadata. Phone number, address, and GPS coordinates are omitted by eWater per data-protection policy.",
  undefined,
  `<code>householdId</code> · <code>name</code> · <code>assetId</code> · <code>systemId</code> · <code>createdDt</code> · <code>lastActiveDt</code>`
)}

${row("state", "POST", "/api/Usage/GetDisbursementsByTagAndAsset", "Per-day disbursements: tag + asset", "Returns per-day aggregated disbursements for one NFC tag at one specific tap. aggregationWindow is always PerDay.",
  `{ "tagId": "A7370000", "assetId": 662, "startDate": "2026-07-05T00:00:00Z", "endDate": "2026-08-04T00:00:00Z" }`,
  `<code>requestedStart</code> · <code>requestedEnd</code> · <code>aggregationWindow</code> · <code>data[].lowerBound</code> · <code>upperBound</code> · <code>readingCount</code> · <code>totalCredits</code> · <code>totalTicks</code> · <code>totalSeconds</code> · <code>estimateTotalLitres</code>`
)}

${row("state", "POST", "/api/Usage/GetDisbursementsByTag", "Per-day disbursements: tag (all assets)", "Returns per-day totals for one NFC tag across all taps. Same response shape as GetDisbursementsByTagAndAsset.",
  `{ "tagId": "A7370000", "startDate": "2026-07-05T00:00:00Z", "endDate": "2026-08-04T00:00:00Z" }`,
  `Same as GetDisbursementsByTagAndAsset`
)}

${row("state", "POST", "/api/Usage/GetDisbursementsByAsset", "Per-day disbursements: asset (all tags)", "Returns per-day totals from one tap across all NFC tags. Same response shape.",
  `{ "assetId": 662, "startDate": "2026-07-05T00:00:00Z", "endDate": "2026-08-04T00:00:00Z" }`,
  `Same as GetDisbursementsByTagAndAsset`
)}

<h2>Device Commands</h2>

${row("command", "POST", "/api/Ewc/ResetTickAccumulator", "Reset lifetime tick accumulator", "Instructs the device to set its lifetime tick counter to a given litre value on the next comms cycle. The IMEI must be resolved from the asset's identifier registry first.",
  `{ "correlationId": null, "secondaryUserId": null, "imei": "869595067005701", "assetId": 662, "litreValue": 15420.5 }`,
  `HTTP 200–299 = accepted; non-2xx = rejected (body contains error details)`
)}

${row("command", "POST", "/api/Ewc/RequestSettingChange", "Write an EWC setting to the device", "Queues a setting change (desired-value pattern). The device applies it on its next comms cycle. Used to write LCF (<code>LitresConversion</code>) and Preload calibration values.",
  `{ "correlationId": null, "secondaryUserId": null, "assetId": 662, "settingKey": "LitresConversion", "newValue": 512 }`,
  `HTTP 200–299 = accepted; non-2xx = rejected`
)}

<!-- =========================================================== -->
<h1 class="pb"><span class="sec">PART 2</span> MCP Server Tools</h1>

<h2>Overview &amp; Authentication</h2>
<p>The MCP server is mounted at <code>POST/GET/DELETE /api/mcp</code> using the Streamable HTTP transport (JSON-RPC 2.0).
It is <strong>stateless</strong> — a fresh server + transport is created per request, so there are no session-lifecycle concerns.
All tools call the same eWater logic as the REST routes via shared functions in <code>ewater-insights.ts</code>.</p>

<p><strong>Auth:</strong> every request requires <code>Authorization: Bearer &lt;MCP_BEARER_TOKEN&gt;</code> (a static shared secret, separate from eWater credentials).</p>

<p><strong>Pagination envelope</strong> — all list tools return:</p>
<pre>{ "totalCount": 142, "returnedCount": 25, "offset": 0, "limit": 25, "hasMore": true, "&lt;items key&gt;": […] }</pre>
<p>Single-object tools wrap their result in <code>{ data: {…}, totalCount: 1, returnedCount: 1, hasMore: false }</code>.</p>

<p><strong>WhatsApp guidance</strong> — all descriptions include inline formatting rules for WhatsApp field-engineer channels: max 5 records per reply, no raw hex payloads, pipeline=CmdApi entries never presented as incoming telemetry, error events prefixed with ■.</p>

<h2>Hierarchy Tools</h2>

${tool("list_countries",
  "Lists all countries with organisation, water system, and asset counts. No inputs required. Always <code>hasMore: false</code>. Entry point for the Country → Organisation → Water System → Asset drill-down.",
  ""
)}

${tool("list_organisations",
  "Lists organisations, optionally filtered by country. Returns water system and asset counts per org.",
  ptable([
    ["countryId", "integer · optional", "Filter by country ID (from list_countries)"],
    ["countryName", "string · optional", "Filter by exact country name"],
  ])
)}

${tool("list_water_systems",
  "Lists water systems with asset counts, optionally filtered by organisation and/or country. Pass a returned ID to list_assets or list_registered_tags.",
  ptable([
    ["organisationId", "integer · optional", "Filter by organisation ID"],
    ["organisationName", "string · optional", "Filter by exact organisation name"],
    ["countryId", "integer · optional", "Filter by country ID"],
    ["countryName", "string · optional", "Filter by exact country name"],
  ])
)}

${tool("list_assets",
  "Paginated asset list with filtering. <code>totalCount</code> answers 'how many?' from a single first-page call without paging everything.",
  ptable([
    ["limit", "integer 1–100 · default 50", "Max assets per call"],
    ["offset", "integer · default 0", "Pagination offset"],
    ["status", "string · optional", "Active | Staged | PreInstallation | Suspended"],
    ["waterSystemId / waterSystemName", "optional", "Scope to a specific water system"],
    ["organisationId / organisationName", "optional", "Scope to an organisation"],
    ["countryId / countryName", "optional", "Scope to a country"],
  ])
)}

${tool("get_asset",
  "Full details for one asset by numeric ID: name, type (purpose), status, GPS coordinates, water system name, country name. Always call this after <code>get_tag</code> using <code>primary_asset_id</code> — never guess the water system or country.",
  ptable([
    ["assetId", "integer · required", "Numeric asset ID from list_assets or get_tag.primary_asset_id"],
  ])
)}

<h2>Asset Telemetry &amp; Analysis Tools</h2>

${tool("get_asset_history",
  "Returns time-series history: tank height (water &amp; chlorine), daily inflow, battery voltage, flow-rate history, and dispense volume histogram + KDE curve. Each series is independently paginated. Best for trend questions ('was the tank stable last week?').",
  ptable([
    ["assetId", "string · required", "Numeric asset ID"],
    ["days", "integer 1–180 · default 7", "Days of history to return"],
    ["limit", "integer 1–2000 · default 500", "Max entries per time-series"],
    ["offset", "integer · default 0", "Entries to skip per time-series (for paging)"],
  ])
)}

${tool("get_asset_ewc_settings",
  "Returns the EWC device configuration from <code>/api/Asset/GetSettingsMapForAsset</code>: LCF (litres per flow tick), FCF (ticks per credit), preload, price per litre, FX, and all other device parameters. Use for pricing, calibration, and configuration questions.",
  ptable([
    ["assetId", "string · required", "Numeric asset ID"],
  ])
)}

${tool("get_asset_flow_rate",
  "Returns the most recent dispense flow rate in L/min from the last 24 hours of EWC packet logs. <code>timedOut: true</code> = no dispense recorded — check for blockage or device offline.",
  ptable([
    ["assetId", "string · required", "Numeric asset ID"],
  ])
)}

${tool("get_calibration_analysis",
  "Runs an NRW / meter-drift analysis: compares the configured LCF against measured dispense events (via dispense volume KDE), and compares the preload setting against 'no credit' packet data. Returns LCF gap %, preload gap, and a plain-language interpretation. Use when asked about NRW, meter drift, revenue loss, or whether LCF/preload settings are correct.",
  ptable([
    ["assetId", "string · required", "Numeric asset ID"],
    ["days", "integer 1–180 · default 30", "Days of dispense history to analyse"],
  ])
)}

<h2>Tag &amp; Household Tools</h2>

${tool("get_tag",
  "Primary entry point for any tag lookup. Returns <code>primary_asset_id</code>, <code>household_id</code>, credit balance, disbursement/top-up counts, sign-up date, last usage date, and status flags (deleted, blacklisted). Always call this first when a tag ID appears in the conversation. Follow up with <code>get_asset(primary_asset_id)</code> and <code>get_household(household_id)</code>.",
  ptable([
    ["nfcId", "string · required", "8-character hex tag ID, e.g. DBDA4ED2 — case-insensitive"],
  ])
)}

${tool("get_tag_info",
  "Alias for <code>get_tag</code> — prefer <code>get_tag</code> for new calls.",
  ptable([["nfcId", "string · required", "NFC tag ID"]])
)}

${tool("list_registered_tags",
  "All fully-registered NFC tag IDs for a water system (registered = has a household record + sign-up complete). <code>totalCount</code> gives the fleet size for 'how many registered users?' questions in a single call.",
  ptable([
    ["waterSystemId", "integer · required", "Water system ID from list_water_systems"],
    ["limit", "integer 1–500 · default 100", "Max tag IDs per call"],
    ["offset", "integer · default 0", "Pagination offset"],
  ])
)}

${tool("get_household",
  "Returns the household name and registration details for a given UUID. The <code>householdId</code> comes from <code>get_tag.household_id</code>. Never guess the household name — always call this when you have a <code>household_id</code>. Phone number and address are omitted by eWater per data-protection policy.",
  ptable([
    ["householdId", "UUID string · required", "household_id from get_tag"],
  ])
)}

${tool("get_household_info",
  "Alias for <code>get_household</code> — prefer <code>get_household</code> for new calls.",
  ptable([["householdId", "UUID string · required", "household_id from get_tag"]])
)}

${tool("get_tag_usage",
  "Returns individual dispense events for an NFC tag by scanning the EWC packet log of the tag's primary asset. Events include: timestamp, litres dispensed (flowTicks ÷ LCF), creditConsumed, eventType (Dispense | No Credit), flowTicks, flowTimeSecs. Use to verify household activity, debug credit deductions, or compute per-tag consumption over a period.",
  ptable([
    ["nfcId", "string · required", "NFC tag ID"],
    ["days", "integer 1–90 · default 30", "Days back to scan"],
    ["offset", "integer · default 0", "Pagination offset"],
    ["limit", "integer 1–200 · default 50", "Max events to return"],
  ])
)}

<h2>Disbursement Tools</h2>
<p>These tools call the eWater Usage API for per-day aggregated totals. Each day bucket contains: <code>date</code>, <code>estimateTotalLitres</code>, <code>totalTicks</code>, <code>totalSeconds</code>, <code>totalCredits</code> (null = no-credit/free event), <code>readingCount</code>. Period-level <code>totalLitres</code> and <code>totalReadings</code> are also returned.</p>

${tool("get_disbursements_by_tag_and_asset",
  "Per-day aggregated water use for one NFC tag at one specific tap. Best for: 'how much water did household X collect from tap Y this month?'",
  ptable([
    ["nfcId", "string · required", "NFC tag ID"],
    ["assetId", "string or integer · required", "Asset ID of the dispenser/tap"],
    ["days", "integer 1–365 · default 30", "Days to look back"],
  ])
)}

${tool("get_disbursements_by_tag",
  "Per-day totals for one NFC tag across all taps. Usage from multiple taps on the same day is summed into one bucket. Best for: 'how much water has household X used in total this month?'",
  ptable([
    ["nfcId", "string · required", "NFC tag ID"],
    ["days", "integer 1–365 · default 30", "Days to look back"],
  ])
)}

${tool("get_disbursements_by_asset",
  "Per-day totals from one tap across all NFC tags. Best for: 'how much water was dispensed from tap X this month?' or 'how many dispenses at this tap today?'",
  ptable([
    ["assetId", "string or integer · required", "Asset ID"],
    ["days", "integer 1–365 · default 30", "Days to look back"],
  ])
)}

<h2>Log Tools</h2>

${tool("get_asset_logs",
  `Fully-decoded device communication logs for one asset, newest first. <strong>Critical distinction:</strong> the <code>pipeline</code> field identifies direction — <code>MQTT</code>/<code>UDP</code> = incoming telemetry from the device; <code>CmdApi</code> = outgoing command (NOT data received). If all recent entries are CmdApi, the device is offline.
  <br/><br/>Decoded fields (kind=<code>ewc-datalog</code>): <code>eventName</code> · <code>eventCategory</code> (dispense/status/error/warning/startup) · <code>batteryVolts</code> · <code>flowTicks</code> · <code>litres</code> · <code>flowTimeSecs</code> · <code>tagUid</code> · <code>vsen1Adc/vsen2Adc/vsen3Adc</code> (eSENSE ADC readings, or NFC UID bytes on standard assets) · <code>usageCounter</code> · <code>datalogPointer</code>.
  <br/>Shengda NB-IoT (kind=<code>shengda-nbiot</code>): <code>description</code> plain-language summary · <code>meterReading</code> · <code>prepayLitres</code> · <code>supplyVoltage</code> · <code>batteryState</code> · <code>errorCode</code>.`,
  ptable([
    ["assetId", "string · required", "Numeric asset ID"],
    ["days", "integer 1–30 · default 7", "Days of logs to fetch"],
    ["limit", "integer 1–100 · default 25", "Max entries — keep 10–25 for WhatsApp"],
    ["before", "ISO timestamp · optional", "Cursor: return only entries before this timestamp (use last entry's timestamp to page)"],
    ["protocol", "string · optional", "Include only: Ewc2_5 | CommandApi_1 | 4CCv1 | Gadwall"],
    ["excludeProtocols", "string[] · optional", "Protocols to exclude, e.g. [&quot;4CCv1&quot;]"],
  ])
)}
`;

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>eWater Monitor — API Reference</title>
<style>${CSS}</style>
</head>
<body>${CONTENT}</body>
</html>`;

  writeFileSync(HTML_PATH, html, "utf-8");
  console.log(`HTML → ${HTML_PATH}`);

  const browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.goto(`file://${HTML_PATH}`, { waitUntil: "networkidle0" });
  await page.pdf({
    path: PDF_PATH,
    format: "A4",
    printBackground: true,
    margin: { top: "0", bottom: "0", left: "0", right: "0" },
  });
  await browser.close();
  console.log(`PDF  → ${PDF_PATH}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
