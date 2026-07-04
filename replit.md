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
- Tools: `list_assets`, `get_asset_history`, `get_asset_ewc_settings`, `get_asset_flow_rate`, `get_calibration_analysis`. All return structured JSON (`structuredContent` + JSON text content).

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- eWater's packet trailer bytes[33–34] is the FCF (flow conversion factor), not the LCF (litres conversion factor) — always resolve the LCF from EWC settings (`LitresConversion`, falling back to `GetTicksPerLitre`) when converting ticks to litres. See `.agents/memory/ewater-api.md`.
- When adding new eWater-derived data, add the logic to `lib/ewater-insights.ts` and have both the REST route and any MCP tool call it — don't reimplement inline in `routes/ewater.ts`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
