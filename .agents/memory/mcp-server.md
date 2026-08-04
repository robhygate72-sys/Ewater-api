---
name: MCP server — tools exposed by this app
description: The MCP endpoint this app exposes and the full list of tools registered on it.
---

## Endpoint

`POST|GET|DELETE /api/mcp` — Streamable HTTP, bearer-token auth (`Authorization: Bearer <MCP_BEARER_TOKEN>`).
Stateless: fresh `McpServer` + `StreamableHTTPServerTransport` per request (no session state).
All tools delegate to `lib/ewater-insights.ts` — no eWater logic lives in the MCP layer.

## Tools

### Hierarchy drill-down
- **list_countries** — all countries with org/system/asset counts
- **list_organisations** — organisations; filter by countryId/countryName
- **list_water_systems** — water systems; filter by organisationId/Name, countryId/Name

### Assets
- **list_assets** — paginated asset list (max 100/call); filter by status, waterSystemId/Name, organisationId/Name, countryId/Name
- **get_asset** — full details for one asset by numeric assetId
- **get_asset_history** — time-series: tankHeight, dailyInflow, voltageHistory, flowRateHistory, dispenseVolumes; params: assetId, days (1–180), limit, offset
- **get_asset_ewc_settings** — device config: LCF, FCF, preloadCharge, pricePerLitre, etc.
- **get_asset_flow_rate** — most-recent flow rate (L/min) from last 24 h of logs
- **get_calibration_analysis** — NRW/LCF gap analysis; params: assetId, days (1–180, default 30)

### Tags / households
- **list_registered_tags** — all registered NFC tag IDs for a waterSystemId; paginated
- **get_tag** — tag lookup by 8-char hex nfcId → primary_asset_id, household_id, credit balance, dispense/top-up counts, status flags
- **get_tag_info** — alias for get_tag (kept for back-compat)
- **get_household** — household name + details by householdId UUID (from get_tag)
- **get_household_info** — alias for get_household (kept for back-compat)
- **get_tag_usage** — dispense events for a tag; params: nfcId, days (1–90), offset, limit

### Logs
- **get_asset_logs** — decoded device packets most-recent-first; params: assetId, days (1–30), limit (1–100), before (ISO cursor), protocol, excludeProtocols
  - Decoded kinds: `ewc-datalog` (EWC 2.5 telemetry), `ewc-reply` (device reply to command), `cmdapi` (outgoing command record), `shengda-nbiot` (NB-IoT CBOR frame)

### Disbursements (aggregated daily totals from eWater usage API)
- **get_disbursements_by_tag_and_asset** — daily totals for one tag at one asset; params: nfcId, assetId, days (1–365)
- **get_disbursements_by_tag** — daily totals for one tag across all assets; params: nfcId, days (1–365)
- **get_disbursements_by_asset** — daily totals for one asset across all tags; params: assetId, days (1–365)

## Auth pattern

Bearer check against `process.env.MCP_BEARER_TOKEN`. Returns JSON-RPC formatted 401 (`{jsonrpc:"2.0", error:{code:-32001,...}, id:null}`) on failure — not a plain HTTP body.
