/**
 * Generates a PDF reference document covering:
 *  - eWater Monitor REST API endpoints (base path /api)
 *  - Remote MCP server tools (/api/mcp)
 *
 * Run with: pnpm --filter @workspace/scripts tsx ./src/generate-api-reference-pdf.ts
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
    font-size: 21pt;
    color: #0b3d5c;
    border-bottom: 3px solid #0b7285;
    padding-bottom: 10px;
    margin-top: 0;
  }
  h1.page-break { page-break-before: always; margin-top: 0; }
  h2 {
    font-size: 14pt;
    color: #0b3d5c;
    margin-top: 30px;
    border-bottom: 1px solid #cdd7dd;
    padding-bottom: 4px;
    page-break-after: avoid;
  }
  h3 {
    font-size: 11.5pt;
    color: #0b5c7a;
    margin-top: 22px;
    page-break-after: avoid;
  }
  h4 { font-size: 10.5pt; color: #333; margin-top: 14px; page-break-after: avoid; }
  p, li { font-size: 10pt; }
  code {
    background: #f1f4f6;
    border-radius: 3px;
    padding: 1px 5px;
    font-family: "SF Mono", Consolas, Menlo, monospace;
    font-size: 9pt;
    color: #a4262c;
  }
  pre {
    background: #0d2d40;
    color: #d6eaf5;
    padding: 12px 16px;
    border-radius: 6px;
    overflow-x: auto;
    font-size: 8.5pt;
    page-break-inside: avoid;
    white-space: pre-wrap;
    word-break: break-word;
    margin: 8px 0;
  }
  pre code { background: none; color: inherit; padding: 0; font-size: 8.5pt; }
  table {
    border-collapse: collapse;
    width: 100%;
    margin: 12px 0;
    font-size: 9pt;
    page-break-inside: avoid;
  }
  th, td {
    border: 1px solid #cdd7dd;
    padding: 5px 9px;
    text-align: left;
    vertical-align: top;
  }
  th { background: #eaf3f6; color: #0b3d5c; font-size: 9pt; }
  blockquote {
    border-left: 4px solid #0b7285;
    margin: 8px 0;
    padding: 4px 16px;
    color: #444;
    background: #f7fafb;
  }
  hr { border: none; border-top: 1px solid #cdd7dd; margin: 22px 0; }
  a { color: #0b7285; }
  strong { color: #12222e; }
  .endpoint-block {
    background: #f7fafb;
    border: 1px solid #cdd7dd;
    border-radius: 6px;
    padding: 12px 14px;
    margin: 14px 0;
    page-break-inside: avoid;
  }
  .method-get    { background:#1a7a4a; color:#fff; padding:2px 7px; border-radius:3px; font-size:8.5pt; font-weight:bold; font-family:monospace; }
  .method-post   { background:#0b5c9a; color:#fff; padding:2px 7px; border-radius:3px; font-size:8.5pt; font-weight:bold; font-family:monospace; }
  .method-delete { background:#8b2020; color:#fff; padding:2px 7px; border-radius:3px; font-size:8.5pt; font-weight:bold; font-family:monospace; }
  .tool-block {
    background: #f2f8fc;
    border: 1px solid #b8d8e8;
    border-radius: 6px;
    padding: 12px 14px;
    margin: 14px 0;
    page-break-inside: avoid;
  }
  .tool-name { font-family: "SF Mono", Consolas, Menlo, monospace; font-size: 9.5pt; color: #0b3d5c; font-weight: bold; }
  .cover {
    height: 100vh;
    display: flex;
    flex-direction: column;
    justify-content: center;
    page-break-after: always;
  }
  .cover-title { font-size: 28pt; color: #0b3d5c; font-weight: 700; margin-bottom: 6px; border: none; }
  .cover-sub { font-size: 13pt; color: #0b7285; margin-bottom: 40px; }
  .cover-meta { font-size: 10pt; color: #555; line-height: 2; }
  .toc-entry { display: flex; justify-content: space-between; padding: 2px 0; font-size: 10pt; }
  .toc-entry a { color: #0b3d5c; text-decoration: none; }
  .toc-dot { flex: 1; border-bottom: 1px dotted #aaa; margin: 0 6px; position: relative; top: -3px; }
  .section-label {
    display: inline-block;
    font-size: 8pt;
    background: #0b7285;
    color: #fff;
    border-radius: 3px;
    padding: 1px 7px;
    margin-right: 6px;
    vertical-align: middle;
  }
`;

// ---------------------------------------------------------------------------
// Document content as HTML string
// ---------------------------------------------------------------------------
const DATE = new Date().toLocaleDateString("en-GB", {
  day: "2-digit", month: "long", year: "numeric",
});

function method(m: string) {
  const cls: Record<string, string> = {
    GET: "method-get", POST: "method-post", DELETE: "method-delete",
  };
  return `<span class="${cls[m] ?? "method-get"}">${m}</span>`;
}

function endpoint(
  verb: string,
  p: string,
  summary: string,
  details: string,
) {
  return `
<div class="endpoint-block">
  <p style="margin:0 0 6px 0">${method(verb)} <code>/api${p}</code></p>
  <p style="margin:0 0 4px 0"><strong>${summary}</strong></p>
  ${details}
</div>`;
}

function tool(name: string, inputsHtml: string, description: string) {
  return `
<div class="tool-block">
  <p style="margin:0 0 6px 0"><span class="tool-name">${name}</span></p>
  <p style="margin:0 0 6px 0">${description}</p>
  ${inputsHtml ? `<p style="margin:4px 0 2px 0"><strong>Inputs:</strong></p>${inputsHtml}` : ""}
</div>`;
}

function params(rows: [string, string, string, string][]) {
  const header = `<tr><th>Name</th><th>In / Type</th><th>Required</th><th>Description</th></tr>`;
  const body = rows.map(([n, t, req, d]) =>
    `<tr><td><code>${n}</code></td><td>${t}</td><td>${req}</td><td>${d}</td></tr>`
  ).join("");
  return `<table>${header}${body}</table>`;
}

const CONTENT = `
<div class="cover">
  <h1 class="cover-title" style="border:none">eWater Monitor</h1>
  <div class="cover-sub">REST API &amp; MCP Server Reference</div>
  <div class="cover-meta">
    Base URL: <code>/api</code> (REST) &nbsp;·&nbsp; <code>/api/mcp</code> (MCP)<br/>
    Auth: eWater credentials via <code>POST /api/ewater/credentials</code><br/>
    MCP auth: <code>Authorization: Bearer &lt;MCP_BEARER_TOKEN&gt;</code><br/>
    Generated: ${DATE}
  </div>
</div>

<h1>Contents</h1>
<div style="margin:16px 0">
  <div class="toc-entry"><a>Part 1 — REST API</a><span class="toc-dot"></span></div>
  <div class="toc-entry" style="padding-left:16px"><a>&nbsp;&nbsp;Credentials</a><span class="toc-dot"></span></div>
  <div class="toc-entry" style="padding-left:16px"><a>&nbsp;&nbsp;Assets</a><span class="toc-dot"></span></div>
  <div class="toc-entry" style="padding-left:16px"><a>&nbsp;&nbsp;Tags &amp; Households</a><span class="toc-dot"></span></div>
  <div class="toc-entry" style="padding-left:16px"><a>&nbsp;&nbsp;Disbursements</a><span class="toc-dot"></span></div>
  <div class="toc-entry" style="padding-left:16px"><a>&nbsp;&nbsp;Calibration</a><span class="toc-dot"></span></div>
  <div class="toc-entry" style="padding-left:16px"><a>&nbsp;&nbsp;Dashboard &amp; Utilities</a><span class="toc-dot"></span></div>
  <div class="toc-entry" style="margin-top:6px"><a>Part 2 — MCP Server</a><span class="toc-dot"></span></div>
  <div class="toc-entry" style="padding-left:16px"><a>&nbsp;&nbsp;Overview &amp; Auth</a><span class="toc-dot"></span></div>
  <div class="toc-entry" style="padding-left:16px"><a>&nbsp;&nbsp;Hierarchy Tools</a><span class="toc-dot"></span></div>
  <div class="toc-entry" style="padding-left:16px"><a>&nbsp;&nbsp;Asset Tools</a><span class="toc-dot"></span></div>
  <div class="toc-entry" style="padding-left:16px"><a>&nbsp;&nbsp;Tag &amp; Household Tools</a><span class="toc-dot"></span></div>
  <div class="toc-entry" style="padding-left:16px"><a>&nbsp;&nbsp;Disbursement Tools</a><span class="toc-dot"></span></div>
  <div class="toc-entry" style="padding-left:16px"><a>&nbsp;&nbsp;Log Tools</a><span class="toc-dot"></span></div>
  <div class="toc-entry" style="margin-top:6px"><a>Appendix — Pagination Envelope &amp; Errors</a><span class="toc-dot"></span></div>
</div>

<!-- ======================================================= -->
<h1 class="page-break"><span class="section-label">PART 1</span> REST API</h1>

<p>All REST endpoints are served under the base path <code>/api</code> and communicate in JSON.
Most endpoints require eWater credentials to be configured first (see Credentials below).
Unauthenticated requests receive <code>401 { "error": "No credentials configured" }</code>.
Upstream eWater API errors are proxied back as <code>502 { "error": "eWater API error: …" }</code>.</p>

<!-- ─── Credentials ─── -->
<h2>Credentials</h2>

${endpoint("GET", "/ewater/credentials", "Check credential status",
  `<p>Returns whether eWater credentials are configured and when the session token expires.</p>
  <pre>{ "isConfigured": true, "environment": "live", "tokenExpiresAt": "2026-08-04T16:00:00Z" }</pre>`
)}

${endpoint("POST", "/ewater/credentials", "Save eWater credentials",
  `<p>Stores credentials and validates them by obtaining a session token immediately. Returns <code>401</code> when credentials are invalid.</p>
  <p><strong>Body:</strong> <code>{ "username": "user@example.com", "password": "…" }</code></p>`
)}

${endpoint("DELETE", "/ewater/credentials", "Clear saved credentials",
  `<p>Removes stored credentials and invalidates the session. Subsequent API calls return <code>401</code>.</p>`
)}

<!-- ─── Assets ─── -->
<h2>Assets</h2>

${endpoint("GET", "/ewater/assets", "List all assets",
  `<p>Returns every asset (community taps, controllers, eSENSE sensors) visible to this account.
  Fields: <code>id</code>, <code>name</code>, <code>type</code>, <code>status</code>,
  <code>isOnline</code>, <code>batteryVoltage</code>, <code>waterSystemName</code>, <code>countryName</code>.</p>`
)}

${endpoint("GET", "/ewater/assets/:assetId", "Get asset details",
  `<p>Full detail for one asset: basic info, health status, connectivity, and power — fetched in parallel from the eWater State and Query APIs.</p>
  ${params([
    ["assetId", "path · string", "required", "Numeric asset ID"]
  ])}`
)}

${endpoint("GET", "/ewater/assets/:assetId/tech", "Comprehensive technical status bundle",
  `<p>Aggregates all technical data for one asset in a single call (12 upstream requests in parallel): connectivity, power, flow, usage, status values, firmware, identifiers, recent commands, EWC settings, and entity hierarchy for water system / country resolution. Primary endpoint used by the asset detail page.</p>
  <p><strong>Key fields:</strong> <code>lastCommsDt</code>, <code>batteryVoltage / batteryTrend / batteryTodayHigh / batteryTodayLow</code>,
  <code>flowRateHour / flowRateToday / flowRateWeek</code>,
  <code>litresDispensedToday</code>, <code>imeis[]</code>, <code>firmware[]</code>,
  <code>healthFlags</code>, <code>tamperSwitchState</code>, <code>ewcFcf / ewcLcf / ewcFx / ewcPreload / priceOfWater</code>.</p>`
)}

${endpoint("GET", "/ewater/assets/:assetId/ewc", "EWC calibration settings",
  `<p>Returns the Electronic Water Controller device configuration: FCF, LCF (ticks per litre — the calibration factor), currency/FX, preload, price per litre, and all other EWC parameters.</p>`
)}

${endpoint("GET", "/ewater/assets/:assetId/esense-charts", "eSENSE time-series charts",
  `<p>Chart data for eSENSE tank-level assets over a configurable window.</p>
  ${params([
    ["assetId", "path · string", "required", "Numeric asset ID"],
    ["days", "query · integer", "optional (default 3)", "Days to look back"]
  ])}
  <p><strong>Response includes:</strong> <code>tankHeight[]</code> (water &amp; chlorine depth with min/max bands),
  <code>dailyInflow[]</code> (litres per day), <code>voltageHistory[]</code>,
  <code>voltageStatus</code>, <code>flowRateHistory[]</code> (per-dispense L/min),
  <code>dispenseVolumes</code> (histogram + KDE curve + suggested LCF calibration model).</p>`
)}

${endpoint("GET", "/ewater/assets/:assetId/meter-reading", "Tick accumulator meter reading",
  `<p>Extracts the lifetime tick accumulator from the most recent <code>HEALTH_STATE</code> (0x19) EWC packet in the last 14 days and converts it to litres using the asset's LCF.</p>
  <p><strong>Response:</strong> <code>{ ticks, lcf, litres, timestamp, found }</code>.
  <code>found: false</code> = no HEALTH_STATE packet received recently.</p>`
)}

${endpoint("GET", "/ewater/assets/:assetId/flow-rate", "Most recent flow rate",
  `<p>Most recent valid dispense flow rate (L/min) from EWC logs in the last 24 hours.</p>
  <p><strong>Response:</strong> <code>{ flowRate, timestamp, timedOut }</code>. <code>timedOut: true</code> = no dispense in 24 h.</p>`
)}

${endpoint("GET", "/ewater/assets/:assetId/telemetry", "Raw telemetry log",
  `<p>Last 50 raw telemetry entries for an asset (last 7 days), newest first. For fully decoded entries use <code>/logs</code>.</p>`
)}

${endpoint("GET", "/ewater/assets/:assetId/logs", "Decoded protocol logs (cursor paginated)",
  `<p>Decoded asset communication logs, newest first. EWC 2.5 and Shengda NB-IoT frames are decoded server-side. Shengda frames include a <code>shengda.description</code> human-readable summary.</p>
  ${params([
    ["assetId", "path · string", "required", "Numeric asset ID"],
    ["before", "query · ISO timestamp", "optional", "Return only entries before this time — use last entry's timestamp to page"],
    ["protocol", "query · string", "optional", "Filter: Ewc2_5 | CommandApi_1 | 4CCv1 | Gadwall"],
    ["limit", "query · integer 1–100", "optional (default 50)", "Max entries per call"],
    ["windowDays", "query · integer 1–30", "optional (default 7)", "How many days back to scan"]
  ])}
  <p><strong>Response:</strong> <code>{ entries[], nextBefore, hasMore }</code>. Pass <code>nextBefore</code> as <code>before</code> to page forward.</p>`
)}

${endpoint("GET", "/ewater/assets/:assetId/packets", "Raw NB-IoT packet logs",
  `<p>Decoded Shengda NB-IoT CBOR/LwM2M packet logs, merged across all IMEIs registered to the asset (including secondary devices not in the identifier registry).</p>
  ${params([
    ["assetId", "path · string", "required", "Numeric asset ID"],
    ["hours", "query · integer 1–72", "optional (default 24)", "How many hours back"],
    ["limit", "query · integer 1–100", "optional (default 50)", "Max packets"],
    ["imei", "query · string", "optional", "Restrict to a single IMEI"]
  ])}`
)}

<!-- ─── Tags & Households ─── -->
<h2>Tags &amp; Households</h2>

${endpoint("GET", "/ewater/tags", "List registered NFC tags for a water system",
  `<p>Paginated list of NFC tag IDs that have completed registration in the given water system.</p>
  ${params([
    ["waterSystemId", "query · integer", "required", "Water system ID from /ewater/entities"],
    ["offset", "query · integer", "optional (default 0)", "Pagination offset"],
    ["limit", "query · integer 1–500", "optional (default 100)", "Max tag IDs to return"]
  ])}
  <p><strong>Response:</strong> pagination envelope with <code>tagIds[]</code>. <code>totalCount</code> = full registered fleet size.</p>`
)}

${endpoint("GET", "/ewater/tags/:nfcId", "Get tag info and household",
  `<p>Registration details for an NFC tag plus the linked household record.</p>
  ${params([
    ["nfcId", "path · string", "required", "8-character hex tag ID (e.g. A7370000) — case-insensitive"]
  ])}
  <p><strong>Response:</strong> <code>{ tag: { primaryAssetId, householdId, creditBalance, disbursementCount, topUpCount, signUpDate, lastUsageDate, deleted, blacklisted }, household }</code>.</p>`
)}

${endpoint("GET", "/ewater/tags/:nfcId/usage", "Tag dispense event history",
  `<p>Individual dispense events for an NFC tag from the EWC packet log of the tag's primary asset.</p>
  ${params([
    ["nfcId", "path · string", "required", "NFC tag ID"],
    ["days", "query · integer 1–90", "optional (default 30)", "Days back to scan"],
    ["offset", "query · integer", "optional (default 0)", "Pagination offset"],
    ["limit", "query · integer 1–200", "optional (default 100)", "Max events"]
  ])}
  <p>Event fields: <code>timestamp</code>, <code>litres</code>, <code>creditConsumed</code>, <code>eventType</code> (Dispense | No Credit).</p>`
)}

${endpoint("GET", "/ewater/households/:householdId", "Get household",
  `<p>Household name and registration details by UUID (from <code>tag.householdId</code>). Phone number and address are omitted per eWater data-protection policy.</p>`
)}

<!-- ─── Disbursements ─── -->
<h2>Disbursements (Usage API)</h2>
<p>Per-day aggregated dispense totals from the eWater Usage API. Each day bucket includes:
<code>date</code>, <code>estimateTotalLitres</code>, <code>totalTicks</code>, <code>totalSeconds</code>,
<code>totalCredits</code> (null = no-credit event), <code>readingCount</code>.
Period-level summaries <code>totalLitres</code> and <code>totalReadings</code> are also returned at the top level.</p>

${endpoint("GET", "/ewater/tags/:nfcId/disbursements", "Tag disbursements",
  `<p>Per-day totals for one NFC tag. If <code>assetId</code> is supplied, scoped to that tap only; otherwise aggregated across all taps.</p>
  ${params([
    ["nfcId", "path · string", "required", "NFC tag ID"],
    ["days", "query · integer 1–365", "optional (default 30)", "Days to look back"],
    ["assetId", "query · string", "optional", "Scope to a specific asset"]
  ])}`
)}

${endpoint("GET", "/ewater/assets/:assetId/disbursements", "Asset disbursements",
  `<p>Per-day totals from one tap across all NFC tags.</p>
  ${params([
    ["assetId", "path · string", "required", "Numeric asset ID"],
    ["days", "query · integer 1–365", "optional (default 30)", "Days to look back"]
  ])}`
)}

<!-- ─── Calibration ─── -->
<h2>Calibration</h2>

${endpoint("POST", "/ewater/assets/:assetId/detect-sensor-range", "Auto-detect eSENSE sensor range",
  `<p>Correlates recent VSEN ADC readings from EWC packets with the eWater tank-height API to back-calculate the sensor's full-scale range in metres. Persists the result for use by alert rules.</p>
  <p><strong>Response:</strong> <code>{ sensorRangeMetres1, sensorRangeMetres2, sensorRangeMetres3, vsen1, vsen2, vsen3, depthMetres1, timeDeltaSeconds }</code>.
  Returns <code>422</code> when no sensor data is available.</p>`
)}

${endpoint("POST", "/ewater/assets/:assetId/apply-calibration", "Write LCF + Preload to device",
  `<p>Sends <code>RequestSettingChange</code> to the eWater Command API for both <code>LitresConversion</code> and <code>Preload</code>. The device applies changes on its next comms cycle.</p>
  <p><strong>Body:</strong> <code>{ "lcf": 512, "preload": 0 }</code> — both integers.</p>
  <p><strong>Response:</strong> <code>{ success, results: [{ settingKey, success, error }] }</code>.</p>`
)}

${endpoint("POST", "/ewater/assets/:assetId/reset-meter", "Reset tick accumulator",
  `<p>Sends <code>ResetTickAccumulator</code> to the eWater Command API. IMEI is resolved automatically.</p>
  <p><strong>Body:</strong> <code>{ "litres": 15420.5 }</code> &nbsp; <strong>Response:</strong> <code>{ litres, success, error }</code>.</p>`
)}

<!-- ─── Dashboard & Utilities ─── -->
<h2>Dashboard &amp; Utilities</h2>

${endpoint("GET", "/ewater/dashboard", "System health dashboard",
  `<p>Aggregated health snapshot: online/offline/fault counts, power and flow fault tallies, recent system-level alerts.</p>
  ${params([
    ["lifecycleState", "query · string", "optional (default Active)", "PreInstallation | Staged | Active"]
  ])}
  <p><strong>Response:</strong> <code>{ totalAssets, onlineCount, offlineCount, faultCount, powerFaultCount, flowFaultCount, lastUpdated, recentAlerts[] }</code>.</p>`
)}

${endpoint("GET", "/ewater/entities", "Entity hierarchy",
  `<p>Country → Organisation → Water System hierarchy with asset counts per water system.</p>`
)}

${endpoint("POST", "/ewater/proxy", "Generic eWater API proxy",
  `<p>Forwards an arbitrary request to any eWater upstream endpoint. For debugging and ad-hoc exploration.</p>
  <p><strong>Body:</strong> <code>{ "api": "state|query|command|auth", "path": "/api/…", "method": "GET|POST", "body": {…} }</code></p>`
)}

${endpoint("GET", "/healthz", "Health check",
  `<p>Returns <code>{ "status": "ok" }</code>. No authentication required.</p>`
)}

<!-- ======================================================= -->
<h1 class="page-break"><span class="section-label">PART 2</span> MCP Server</h1>

<h2>Overview &amp; Authentication</h2>
<p>The MCP server is exposed at <code>POST/GET/DELETE /api/mcp</code> using the
<strong>Streamable HTTP</strong> transport (JSON-RPC 2.0). It provides the same data as the REST API
as callable tools designed for LLM clients (Claude, GPT-4, WhatsApp AI agents, etc.).
The server is <strong>stateless</strong> — a fresh server + transport is created per request.</p>

<h3>Authentication</h3>
<pre>Authorization: Bearer &lt;MCP_BEARER_TOKEN&gt;</pre>
<p>This is separate from the eWater credentials. Both must be configured: the bearer token protects the
MCP endpoint itself; the eWater credentials (set via the REST API) are used by the tool implementations to reach live data.</p>

<h3>Pagination Envelope</h3>
<p>Every tool response uses the same envelope:</p>
<pre>{
  "totalCount": 142,      // true total across all pages
  "returnedCount": 25,    // records in this response
  "offset": 0,
  "limit": 25,
  "hasMore": true,
  "items": [ … ]          // or named array: "assets", "tagIds", etc.
}</pre>
<p>Single-object tools (<code>get_asset_ewc_settings</code>, <code>get_asset_flow_rate</code>, <code>get_calibration_analysis</code>)
return their result under <code>data</code> with <code>totalCount: 1</code>, <code>hasMore: false</code>.</p>

<h3>Typical Call Chain</h3>
<pre>get_tag(nfcId)
  → get_asset(primary_asset_id)                          // tap name, water system, country
  → get_household(household_id)                          // household name
  → get_disbursements_by_tag_and_asset(nfcId, assetId)   // water usage this month
  → get_asset_logs(assetId)                              // recent device activity</pre>

<!-- ─── Hierarchy Tools ─── -->
<h2>Hierarchy Tools</h2>

${tool("list_countries", "", "Lists all countries with organisation, water system, and asset counts. No inputs required. Always <code>hasMore: false</code>.")}

${tool("list_organisations",
  params([
    ["countryId", "integer", "optional", "Filter by country ID"],
    ["countryName", "string", "optional", "Filter by exact country name"]
  ]),
  "Lists organisations with water system and asset counts, optionally filtered by country."
)}

${tool("list_water_systems",
  params([
    ["organisationId", "integer", "optional", "Filter by organisation ID"],
    ["organisationName", "string", "optional", "Filter by exact organisation name"],
    ["countryId", "integer", "optional", "Filter by country ID"],
    ["countryName", "string", "optional", "Filter by exact country name"]
  ]),
  "Lists water systems with asset counts. Pass the returned ID into <code>list_assets</code> or <code>list_registered_tags</code>."
)}

${tool("list_assets",
  params([
    ["limit", "integer 1–100", "optional (default 50)", "Max assets per call"],
    ["offset", "integer", "optional (default 0)", "Pagination offset"],
    ["status", "string", "optional", "Active | Staged | PreInstallation | Suspended"],
    ["waterSystemId / waterSystemName", "integer / string", "optional", "Scope to a water system"],
    ["organisationId / organisationName", "integer / string", "optional", "Scope to an organisation"],
    ["countryId / countryName", "integer / string", "optional", "Scope to a country"]
  ]),
  "Paginated asset list. <code>totalCount</code> answers 'how many?' in a single call without paging everything."
)}

${tool("get_asset",
  params([["assetId", "integer", "required", "From list_assets or get_tag.primary_asset_id"]]),
  "Full details for one asset: name, type, status, GPS, water system, country. Always call this after <code>get_tag</code> to resolve asset details — never guess."
)}

<!-- ─── Asset Tools ─── -->
<h2>Asset Telemetry &amp; Analysis Tools</h2>

${tool("get_asset_history",
  params([
    ["assetId", "string", "required", "Numeric asset ID"],
    ["days", "integer 1–180", "optional (default 7)", "Days of history"],
    ["limit", "integer 1–2000", "optional (default 500)", "Max entries per time-series"],
    ["offset", "integer", "optional (default 0)", "Entries to skip per time-series"]
  ]),
  "Time-series: tank height (water &amp; chlorine), daily inflow, battery voltage, flow-rate history, dispense volume histogram. Each series independently paginated. For trend questions: 'was the tank stable last week?'"
)}

${tool("get_asset_ewc_settings",
  params([["assetId", "string", "required", "Numeric asset ID"]]),
  "EWC device configuration: LCF (litres per tick — calibration factor), FCF (ticks per credit), preload charge, price per litre, currency/FX settings, and all other EWC device parameters."
)}

${tool("get_asset_flow_rate",
  params([["assetId", "string", "required", "Numeric asset ID"]]),
  "Most recent dispense flow rate in L/min from the last 24 hours. <code>timedOut: true</code> means no dispense recorded — check for blockage or closure."
)}

${tool("get_calibration_analysis",
  params([
    ["assetId", "string", "required", "Numeric asset ID"],
    ["days", "integer 1–180", "optional (default 30)", "Days of dispense history to analyse"]
  ]),
  "NRW / meter-drift analysis: compares the configured LCF against measured dispense events, and compares preload against 'no credit' packet data. Returns LCF gap %, preload gap, and a plain-language interpretation. Use for NRW, meter drift, revenue loss, or calibration accuracy questions."
)}

<!-- ─── Tag & Household Tools ─── -->
<h2>Tag &amp; Household Tools</h2>

${tool("get_tag",
  params([["nfcId", "string", "required", "8-character hex tag ID, e.g. DBDA4ED2 — case-insensitive"]]),
  "Primary entry point for any tag lookup. Returns <code>primary_asset_id</code>, <code>household_id</code>, credit balance, disbursement/top-up counts, dates, and status flags (deleted, blacklisted). Always call this first when a tag ID is mentioned."
)}

${tool("get_tag_info", params([["nfcId", "string", "required", "NFC tag ID"]]), "Alias for <code>get_tag</code> — prefer <code>get_tag</code> for new calls.")}

${tool("list_registered_tags",
  params([
    ["waterSystemId", "integer", "required", "From list_water_systems"],
    ["limit", "integer 1–500", "optional (default 100)", "Max tag IDs per call"],
    ["offset", "integer", "optional (default 0)", "Pagination offset"]
  ]),
  "All fully-registered NFC tag IDs for a water system. <code>totalCount</code> = registered user fleet size — answers 'how many registered users?' from a single call."
)}

${tool("get_household",
  params([["householdId", "string (UUID)", "required", "From get_tag.household_id"]]),
  "Household name and registration details. Never guess the name — always call this when you have a <code>household_id</code>. Phone number and address omitted per data-protection policy."
)}

${tool("get_household_info", params([["householdId", "string (UUID)", "required", "Household UUID"]]), "Alias for <code>get_household</code> — prefer <code>get_household</code> for new calls.")}

${tool("get_tag_usage",
  params([
    ["nfcId", "string", "required", "NFC tag ID"],
    ["days", "integer 1–90", "optional (default 30)", "Days to scan"],
    ["offset", "integer", "optional (default 0)", "Pagination offset"],
    ["limit", "integer 1–200", "optional (default 50)", "Max events"]
  ]),
  "Individual dispense events for an NFC tag from the asset's EWC packet log. Fields: timestamp, litres (ticks ÷ LCF), creditConsumed, eventType (Dispense | No Credit). Use to verify household activity or debug credit deductions."
)}

<!-- ─── Disbursement Tools ─── -->
<h2>Disbursement Tools</h2>
<p>Draw from the eWater Usage API (daily aggregated totals). Each day bucket: <code>estimateTotalLitres</code>,
<code>totalTicks</code>, <code>totalSeconds</code>, <code>totalCredits</code> (null = no-credit),
<code>readingCount</code>.</p>

${tool("get_disbursements_by_tag_and_asset",
  params([
    ["nfcId", "string", "required", "NFC tag ID"],
    ["assetId", "string or integer", "required", "Asset ID of the dispenser"],
    ["days", "integer 1–365", "optional (default 30)", "Days to look back"]
  ]),
  "Per-day aggregated water use for one tag at one specific tap. 'How much water did household X collect from tap Y this month?'"
)}

${tool("get_disbursements_by_tag",
  params([
    ["nfcId", "string", "required", "NFC tag ID"],
    ["days", "integer 1–365", "optional (default 30)", "Days to look back"]
  ]),
  "Per-day totals for one tag across ALL taps. Multiple-tap usage on the same day is summed into one bucket. 'Total household consumption across all visits.'"
)}

${tool("get_disbursements_by_asset",
  params([
    ["assetId", "string or integer", "required", "Asset ID"],
    ["days", "integer 1–365", "optional (default 30)", "Days to look back"]
  ]),
  "Per-day totals from one tap across ALL tags. 'How much water was dispensed from tap X this month?' / 'How many people collected water here today?'"
)}

<!-- ─── Log Tools ─── -->
<h2>Log Tools</h2>

${tool("get_asset_logs",
  params([
    ["assetId", "string", "required", "Numeric asset ID"],
    ["days", "integer 1–30", "optional (default 7)", "Days of logs to fetch"],
    ["limit", "integer 1–100", "optional (default 25)", "Max entries — use 10–25 for WhatsApp"],
    ["before", "ISO timestamp", "optional", "Cursor for pagination — timestamp of last entry from previous call"],
    ["protocol", "string", "optional", "Include only: Ewc2_5 | CommandApi_1 | 4CCv1 | Gadwall"],
    ["excludeProtocols", "string[]", "optional", "Protocols to exclude, e.g. [&quot;4CCv1&quot;]"]
  ]),
  `Fully-decoded device communication logs, newest first. <strong>Critical:</strong>
  the <code>pipeline</code> field identifies direction — <code>MQTT/UDP</code> = incoming telemetry from the device;
  <code>CmdApi</code> = outgoing command, NOT incoming data. If all visible entries are CmdApi, the device is offline.
  Decoded fields include <code>eventName</code>, <code>eventCategory</code>, <code>batteryVolts</code>,
  <code>flowTicks</code>, <code>litres</code>, <code>tagUid</code>, <code>vsen1-3</code> ADC (eSENSE),
  and more. Shengda NB-IoT frames include a plain-language <code>description</code> field.`
)}

<!-- ======================================================= -->
<h1 class="page-break"><span class="section-label">APPENDIX</span> Pagination Envelope &amp; Errors</h1>

<h2>Pagination Envelope</h2>
<p>Used by all MCP list tools and the tag-usage REST endpoint:</p>
<table>
  <tr><th>Field</th><th>Type</th><th>Description</th></tr>
  <tr><td><code>totalCount</code></td><td>integer</td><td>True total matching records across all pages — use this to answer count questions from a single call</td></tr>
  <tr><td><code>returnedCount</code></td><td>integer</td><td>Records returned in this response</td></tr>
  <tr><td><code>offset</code></td><td>integer</td><td>Records skipped before the first result</td></tr>
  <tr><td><code>limit</code></td><td>integer</td><td>Max records per call as requested</td></tr>
  <tr><td><code>hasMore</code></td><td>boolean</td><td>True when records exist beyond this page</td></tr>
  <tr><td><em>items / assets / tagIds…</em></td><td>array</td><td>The records for this page, under a semantically named key</td></tr>
</table>
<p>To iterate: increment <code>offset</code> by <code>limit</code> until <code>hasMore</code> is false.</p>

<h2>Error Responses</h2>
<table>
  <tr><th>HTTP Code</th><th>When</th><th>Body</th></tr>
  <tr><td><code>400</code></td><td>Invalid request body or parameters</td><td><code>{ "error": "…" }</code></td></tr>
  <tr><td><code>401</code></td><td>No credentials configured (REST) or invalid bearer token (MCP)</td><td><code>{ "error": "…" }</code></td></tr>
  <tr><td><code>404</code></td><td>Asset / tag / household not found</td><td><code>{ "error": "…" }</code></td></tr>
  <tr><td><code>422</code></td><td>Cannot compute result (e.g. no sensor data for range detection)</td><td><code>{ "error": "…" }</code></td></tr>
  <tr><td><code>502</code></td><td>eWater upstream API returned an error</td><td><code>{ "error": "eWater API error: …" }</code></td></tr>
</table>

<h2>Key Concepts</h2>
<table>
  <tr><th>Term</th><th>Definition</th></tr>
  <tr><td><strong>LCF</strong> (LitresConversion)</td><td>Ticks per litre — the primary calibration factor. Divide raw flow-meter ticks by the LCF to get litres. Stored in EWC settings.</td></tr>
  <tr><td><strong>FCF</strong> (FlowConversion)</td><td>Ticks per credit (prepay unit). Different from LCF. The packet trailer bytes[33–34] hold the FCF, not the LCF — always read LCF from EWC settings.</td></tr>
  <tr><td><strong>Preload</strong></td><td>Unmetered tick offset at valve-open — ticks dispensed before the meter starts counting. Must be subtracted when calculating true volume.</td></tr>
  <tr><td><strong>pipeline</strong></td><td>Communication direction in packet logs: MQTT/UDP = device → platform (incoming telemetry); CmdApi = platform → device (outgoing command).</td></tr>
  <tr><td><strong>VSEN1/2/3</strong></td><td>Analogue sensor ADC values (0–255) on eSENSE assets. ADC 51 ≈ 4 mA (sensor empty/off), ADC 255 ≈ 20 mA (sensor full). Convert to depth using sensor range from EWC settings.</td></tr>
  <tr><td><strong>NRW</strong></td><td>Non-Revenue Water — water dispensed that does not generate revenue, typically due to meter drift, miscalibrated LCF, or preload offset errors.</td></tr>
</table>
`;

// ---------------------------------------------------------------------------

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>eWater Monitor — REST API &amp; MCP Server Reference</title>
<style>${CSS}</style>
</head>
<body>
${CONTENT}
</body>
</html>`;

  writeFileSync(HTML_PATH, html, "utf-8");
  console.log(`HTML written to ${HTML_PATH}`);

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
  console.log(`PDF written to ${PDF_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
