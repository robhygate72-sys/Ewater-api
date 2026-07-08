# eWater Monitor

A monitoring dashboard and remote data API for eWater community water-dispenser assets, with a Model Context Protocol (MCP) server so external tools/LLMs can query asset data and calibration insights directly.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/ewater-app run dev` — run the web dashboard
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Required env: `MCP_BEARER_TOKEN` — shared-secret bearer token for the remote MCP server (see below)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Remote tool access: `@modelcontextprotocol/sdk` (Streamable HTTP MCP server)

## Where things live

- `artifacts/api-server/src/routes/ewater.ts` — REST API routes for eWater credentials, assets, telemetry, EWC settings, esense charts, calibration writes, logs.
- `artifacts/api-server/src/lib/ewater-client.ts` — eWater auth/session + low-level `ewaterFetch` used by both REST routes and the MCP server.
- `artifacts/api-server/src/lib/ewater-insights.ts` — shared eWater business logic (asset listing, EWC settings, flow rate, eSense chart aggregation, dispense-volume KDE calibration model, calibration/NRW gap analysis). Both the REST routes and the MCP tools call into this module — do not duplicate this logic elsewhere.
- `artifacts/api-server/src/lib/mcp-server.ts` — the remote MCP server (tool definitions + bearer-token auth), mounted at `/api/mcp`.
- `artifacts/api-server/src/app.ts` — Express app wiring; mounts `/api/mcp` before the general `/api` router.

## Architecture decisions

- eWater insight/calibration logic lives in one shared module (`ewater-insights.ts`) so the REST API and the MCP server never diverge — routes and MCP tools are thin wrappers that just parse input and shape the HTTP/MCP response.
- The calibration/NRW gap analysis is derived from the existing dispense-volume KDE calibration model (no separate NRW dataset exists); it surfaces the LCF gap %, preload gap, and a plain-language interpretation so an LLM client can reason about likely meter drift without re-deriving the math.
- The MCP server runs in **stateless** mode (`sessionIdGenerator: undefined`): a fresh `McpServer` + `StreamableHTTPServerTransport` is created per request. There are no server-initiated notifications or resumable streams needed for a tool-only server, so this avoids session-lifecycle bookkeeping.

## Product

- Web dashboard (`ewater-app`) for monitoring eWater community tap/dispenser assets: live status, tank/voltage/flow charts, EWC device settings, and calibration tools.
- Remote MCP server (`/api/mcp` on the api-server) exposing the same asset data and calibration/NRW analysis as callable tools for external AI clients, bearer-token protected.

### Remote MCP server

- Endpoint: `POST/GET/DELETE /api/mcp` (Streamable HTTP transport, JSON-RPC 2.0).
- Auth: `Authorization: Bearer <MCP_BEARER_TOKEN>` required on every request; unauthenticated requests get a 401 JSON-RPC error. This is a separate secret from the eWater username/password credentials configured via `/api/ewater/credentials` (which the tools still need configured server-side to reach live eWater data).
- Tools: `list_countries`, `list_organisations`, `list_water_systems` (Country → Organisation → Water System hierarchy, each optionally filtered by parent), `list_assets` (paginated + filterable by status/water system/organisation/country), `get_asset_history`, `get_asset_ewc_settings`, `get_asset_flow_rate`, `get_calibration_analysis`. All return structured JSON (`structuredContent` + JSON text content).
- **Every tool response uses one shared pagination envelope** (`totalCount`, `returnedCount`, `offset`, `limit`, `hasMore`) so an LLM client never has to learn a different contract per tool. List tools return items under a named array field (e.g. `assets`); the 3 single-object tools (`get_asset_ewc_settings`, `get_asset_flow_rate`, `get_calibration_analysis`) return their result under `data` with `totalCount`/`returnedCount` fixed at 1 and `hasMore` fixed at `false`. `get_asset_history` paginates each time-series (`tankHeight`, `dailyInflow`, `voltageHistory`, `flowRateHistory`) independently with the same envelope, since they have different natural lengths.
- `list_assets` was originally unbounded, which could push agent conversations (e.g. a WhatsApp AI agent) past their LLM context window on large accounts — this is why pagination/filtering was added; see `paginateArray`/`listAssetsPaged` in `ewater-insights.ts`. `totalCount` lets a client answer "how many" questions from a single call without paging through everything.
- REST routes (`/ewater/assets`, esense-charts routes, etc.) intentionally keep their original unpaged/unwrapped response shapes — only the MCP tool layer applies the pagination envelope, via dedicated wrapper functions (`listAssetsPaged`, `getAssetHistoryPaged`) that sit alongside (not replacing) the existing `listAssets`/`getAssetEsenseCharts` used by REST.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- eWater's packet trailer bytes[33–34] is the FCF (flow conversion factor), not the LCF (litres conversion factor) — always resolve the LCF from EWC settings (`LitresConversion`, falling back to `GetTicksPerLitre`) when converting ticks to litres. See `.agents/memory/ewater-api.md`.
- When adding new eWater-derived data, add the logic to `lib/ewater-insights.ts` and have both the REST route and any MCP tool call it — don't reimplement inline in `routes/ewater.ts`.
- The asset detail "Logs" tab (`asset-logs.tsx`, `/ewater/assets/:assetId/logs`) and "Packets" tab (`raw-packets-panel.tsx`, `/ewater/assets/:assetId/packets`) are two independent views over overlapping data — protocol decoding added to one does NOT automatically show up in the other. Shengda NB-IoT (CBOR/LwM2M) frames decode server-side only (`shengda-nbiot-decoder.ts`, via `tryDecodeShengdaLwm2m`); EWC/CommandApi frames decode client-side (`lib/ewc25.ts`). When adding a new protocol decoder, wire it into both tabs' backing routes/components, not just one.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
