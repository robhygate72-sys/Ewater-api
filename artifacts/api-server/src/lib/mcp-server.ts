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
  getAssetById,
  getAssetLogs,
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
  getDisbursementsByTagAndAsset,
  getDisbursementsByTag,
  getDisbursementsByAsset,
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

// ---------------------------------------------------------------------------
// Shared boilerplate strings injected into every relevant tool description
// ---------------------------------------------------------------------------

const WHATSAPP_BOILERPLATE =
  "OUTPUT FORMAT FOR WHATSAPP: This tool result will be presented in a WhatsApp group to field engineers. " +
  "1. BREVITY: Show max 5 records per reply. If more exist, say: 'Showing 5 of N — narrow your filter or ask for more.' " +
  "2. BINARY FIELDS: Never include rawPayload, hexPayload, base64 strings, or hex byte sequences (e.g. '44 00 00 10...') in any reply. " +
  "3. RECORD FORMAT: For each log show only: [time] · [eventName] · [eventCategory] · [2–3 key values]. " +
  "4. ALERTS: Prefix Error-category events with ■. Example: '■ 18:27 · Dispense Limit · Error · Flow stopped after 256s · Battery 12.6V (normal)'. " +
  "5. OFFLINE DETECTION: If all recent records have pipeline=CmdApi, say: 'Device appears offline — only outgoing commands visible, no telemetry received recently.' " +
  "6. INTERPRETATION: Include operational meaning, not just raw values. Say 'Battery: 12.6V (normal)' not just '12.6'.";

const SINGLE_ITEM_WHATSAPP =
  "OUTPUT FORMAT FOR WHATSAPP: Reply in plain language with interpreted values (e.g. '12.6V (normal)' not '12.6'). " +
  "Omit internal IDs, UUIDs, and database record identifiers unless the user explicitly asks for them. Keep replies brief.";

function createEwaterMcpServer(): McpServer {
  const server = new McpServer({
    name: "ewater-monitor-mcp",
    version: "1.0.0",
  });

  // ─── Hierarchy: Country / Organisation / Water System ──────────────────────

  server.registerTool(
    "list_countries",
    {
      title: "List countries",
      description:
        "Lists all countries in the eWater entity hierarchy (Country → Organisation → Water System → Asset), with the number of organisations, water systems, and assets under each. " +
        "Use as the top of the drill-down chain: list_countries → list_organisations → list_water_systems → list_assets. " +
        "Response uses the standard pagination envelope (totalCount/returnedCount/hasMore); this list is always returned in full (hasMore=false). " +
        SINGLE_ITEM_WHATSAPP,
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
        "Lists organisations in the eWater entity hierarchy, optionally filtered by country (countryId from list_countries, or countryName). " +
        "Each entry includes the number of water systems and assets under it. Use list_water_systems next to drill further down. " +
        "Response uses the standard pagination envelope; this list is always returned in full (hasMore=false). " +
        SINGLE_ITEM_WHATSAPP,
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
        "Lists water systems in the eWater entity hierarchy, optionally filtered by organisation (organisationId/organisationName) and/or country (countryId/countryName). " +
        "Each entry includes its parent organisation/country and the number of assets under it. " +
        "Pass a water system's id or name into list_assets (waterSystemId/waterSystemName) to list only its assets — e.g. to answer 'list all the assets in <water system>'. " +
        "Response uses the standard pagination envelope; this list is always returned in full (hasMore=false). " +
        SINGLE_ITEM_WHATSAPP,
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

  // ─── Assets ────────────────────────────────────────────────────────────────

  server.registerTool(
    "list_assets",
    {
      title: "List eWater assets",
      description:
        "Returns eWater assets (taps/dispensers) visible to this account. Each item includes: id (numeric asset ID), name, asset type, status, GPS location, water system name, and country name. " +
        "When to call: when a user asks to list all taps, find an asset by name or location, count assets, or find an asset ID when only the name is known. " +
        "Do NOT call this if you already have a numeric asset ID (e.g. primary_asset_id from get_tag) — call get_asset directly instead. " +
        "Paginated: max 100 per call, default 50; totalCount is the true total across all pages. To scope to a location, pass waterSystemName/waterSystemId (resolve via list_water_systems if needed). " +
        "What to call next: use the id from any result as assetId for get_asset, get_asset_history, get_asset_logs, get_asset_flow_rate, get_asset_ewc_settings, or get_calibration_analysis. " +
        "OUTPUT FORMAT FOR WHATSAPP: Show max 5 assets. If more exist, say 'Showing 5 of N — use waterSystemName or status filter to narrow results.' List each as: [name] · [status] · [water system]. Do not list GPS coordinates, internal IDs, or UUIDs unless asked.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).default(50).describe("Max assets to return per call (1–100, default 50)"),
        offset: z.number().int().min(0).default(0).describe("Number of matching assets to skip before returning results, for paging"),
        status: z.string().optional().describe("Filter by asset lifecycle status. Known values: Active, Staged, PreInstallation, Suspended"),
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
    "get_asset",
    {
      title: "Get asset by ID",
      description:
        "Returns full details for one eWater asset given its numeric ID: asset name, asset type (e.g. CommunityTap, eSENSE), status (Active/Inactive), GPS coordinates, water system name, and country name. " +
        "When to call: when a user asks 'what water system does this tag/household use?', 'what tap is asset ID X?', or any question needing details about a specific asset. " +
        "Call this after get_tag using primary_asset_id as the input. Where assetId comes from: the primary_asset_id field returned by get_tag, or the id field from list_assets. " +
        "Never guess the water system name, country, or asset type — this tool returns the real values. " +
        "Response uses the standard single-item envelope with the asset record under 'data'. " +
        SINGLE_ITEM_WHATSAPP,
      inputSchema: {
        assetId: z.number().int().describe("The numeric eWater asset ID (primary_asset_id from get_tag, or id from list_assets)"),
      },
    },
    async ({ assetId }) => {
      const credErr = requireEwaterCredentials();
      if (credErr) return errorToolResult(credErr.error);
      try {
        const asset = await getAssetById(assetId);
        if (!asset) return errorToolResult(`Asset not found: ${assetId}`);
        return jsonToolResult(singleItemPage(asset));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err, assetId }, "MCP get_asset failed");
        return errorToolResult(`eWater API error: ${msg}`);
      }
    },
  );

  server.registerTool(
    "get_asset_history",
    {
      title: "Get asset history",
      description:
        "Returns time-series history for one eWater asset over the last N days (1–180, default 7). " +
        "Includes: tank water and chlorine height over time, daily water inflow volume, battery voltage history and charge status, and dispense flow-rate history. " +
        "When to call: when asked about asset performance over time, water levels, tank fill history, battery health trends, or historical flow rates for a specific tap. " +
        "Where assetId comes from: the primary_asset_id field from get_tag, the id field from list_assets or get_asset, or a numeric asset ID in the conversation — never guess. " +
        "Each time-series (tankHeight, dailyInflow, voltageHistory, flowRateHistory) is independently paginated with the standard envelope; use limit/offset to page through long ranges. " +
        "OUTPUT FORMAT FOR WHATSAPP: Summarise trends rather than listing raw data points. E.g. 'Tank was 1.1–1.4m over the last 7 days. Battery stable at 12.6V.' Only list individual data points if the user explicitly asks.",
      inputSchema: {
        assetId: z.string().describe("The eWater asset ID"),
        days: z.number().int().min(1).max(180).default(7).describe("Number of days of history to return (1–180, default 7)"),
        limit: z.number().int().min(1).max(2000).default(500).describe("Max entries to return per time-series (1–2000, default 500)"),
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
        "Returns the EWC (electronic water controller) configuration for one eWater asset: flow conversion factor (FCF), litres conversion factor (LCF), currency/FX settings, preload charge, price per litre, and other device configuration values. " +
        "Key fields: LCF (litres per flow tick — the calibration factor used to convert raw tick counts to litres), preloadCharge (credit loaded at each top-up in mits), pricePerLitre. " +
        "When to call: when asked about pricing, how much water a credit buys, device configuration, preload settings, or calibration factors for a specific tap. " +
        "Where assetId comes from: the primary_asset_id field from get_tag, the id field from list_assets or get_asset, or a numeric asset ID in the conversation — never guess. " +
        "Response uses the standard single-item envelope with settings under 'data'. " +
        SINGLE_ITEM_WHATSAPP,
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
        "Returns the most recent dispense flow rate in litres/minute for one eWater asset, calculated from the last 24 hours of device logs. " +
        "When to call: when asked 'is the tap flowing properly?', 'what is the current flow rate?', 'how fast is water dispensing?', or any question about live dispensing performance. " +
        "Where assetId comes from: the primary_asset_id field from get_tag, the id field from list_assets or get_asset, or a numeric asset ID in the conversation — never guess. " +
        "Response uses the standard single-item envelope with the result under 'data'. " +
        "OUTPUT FORMAT FOR WHATSAPP: State the flow rate and interpret it (e.g. 'Flow rate: 4.2 L/min (normal)' or 'No flow detected in the last 24 hours — check for blockage or closure'). Keep reply to 1–2 sentences.",
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
        "Runs a calibration and non-revenue-water (NRW) gap analysis for one eWater asset over N days (1–180, default 30). " +
        "Compares the configured litres-conversion factor (LCF) against measured dispense events to detect meter drift. " +
        "Compares configured preload against actual 'no credit' event data. " +
        "Returns: LCF gap %, preload gap, and a plain-language summary of whether the meter is over-reading or under-reading. " +
        "When to call: when asked about NRW, meter drift, calibration accuracy, revenue loss, or whether LCF or preload settings are correct. " +
        "Where assetId comes from: the primary_asset_id field from get_tag, the id field from list_assets or get_asset, or a numeric asset ID in the conversation — never guess. " +
        "Response uses the standard single-item envelope with the analysis under 'data'. " +
        "OUTPUT FORMAT FOR WHATSAPP: Lead with the plain-language summary field, then state the LCF gap % and preload gap. Flag significant gaps (>5%) with ■. Keep reply concise.",
      inputSchema: {
        assetId: z.string().describe("The eWater asset ID"),
        days: z.number().int().min(1).max(180).default(30).describe("Number of days of dispense history to analyze (1–180, default 30)"),
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

  // ─── Tags / Households ─────────────────────────────────────────────────────

  server.registerTool(
    "list_registered_tags",
    {
      title: "List registered NFC tags",
      description:
        "Lists all fully-registered NFC tag IDs for one eWater water system (registered = tag has a household record and has completed sign-up). " +
        "Use list_water_systems first to get a waterSystemId. " +
        "Response uses the standard pagination envelope; totalCount is the true fleet size for that system — use it to answer 'how many registered users?' questions directly without fetching all pages. " +
        "What to call next: pass any nfcId from this list to get_tag to look up that tag's registration details, credit balance, and household. " +
        "OUTPUT FORMAT FOR WHATSAPP: State the total count prominently (e.g. 'Water system has 347 registered tags'). Only list individual tag IDs if the user explicitly asks for them.",
      inputSchema: {
        waterSystemId: z.number().int().describe("The eWater water system ID (from list_water_systems)"),
        limit: z.number().int().min(1).max(500).default(100).describe("Max tag IDs to return per call (1–500, default 100)"),
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
    "get_tag",
    {
      title: "Get NFC tag",
      description:
        "Looks up an NFC water tag by its short tag ID (e.g. DBDA4ED2). " +
        "Returns: primary_asset_id (numeric), primary_system_id (numeric), primary_country_id (numeric), household_id (UUID), sign-up date, last usage date, disbursement count, top-up count, credit balance, deleted status, blacklisted status. " +
        "When to call: any time a user mentions a tag ID or asks about a specific NFC tag, household, or registered water user. This is always the starting point — call this first. " +
        "What to call next with the result: for the tap/dispenser name and water system → get_asset(assetId=primary_asset_id); for the household name → get_household(householdId=household_id). " +
        "Never guess the household name, water system name, or country from the IDs returned — always resolve them via the appropriate follow-up tool. " +
        "Response uses the standard single-item envelope with the tag record under 'data'. " +
        "OUTPUT FORMAT FOR WHATSAPP: Show tag ID, credit balance, top-up/dispense counts, and status (active/deleted/blacklisted). Omit raw UUID fields (household_id, primary_system_id, primary_country_id) unless the user asks. Interpret status flags: deleted=true → 'Tag deregistered'; blacklisted=true → '■ Tag blacklisted'.",
      inputSchema: {
        nfcId: z.string().describe("The NFC tag ID (8-character hex string, e.g. 'DBDA4ED2' — case-insensitive)"),
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
        logger.error({ err, nfcId }, "MCP get_tag failed");
        return errorToolResult(`eWater API error: ${msg}`);
      }
    },
  );

  server.registerTool(
    "get_tag_info",
    {
      title: "Get NFC tag info (alias)",
      description:
        "Alias for get_tag — prefer get_tag for new calls. Looks up an NFC water tag by its short tag ID. " +
        "Returns primary_asset_id, household_id, credit balance, dispense/top-up counts, and status flags. " +
        "What to call next: get_asset(primary_asset_id) for the tap name and water system; get_household(household_id) for the household name. " +
        "Never guess the water system name or household name from IDs — always resolve via follow-up tool. " +
        SINGLE_ITEM_WHATSAPP,
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
    "get_household",
    {
      title: "Get household",
      description:
        "Returns the registered household name and details for a given household UUID: household name, creation date, last-active date, and the linked asset and system IDs. " +
        "When to call: after get_tag, when the user asks 'who is this tag registered to?', 'what is the household name?', or 'whose account is this?'. " +
        "Where householdId comes from: the household_id field returned by get_tag. Never guess the household name — always call this tool when you have a household_id. " +
        "Phone number, address, and GPS coordinates are absent — removed by eWater per data-protection policy. " +
        "Response uses the standard single-item envelope with the household record under 'data'. " +
        SINGLE_ITEM_WHATSAPP,
      inputSchema: {
        householdId: z.string().describe("The household UUID (household_id field from get_tag)"),
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
        logger.error({ err, householdId }, "MCP get_household failed");
        return errorToolResult(`eWater API error: ${msg}`);
      }
    },
  );

  server.registerTool(
    "get_household_info",
    {
      title: "Get household info (alias)",
      description:
        "Alias for get_household — prefer get_household for new calls. Returns the registered household name and details for a given household UUID. " +
        "Where householdId comes from: the household_id field from get_tag. Never guess the household name — always call this tool when you have a household_id. " +
        "Response uses the standard single-item envelope with the household record under 'data'. " +
        SINGLE_ITEM_WHATSAPP,
      inputSchema: {
        householdId: z.string().describe("The household UUID (from get_tag)"),
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
        "Returns recent dispense events for an NFC tag by scanning the EWC packet log for the tag's primary asset. " +
        "Resolves the tag's primary asset internally from nfcId — no need to supply an asset ID. " +
        "Key fields per event: timestamp, litres (volume dispensed = ticks ÷ LCF — primary volume indicator), creditConsumed, eventType (Dispense = normal paid dispense; No Credit = dispense with no remaining credit). " +
        "Useful for: verifying a household is actively using their tap, debugging credit deduction problems, computing per-tag consumption over a period. " +
        "Window is capped at 90 days; default 30. Response uses the standard pagination envelope with events under 'items'. " +
        "OUTPUT FORMAT FOR WHATSAPP: Show max 5 events. For each: '[date/time] — [litres]L dispensed ([eventType])'. Summarise total volume for the period if there are many events. E.g. 'Tag DBDA4ED2 used 12 times in 7 days, total 184L dispensed.'",
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

  // ─── Logs ──────────────────────────────────────────────────────────────────

  server.registerTool(
    "get_asset_logs",
    {
      title: "Get asset logs (decoded packets)",
      description:
        "Returns recent device communication logs for one eWater asset, with every packet fully decoded by protocol. " +
        "Results are returned most-recent-first.\n\n" +

        "PIPELINE FIELD — communication direction (critical for interpreting logs):\n" +
        "- pipeline='MQTT' or 'UDP': Telemetry received FROM the device. This is real incoming data from the physical meter.\n" +
        "- pipeline='CmdApi': Outgoing command sent FROM the platform TO the device. This is NOT data received from the device.\n" +
        "When a user asks 'when was data last received?' or 'is the device online?', only MQTT/UDP entries count. " +
        "If all visible entries are pipeline=CmdApi, say: 'Device appears offline — only outgoing commands are visible, no telemetry has been received recently.'\n\n" +

        "PROTOCOL FIELD — device firmware type. Known values: 'Ewc2_5' (standard EWC meter, pipeline=MQTT/UDP), 'CommandApi_1' (outgoing command envelope, pipeline=CmdApi), '4CCv1' (older 4CC meter), 'Gadwall' (Gadwall device). " +
        "Use the protocol or excludeProtocols parameters to filter results server-side — do NOT fetch all records and filter client-side.\n\n" +

        "DECODED OBJECT — protocol-specific fields. The 'kind' field is the discriminator:\n\n" +

        "kind='ewc-datalog' — EWC 2.5 DATALOG packet received FROM the device (incoming telemetry, pipeline=MQTT/UDP). Key fields:\n" +
        "- eventName: The specific event type. Use this to filter when a user asks for a specific event by name. " +
        "NEVER return a different event type and present it as matching the request. " +
        "Valid values: No Error/Dispense, No Credit, Dispense Limit, No Flow, No Flow Repeat, Low Battery, Pressure Event, SuperTap Top-Up, Host Valve Off, Start-Up, Tamper, Health State, Prox Detect, " +
        "Format-ID Fail, Not Mifare 1k, Keycode Load Error, Card Comms Error, Auth Error CRYPTO1, Format-Checksum Fail, EEPROM Write Error Int/Ext, Tag Removed, RS232 Command Error, MFRC Chip Error, Block Read/Write Error.\n" +
        "- eventCategory: Severity and type. 'dispense' = normal paid dispense (surface litres and flowTimeSecs). " +
        "'status' = routine health or state report — treat as informational. " +
        "'error' = anomalous or alert condition — prefix the reply line with ■ and explain the operational implication (e.g. 'Dispense Limit' means the device hit its configured threshold and cut off water flow). " +
        "'warning' = elevated attention needed. 'startup' = device power-up event.\n" +
        "- batteryVolts: Battery voltage in volts. Normal range 11.5–13.0V. If below 11.0V, flag with ■ (low battery alert). Always state range context: '12.6V (normal)' not just '12.6'.\n" +
        "- flowTicks: Pulse count from hall-effect flow meter. CONTEXT-SENSITIVE: " +
        "flowTicks=0 in an 'error' category event means the device cut off flow (not that no dispensing happened normally). " +
        "flowTicks=0 in a 'dispense' or 'status' event means genuinely no flow in that period.\n" +
        "- litres: Volume dispensed computed as flowTicks ÷ LCF calibration factor. Primary volume indicator. null if LCF is unknown.\n" +
        "- flowTimeSecs: Duration of flow in seconds.\n" +
        "- usageCounter: Cumulative lifetime dispense count on the device (monotonically increasing, never reset on power-up). Use to track usage trends.\n" +
        "- datalogPointer: Sequential log number on the device. Use to detect missing packets (gaps in sequence) or duplicate entries.\n" +
        "- fcf: Flow conversion factor as stored in the packet (ticks per credit). 65535 means prepay is disabled on this device.\n" +
        "- tagUid: 8-char hex. On standard assets: NFC tag UID of the card that triggered this event — pass to get_tag to look up the household. " +
        "On eSENSE assets (purpose='esense'): these bytes hold VSEN sensor data, not a real tag UID (see vsen1Adc below).\n" +
        "- vsen1Adc / vsen2Adc / vsen3Adc: Analogue sensor ADC readings (0–255) from uid bytes 0–2. " +
        "On eSENSE assets: VSEN1 = tank depth sensor (ADC 51 ≈ 4mA/empty, ADC 255 ≈ 20mA/full, ADC 0 = sensor off/not connected); " +
        "VSEN2 = chlorine or secondary tank sensor; VSEN3 = auxiliary sensor. " +
        "To convert ADC to depth, the configured sensor range (metres) is needed from EWC settings. " +
        "On standard (non-eSENSE) assets, these bytes are the NFC tag UID — ignore vsen1-3 and use tagUid instead.\n" +
        "- vwatAdc: Water pressure sensor ADC (rs byte). On eSENSE assets: 0 = OK/pressure active, 255 = no pressure/sensor open, other values = anomalous pressure.\n" +
        "- deviceTimeStr: Device RTC timestamp (HH:MM:SS DD/MM/YYYY). May differ from the server timestamp if the device clock is out of sync.\n" +
        "- xorValid: true = packet checksum valid. false = corrupted packet — treat decoded values as unreliable.\n" +
        "Event-specific extras: unmeteredFlowTicks (No Credit event); tamper.tamp1Open/tamp2Open (Tamper — flag ■); pressureOk (Pressure Event); " +
        "startUp.powerUpCount+firmwareDateStr (Start-Up); healthState.vbatAdcRaw/vwatAdcRaw/vsen1/vsen2/vsen3/tickAccumulatorHex/flags (Health State).\n\n" +

        "kind='ewc-reply' — Reply from device to a platform command (incoming, pipeline=MQTT/UDP). ok=true = command succeeded. " +
        "cmdName identifies the command (Get Status, Valve ON, Valve OFF, Tap Top-Up, Read SPI Log, Set Clock, Read/Write EEPROM Byte/Word, Read Tick Accumulator, Get Time, Read/Write Log Pointer, Factory Reset, Version Message). " +
        "Reply-kind-specific extras: get-status → deviceTimeStr, tagUid, batteryVolts (normal 11.5–13V), pressureOk, valveOn (true=water flowing/open, false=closed), " +
        "tamp1/tamp2 (true=■ Tamper on input 1/2), lowBattery (true=■ Battery Low), rfidDisabled (true=RFID reader off); " +
        "read-log → logNumber+logDatalog (embedded EWC datalog, same fields as above); valve-on/off/top-up → creditMits; log-pointer-read → logPointer.\n\n" +

        "kind='cmdapi' — Outgoing command record (platform→device, pipeline=CmdApi). " +
        "This is NOT data received from the device — it is a record that the platform dispatched a command. " +
        "Do NOT present a cmdapi entry as the 'last data received' or as evidence the device is online. " +
        "Fields: cmdName (same values as ewc-reply), args (command parameters).\n\n" +

        "kind='shengda-nbiot' — Shengda NB-IoT CBOR/LwM2M meter frame (incoming, pipeline=MQTT). " +
        "The 'description' field is a human-readable summary of all sensor values — use it directly in replies. " +
        "Other fields: meterReading (pulse count), prepayLitres, supplyVoltage, batteryState, valveStatus, errorCode (non-zero = ■ fault).\n\n" +

        "FIELDS TO OMIT FROM ALL REPLIES:\n" +
        "- rawPayload: Raw binary device message (hex-encoded). Internal protocol data. NEVER include rawPayload in any reply — it contains only binary data and is not meaningful to a human reader. Always use the decoded fields instead.\n" +
        "- id: Internal log database record ID. Omit unless the user explicitly asks for log IDs.\n" +
        "- source: Device IMEI. Surface as 'Device IMEI' only if the user asks to identify the source device.\n\n" +

        WHATSAPP_BOILERPLATE + "\n\n" +
        "When to call: when asked about recent device activity, last packet received, device online/offline status, NFC tap events, valve commands sent, error events, or to debug a specific dispense or error. " +
        "Where assetId comes from: primary_asset_id from get_tag, id from list_assets/get_asset, or numeric asset ID in the conversation — never guess. " +
        "What to call next: if decoded.tagUid matches a tag to investigate → get_tag(tagUid); repeated No Flow or Low Battery → get_asset_flow_rate or get_asset_ewc_settings; Shengda errorCode non-zero → get_calibration_analysis.",

      inputSchema: {
        assetId: z.string().describe("The eWater asset ID (numeric, as a string)"),
        days: z.number().int().min(1).max(30).default(7).describe("How many days of logs to fetch (1–30, default 7)"),
        limit: z.number().int().min(1).max(100).default(25).describe("Max log entries to return (1–100, default 25). Use small values (10–25) for WhatsApp replies to avoid overwhelming the conversation."),
        before: z.string().optional().describe("ISO timestamp cursor — return only entries received before this time (for paging; use the timestamp of the last entry from the previous call)"),
        protocol: z.string().optional().describe("Include only this protocol. Known values: 'Ewc2_5' (EWC meter telemetry), 'CommandApi_1' (outgoing commands), '4CCv1' (older 4CC meter), 'Gadwall'. Apply this filter server-side. Omit to return all protocols."),
        excludeProtocols: z.array(z.string()).optional().describe("Protocols to exclude from results. Known values: '4CCv1', 'Ewc2_5', 'CommandApi_1', 'Gadwall'. Applied server-side — do NOT fetch all and filter client-side. Example: ['4CCv1'] removes all 4CCv1 entries."),
      },
    },
    async ({ assetId, days, limit, before, protocol, excludeProtocols }) => {
      const credErr = requireEwaterCredentials();
      if (credErr) return errorToolResult(credErr.error);
      try {
        const page = await getAssetLogs(assetId, { days, limit, before, protocol, excludeProtocols });
        return jsonToolResult({
          assetId,
          logs: page.items,
          totalCount: page.totalCount,
          returnedCount: page.returnedCount,
          offset: page.offset,
          limit: page.limit,
          hasMore: page.hasMore,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err, assetId }, "MCP get_asset_logs failed");
        return errorToolResult(`eWater API error: ${msg}`);
      }
    },
  );

  // ─── Disbursements (Usage API — per-day aggregated dispense totals) ─────────

  server.registerTool(
    "get_disbursements_by_tag_and_asset",
    {
      title: "Get disbursements by tag and asset",
      description:
        "Returns per-day aggregated water disbursements for a specific NFC tag on a specific asset over a date window. " +
        "Each day bucket includes: estimateTotalLitres (eWater's estimated volume), totalTicks (raw flow-meter ticks), totalSeconds (total dispense duration), totalCredits (credits deducted — null means a no-credit event), readingCount (number of dispenses that day). " +
        "Also returns totalLitres and totalReadings as period-level summaries. " +
        "Use this to answer 'how much water did household X collect from tap Y this month?' or to compare a household's usage at a specific tap. " +
        SINGLE_ITEM_WHATSAPP,
      inputSchema: {
        nfcId: z.string().describe("NFC tag ID (hex, e.g. 'A7370000'). Case-insensitive."),
        assetId: z.union([z.string(), z.number()]).describe("Asset ID of the dispenser/tap."),
        days: z.number().int().min(1).max(365).default(30).describe("Number of days to look back (default 30, max 365)."),
      },
    },
    async ({ nfcId, assetId, days }) => {
      const credErr = requireEwaterCredentials();
      if (credErr) return errorToolResult(credErr.error);
      try {
        const result = await getDisbursementsByTagAndAsset(nfcId, assetId, days ?? 30);
        return jsonToolResult(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err, nfcId, assetId }, "MCP get_disbursements_by_tag_and_asset failed");
        return errorToolResult(`eWater API error: ${msg}`);
      }
    },
  );

  server.registerTool(
    "get_disbursements_by_tag",
    {
      title: "Get disbursements by tag",
      description:
        "Returns per-day aggregated water disbursements for a specific NFC tag across ALL assets over a date window. " +
        "Each day bucket includes: estimateTotalLitres, totalTicks, totalSeconds, totalCredits (null = no-credit event), readingCount. " +
        "Also returns totalLitres and totalReadings as period-level summaries. " +
        "Use this to answer 'how much water has household X used in total this month across all taps?' " +
        "If the tag was used at multiple taps on the same day, their volumes are summed into a single daily bucket. " +
        SINGLE_ITEM_WHATSAPP,
      inputSchema: {
        nfcId: z.string().describe("NFC tag ID (hex, e.g. 'A7370000'). Case-insensitive."),
        days: z.number().int().min(1).max(365).default(30).describe("Number of days to look back (default 30, max 365)."),
      },
    },
    async ({ nfcId, days }) => {
      const credErr = requireEwaterCredentials();
      if (credErr) return errorToolResult(credErr.error);
      try {
        const result = await getDisbursementsByTag(nfcId, days ?? 30);
        return jsonToolResult(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err, nfcId }, "MCP get_disbursements_by_tag failed");
        return errorToolResult(`eWater API error: ${msg}`);
      }
    },
  );

  server.registerTool(
    "get_disbursements_by_asset",
    {
      title: "Get disbursements by asset",
      description:
        "Returns per-day aggregated water disbursements from a specific asset (tap/dispenser) across ALL NFC tags over a date window. " +
        "Each day bucket includes: estimateTotalLitres (total volume dispensed that day), totalTicks, totalSeconds, totalCredits (null = no-credit events), readingCount (total number of individual dispenses). " +
        "Also returns totalLitres and totalReadings as period-level summaries. " +
        "Use this to answer 'how much water was dispensed from tap X this month?' or 'how many people collected water from this asset today?' " +
        SINGLE_ITEM_WHATSAPP,
      inputSchema: {
        assetId: z.union([z.string(), z.number()]).describe("Asset ID of the dispenser/tap."),
        days: z.number().int().min(1).max(365).default(30).describe("Number of days to look back (default 30, max 365)."),
      },
    },
    async ({ assetId, days }) => {
      const credErr = requireEwaterCredentials();
      if (credErr) return errorToolResult(credErr.error);
      try {
        const result = await getDisbursementsByAsset(assetId, days ?? 30);
        return jsonToolResult(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err, assetId }, "MCP get_disbursements_by_asset failed");
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
