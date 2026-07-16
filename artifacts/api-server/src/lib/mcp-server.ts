// ---------------------------------------------------------------------------
// Remote MCP (Model Context Protocol) server exposing eWater asset data and
// derived insights (calibration / NRW gap analysis) to external MCP clients
// over Streamable HTTP. Reuses the same eWater client/auth + insight logic as
// the REST routes (see lib/ewater-insights.ts) — no duplicated eWater logic.
//
// Auth: every request must carry `Authorization: Bearer <MCP_BEARER_TOKEN>`.
// This is a static shared-secret check, separate from the eWater
// username/password credentials configured via the REST /ewater/credentials
// endpoints (which the tool implementations still depend on internally).
// ---------------------------------------------------------------------------

import type { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { getCredentials } from "./ewater-client";
import {
  listAssetsPaged,
  listCountries,
  listOrganisations,
  listWaterSystems,
  getAssetEwcSettings,
  getAssetFlowRate,
  getAssetHistoryPaged,
  getCalibrationAnalysis,
  getRegisteredTagIds,
  getTagInfo,
  getHouseholdInfo,
  getTagUsage,
  singleItemPage,
} from "./ewater-insights";
import { logger } from "./logger";

function requireEwaterCredentials(): { error: string } | null {
  if (!getCredentials()) {
    return { error: "No eWater credentials configured on the server. Configure them via POST /api/ewater/credentials first." };
  }
  return null;
}

function jsonToolResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
  };
}

function errorToolResult(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

function createEwaterMcpServer(): McpServer {
  const server = new McpServer({
    name: "ewater-monitor-mcp",
    version: "1.0.0",
  });

  server.registerTool(
    "list_countries",
    {
      title: "List countries",
      description:
        "Lists all countries in the eWater entity hierarchy (Country -> Organisation -> Water System -> Asset), with the number of organisations, water systems, and assets under each. Use this as the top of the drill-down chain: list_countries -> list_organisations -> list_water_systems -> list_assets. Response uses the standard pagination envelope (totalCount/returnedCount/hasMore); this list is small enough that it is always returned in full (hasMore always false).",
      inputSchema: {},
    },
    async () => {
      const credErr = requireEwaterCredentials();
      if (credErr) return errorToolResult(credErr.error);
      try {
        const countries = await listCountries();
        return jsonToolResult({
          countries,
          totalCount: countries.length,
          returnedCount: countries.length,
          offset: 0,
          limit: countries.length,
          hasMore: false,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err }, "MCP list_countries failed");
        return errorToolResult(`eWater API error: ${msg}`);
      }
    },
  );

  server.registerTool(
    "list_organisations",
    {
      title: "List organisations",
      description:
        "Lists organisations in the eWater entity hierarchy, optionally filtered by country (countryId from list_countries, or countryName). Each entry includes the number of water systems and assets under it. Use list_water_systems next to drill further down. Response uses the standard pagination envelope; this list is always returned in full (hasMore always false).",
      inputSchema: {
        countryId: z.number().optional().describe("Filter by country id (from list_countries)"),
        countryName: z.string().optional().describe("Filter by exact country name"),
      },
    },
    async ({ countryId, countryName }) => {
      const credErr = requireEwaterCredentials();
      if (credErr) return errorToolResult(credErr.error);
      try {
        const organisations = await listOrganisations({ countryId, countryName });
        return jsonToolResult({
          organisations,
          totalCount: organisations.length,
          returnedCount: organisations.length,
          offset: 0,
          limit: organisations.length,
          hasMore: false,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err }, "MCP list_organisations failed");
        return errorToolResult(`eWater API error: ${msg}`);
      }
    },
  );

  server.registerTool(
    "list_water_systems",
    {
      title: "List water systems",
      description:
        "Lists water systems in the eWater entity hierarchy, optionally filtered by organisation (organisationId from list_organisations, or organisationName) and/or country (countryId from list_countries, or countryName). Each entry includes its parent organisation/country and the number of assets under it. Pass a water system's id or name into list_assets (waterSystemId/waterSystemName) to list only its assets — e.g. to answer 'list all the assets in <water system>'. Response uses the standard pagination envelope; this list is always returned in full (hasMore always false).",
      inputSchema: {
        organisationId: z.number().optional().describe("Filter by organisation id (from list_organisations)"),
        organisationName: z.string().optional().describe("Filter by exact organisation name"),
        countryId: z.number().optional().describe("Filter by country id (from list_countries)"),
        countryName: z.string().optional().describe("Filter by exact country name"),
      },
    },
    async ({ organisationId, organisationName, countryId, countryName }) => {
      const credErr = requireEwaterCredentials();
      if (credErr) return errorToolResult(credErr.error);
      try {
        const waterSystems = await listWaterSystems({ organisationId, organisationName, countryId, countryName });
        return jsonToolResult({
          waterSystems,
          totalCount: waterSystems.length,
          returnedCount: waterSystems.length,
          offset: 0,
          limit: waterSystems.length,
          hasMore: false,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err }, "MCP list_water_systems failed");
        return errorToolResult(`eWater API error: ${msg}`);
      }
    },
  );

  server.registerTool(
    "list_assets",
    {
      title: "List eWater assets",
      description:
        "Lists eWater assets (dispensers/taps), paginated (max 100 per call, default 50) and optionally filtered by status, water system, organisation, or country. The response's totalCount is the true total matching the filters across every page — use it directly to answer 'how many' questions without fetching every page. Use limit/offset to page through results. To scope to a specific location, first call list_water_systems (optionally via list_countries/list_organisations) to resolve names/ids, then pass waterSystemName/waterSystemId (or organisation/country equivalents) here instead of paging through everything.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).default(50).describe("Max assets to return per call (1-100, default 50)"),
        offset: z.number().int().min(0).default(0).describe("Number of matching assets to skip before returning results, for paging. Omit or 0 for the first page."),
        status: z.string().optional().describe("Filter by asset lifecycle status (e.g. Active, Staged, PreInstallation, Suspended)"),
        waterSystemId: z.number().optional().describe("Filter by water system id (from list_water_systems)"),
        waterSystemName: z.string().optional().describe("Filter by exact water system name"),
        organisationId: z.number().optional().describe("Filter by organisation id (from list_organisations)"),
        organisationName: z.string().optional().describe("Filter by exact organisation name"),
        countryId: z.number().optional().describe("Filter by country id (from list_countries)"),
        countryName: z.string().optional().describe("Filter by exact country name"),
      },
    },
    async ({ limit, offset, status, waterSystemId, waterSystemName, organisationId, organisationName, countryId, countryName }) => {
      const credErr = requireEwaterCredentials();
      if (credErr) return errorToolResult(credErr.error);
      try {
        const page = await listAssetsPaged({
          limit,
          offset,
          status,
          waterSystemId,
          waterSystemName,
          organisationId,
          organisationName,
          countryId,
          countryName,
        });
        return jsonToolResult({
          assets: page.items,
          totalCount: page.totalCount,
          returnedCount: page.returnedCount,
          offset: page.offset,
          limit: page.limit,
          hasMore: page.hasMore,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err }, "MCP list_assets failed");
        return errorToolResult(`eWater API error: ${msg}`);
      }
    },
  );

  server.registerTool(
    "get_asset_history",
    {
      title: "Get asset history",
      description:
        "Returns time-series history for one eWater asset over the last N days: tank height (water/chlorine), daily water inflow, battery voltage history + status, and dispense flow-rate history. Each time-series (tankHeight, dailyInflow, voltageHistory, flowRateHistory) is independently paginated with the standard envelope (totalCount/returnedCount/hasMore) using the same limit/offset — use a larger `days` range plus limit/offset paging rather than assuming one call returns everything for long ranges.",
      inputSchema: {
        assetId: z.string().describe("The eWater asset ID"),
        days: z.number().int().min(1).max(180).default(7).describe("Number of days of history to return (1-180, default 7)"),
        limit: z.number().int().min(1).max(2000).default(500).describe("Max entries to return per time-series (1-2000, default 500)"),
        offset: z.number().int().min(0).default(0).describe("Number of entries to skip in each time-series before returning results, for paging"),
      },
    },
    async ({ assetId, days, limit, offset }) => {
      const credErr = requireEwaterCredentials();
      if (credErr) return errorToolResult(credErr.error);
      try {
        const { tankHeight, dailyInflow, voltageHistory, voltageStatus, flowRateHistory, dispenseVolumes } =
          await getAssetHistoryPaged(assetId, days ?? 7, { limit, offset });
        return jsonToolResult({
          assetId,
          days: days ?? 7,
          tankHeight,
          dailyInflow,
          voltageHistory,
          voltageStatus,
          flowRateHistory,
          dispenseVolumes,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err, assetId }, "MCP get_asset_history failed");
        return errorToolResult(`eWater API error: ${msg}`);
      }
    },
  );

  server.registerTool(
    "get_asset_ewc_settings",
    {
      title: "Get asset EWC settings",
      description:
        "Returns the electronic water controller (EWC) device settings for one asset: flow conversion factor (FCF), litres conversion factor (LCF), currency conversion (FX), preload charge, price of water, and other device configuration values. Response uses the standard pagination envelope (single-item: totalCount/returnedCount are 1, hasMore is false) with the settings under `data`.",
      inputSchema: {
        assetId: z.string().describe("The eWater asset ID"),
      },
    },
    async ({ assetId }) => {
      const credErr = requireEwaterCredentials();
      if (credErr) return errorToolResult(credErr.error);
      try {
        const settings = await getAssetEwcSettings(assetId);
        return jsonToolResult(singleItemPage({ assetId, ...settings }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err, assetId }, "MCP get_asset_ewc_settings failed");
        return errorToolResult(`eWater API error: ${msg}`);
      }
    },
  );

  server.registerTool(
    "get_asset_flow_rate",
    {
      title: "Get asset flow rate",
      description:
        "Returns the most recent dispense flow rate (litres/minute) for one asset, derived from the last 24 hours of device logs. Response uses the standard pagination envelope (single-item: totalCount/returnedCount are 1, hasMore is false) with the result under `data`.",
      inputSchema: {
        assetId: z.string().describe("The eWater asset ID"),
      },
    },
    async ({ assetId }) => {
      const credErr = requireEwaterCredentials();
      if (credErr) return errorToolResult(credErr.error);
      try {
        const result = await getAssetFlowRate(assetId);
        return jsonToolResult(singleItemPage({ assetId, ...result }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err, assetId }, "MCP get_asset_flow_rate failed");
        return errorToolResult(`eWater API error: ${msg}`);
      }
    },
  );

  server.registerTool(
    "get_calibration_analysis",
    {
      title: "Get calibration / NRW gap analysis",
      description:
        "Runs a calibration and non-revenue-water (NRW) gap analysis for one asset over the last N days. Compares the configured litres-conversion factor (LCF) against the typical dispense volume derived from a KDE of dispense events (assumed to cluster around a true 20L fill), and compares the configured preload against the measured preload from 'no credit' events. Returns the LCF gap %, preload gap, and a plain-language interpretation of likely meter drift / under- or over-reading. Response uses the standard pagination envelope (single-item: totalCount/returnedCount are 1, hasMore is false) with the analysis under `data`.",
      inputSchema: {
        assetId: z.string().describe("The eWater asset ID"),
        days: z.number().int().min(1).max(180).default(30).describe("Number of days of dispense history to analyze (1-180, default 30)"),
      },
    },
    async ({ assetId, days }) => {
      const credErr = requireEwaterCredentials();
      if (credErr) return errorToolResult(credErr.error);
      try {
        const analysis = await getCalibrationAnalysis(assetId, days ?? 30);
        return jsonToolResult(singleItemPage(analysis));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err, assetId }, "MCP get_calibration_analysis failed");
        return errorToolResult(`eWater API error: ${msg}`);
      }
    },
  );

  server.registerTool(
    "list_registered_tags",
    {
      title: "List registered NFC tags",
      description:
        "Lists all fully-registered NFC tag IDs for one eWater water system (registered = tag has a household record and has completed sign-up). Use `list_water_systems` first to get a `waterSystemId`. Response uses the standard pagination envelope; `totalCount` is the true fleet size for that system — use it to answer 'how many registered users?' questions directly without fetching all pages. Pass an nfcId from this list to `get_tag_info` for registration and usage details.",
      inputSchema: {
        waterSystemId: z.number().int().describe("The eWater water system ID (from list_water_systems)"),
        limit: z.number().int().min(1).max(500).default(100).describe("Max tag IDs to return per call (1-500, default 100)"),
        offset: z.number().int().min(0).default(0).describe("Number of tag IDs to skip before returning results, for paging"),
      },
    },
    async ({ waterSystemId, limit, offset }) => {
      const credErr = requireEwaterCredentials();
      if (credErr) return errorToolResult(credErr.error);
      try {
        const page = await getRegisteredTagIds(waterSystemId, offset, limit);
        return jsonToolResult(page);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err, waterSystemId }, "MCP list_registered_tags failed");
        return errorToolResult(`eWater API error: ${msg}`);
      }
    },
  );

  server.registerTool(
    "get_tag_info",
    {
      title: "Get NFC tag info",
      description:
        "Returns registration details for one NFC tag: when it signed up, which household it belongs to (householdId), which asset is its primary tap (primaryAssetId), credit balance, dispense and top-up counts, and whether it has been deleted or blacklisted. Pass householdId to `get_household_info` for the household record. Pass primaryAssetId to `get_asset_ewc_settings` or `get_asset_history` for the tap's technical data. Response uses the standard single-item pagination envelope (totalCount/returnedCount are 1, hasMore is false) with the tag record under `data`.",
      inputSchema: {
        nfcId: z.string().describe("The NFC tag ID (8-character hex string, e.g. 'D32268F0' — case-insensitive)"),
      },
    },
    async ({ nfcId }) => {
      const credErr = requireEwaterCredentials();
      if (credErr) return errorToolResult(credErr.error);
      try {
        const tag = await getTagInfo(nfcId.toUpperCase());
        if (!tag) return errorToolResult(`Tag not found: ${nfcId}`);
        return jsonToolResult(singleItemPage(tag));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err, nfcId }, "MCP get_tag_info failed");
        return errorToolResult(`eWater API error: ${msg}`);
      }
    },
  );

  server.registerTool(
    "get_household_info",
    {
      title: "Get household info",
      description:
        "Returns the household record for a registered eWater customer: household name, creation date, last-active date, and the linked asset and system IDs. Obtain a householdId from `get_tag_info`. Phone number, address, and GPS coordinates are absent — removed by eWater per Kenya data-protection law. Response uses the standard single-item pagination envelope (totalCount/returnedCount are 1, hasMore is false) with the household record under `data`.",
      inputSchema: {
        householdId: z.string().describe("The household UUID (from get_tag_info)"),
      },
    },
    async ({ householdId }) => {
      const credErr = requireEwaterCredentials();
      if (credErr) return errorToolResult(credErr.error);
      try {
        const household = await getHouseholdInfo(householdId);
        if (!household) return errorToolResult(`Household not found: ${householdId}`);
        return jsonToolResult(singleItemPage(household));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err, householdId }, "MCP get_household_info failed");
        return errorToolResult(`eWater API error: ${msg}`);
      }
    },
  );

  server.registerTool(
    "get_tag_usage",
    {
      title: "Get NFC tag usage history",
      description:
        "Returns recent dispense events recorded for an NFC tag by scanning the EWC packet log for the tag's primary asset. Resolves the tag's primary asset internally from nfcId — no need to supply an asset ID. Each event includes the timestamp, litres dispensed (derived from tick count ÷ LCF), credit consumed, and event type (Dispense / Dispense no-credit). Useful for verifying that a household is actively using their tap, debugging credit deduction problems, or computing per-tag consumption over a period. Window is capped at 90 days; default is 30. Response uses the standard pagination envelope with events under `items`.",
      inputSchema: {
        nfcId: z.string().describe("NFC tag ID (8-char hex, e.g. 'D32268F0' — case-insensitive)"),
        days: z.number().int().min(1).max(90).default(30).describe("How many days back to scan (1–90, default 30)"),
        offset: z.number().int().min(0).default(0).describe("Pagination offset (default 0)"),
        limit: z.number().int().min(1).max(200).default(50).describe("Max events to return per call (default 50)"),
      },
    },
    async ({ nfcId, days, offset, limit }) => {
      const credErr = requireEwaterCredentials();
      if (credErr) return errorToolResult(credErr.error);
      try {
        const tag = await getTagInfo(nfcId.toUpperCase());
        if (!tag) return errorToolResult(`Tag not found: ${nfcId}`);
        const page = await getTagUsage(nfcId, tag.primaryAssetId, days, offset, limit);
        return jsonToolResult(page);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err, nfcId }, "MCP get_tag_usage failed");
        return errorToolResult(`eWater API error: ${msg}`);
      }
    },
  );

  return server;
}

function isAuthorized(req: Request): boolean {
  const expected = process.env["MCP_BEARER_TOKEN"];
  if (!expected) return false;
  const header = req.headers["authorization"];
  if (!header || Array.isArray(header)) return false;
  const [scheme, token] = header.split(" ");
  return scheme === "Bearer" && token === expected;
}

// Stateless mode: a fresh McpServer + transport per request. Simpler and
// avoids managing session state / cleanup across requests for a tool-only
// server with no server-initiated notifications or resumable streams.
export async function handleMcpRequest(req: Request, res: Response): Promise<void> {
  if (!isAuthorized(req)) {
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized: missing or invalid bearer token" },
      id: null,
    });
    return;
  }

  const server = createEwaterMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    logger.error({ err }, "MCP request handling failed");
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
}
