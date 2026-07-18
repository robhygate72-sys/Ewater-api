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
        "Returns all eWater assets (taps/dispensers) visible to this account. Each item includes: id (numeric asset ID), name, asset type, status, GPS location, water system name, and country name. When to call: when a user asks to list all taps, find an asset by name or location, count assets, or find an asset ID when only the name is known. Do NOT call this if you already have a numeric asset ID (e.g. primary_asset_id from get_tag) — call get_asset directly instead. Paginated: max 100 per call, default 50; totalCount is the true total across all pages. To scope to a location, pass waterSystemName/waterSystemId (resolve via list_water_systems if needed) instead of paging through everything. What to call next: use the id from any result as assetId for get_asset, get_asset_history, get_asset_flow_rate, get_asset_ewc_settings, or get_calibration_analysis.",
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
    "get_asset",
    {
      title: "Get asset by ID",
      description:
        "Returns full details for one eWater asset given its numeric ID: asset name, asset type (e.g. CommunityTap), status (Active/Inactive), GPS coordinates, water system name, and country name. When to call: when a user asks 'what water system does this tag/household use?', 'what tap is asset ID X?', or any question needing details about a specific asset. Call this after get_tag using primary_asset_id as the input. Where assetId comes from: the primary_asset_id field returned by get_tag, or the id field from list_assets. Never guess the water system name, country, or asset type — this tool returns the real values. Response uses the standard single-item envelope with the asset record under `data`.",
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
        "Returns time-series history for one eWater asset over the last N days (1–180, default 7). Includes: tank water and chlorine height over time, daily water inflow volume, battery voltage history and charge status, and dispense flow-rate history. When to call: when asked about asset performance over time, water levels, tank fill history, battery health trends, or historical flow rates for a specific tap or dispenser. Where assetId comes from: the primary_asset_id field from get_tag, the id field from list_assets or get_asset, or a numeric asset ID mentioned in the conversation — never guess the assetId. Each time-series (tankHeight, dailyInflow, voltageHistory, flowRateHistory) is independently paginated with the standard envelope; use limit/offset to page through long ranges.",
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
        "Returns the EWC (electronic water controller) configuration for one eWater asset: flow conversion factor (FCF), litres conversion factor (LCF), currency/FX settings, preload charge, price per litre, and other device configuration values. When to call: when asked about pricing, how much water a credit buys, device configuration, preload settings, or calibration factors for a specific tap or dispenser. Where assetId comes from: the primary_asset_id field from get_tag, the id field from list_assets or get_asset, or a numeric asset ID mentioned in the conversation — never guess the assetId. Response uses the standard single-item envelope with settings under `data`.",
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
        "Returns the most recent dispense flow rate in litres/minute for one eWater asset, calculated from the last 24 hours of device logs. When to call: when asked 'is the tap flowing properly?', 'what is the current flow rate?', 'how fast is water dispensing?', or any question about live dispensing performance for a specific asset. Where assetId comes from: the primary_asset_id field from get_tag, the id field from list_assets or get_asset, or a numeric asset ID mentioned in the conversation — never guess the assetId. Response uses the standard single-item envelope with the result under `data`.",
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
        "Runs a calibration and non-revenue-water (NRW) gap analysis for one eWater asset over N days (1–180, default 30). Compares the configured litres-conversion factor (LCF) against measured dispense events to detect meter drift. Compares configured preload against actual 'no credit' event data. Returns: LCF gap %, preload gap, and a plain-language summary of whether the meter is over-reading or under-reading. When to call: when asked about NRW, meter drift, calibration accuracy, revenue loss, or whether LCF or preload settings are correct for a specific tap. Where assetId comes from: the primary_asset_id field from get_tag, the id field from list_assets or get_asset, or a numeric asset ID mentioned in the conversation — never guess the assetId. Response uses the standard single-item envelope with the analysis under `data`.",
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
        "Lists all fully-registered NFC tag IDs for one eWater water system (registered = tag has a household record and has completed sign-up). Use `list_water_systems` first to get a `waterSystemId`. Response uses the standard pagination envelope; `totalCount` is the true fleet size for that system — use it to answer 'how many registered users?' questions directly without fetching all pages. What to call next: pass any nfcId from this list to `get_tag` to look up that tag's registration details, credit balance, and household.",
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
    "get_tag",
    {
      title: "Get NFC tag",
      description:
        "Looks up an NFC water tag by its short tag ID (e.g. DBDA4ED2). Returns: primary_asset_id (numeric), primary_system_id (numeric), primary_country_id (numeric), household_id (UUID), sign-up date, last usage date, disbursement count, top-up count, credit balance, deleted status, blacklisted status. When to call: any time a user mentions a tag ID or asks about a specific NFC tag, household, or registered water user. This is always the starting point — call this first. What to call next with the result: for the tap/dispenser name and water system name → get_asset(assetId = primary_asset_id); for the household name → get_household(householdId = household_id). Never guess the household name, water system name, or country from the IDs returned — always resolve them via the appropriate follow-up tool call. Response uses the standard single-item envelope with the tag record under `data`.",
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
        "Alias for get_tag — prefer get_tag for new calls. Looks up an NFC water tag by its short tag ID. Returns primary_asset_id, household_id, credit balance, dispense/top-up counts, and status flags. What to call next: get_asset(primary_asset_id) for the tap name and water system; get_household(household_id) for the household name. Never guess the water system name or household name from IDs — always resolve via follow-up tool.",
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
        "Returns the registered household name and details for a given household UUID: household name, creation date, last-active date, and the linked asset and system IDs. When to call: after get_tag, when the user asks 'who is this tag registered to?', 'what is the household name?', or 'whose account is this?'. Where householdId comes from: the household_id field returned by get_tag. Never guess the household name — always call this tool when you have a household_id from a tag lookup. Phone number, address, and GPS coordinates are absent — removed by eWater per data-protection policy. Response uses the standard single-item envelope with the household record under `data`.",
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
        "Alias for get_household — prefer get_household for new calls. Returns the registered household name and details for a given household UUID. Where householdId comes from: the household_id field from get_tag. Never guess the household name — always call this tool when you have a household_id. Response uses the standard single-item envelope with the household record under `data`.",
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

  server.registerTool(
    "get_asset_logs",
    {
      title: "Get asset logs (decoded packets)",
      description:
        "Returns recent device communication logs for one eWater asset, with every packet fully decoded by protocol. Each log entry includes a `decoded` object whose `kind` field identifies the protocol and determines which fields are present:\n\n" +
        "kind='ewc-datalog' — EWC 2.5 DATALOG packet (39 bytes, header 0x44). Fields: eventName (one of: No Error/Dispense, No Credit, Format-ID Fail, Not Mifare 1k, Keycode Load Error, Card Comms Error, Auth Error CRYPTO1, Format-Checksum Fail, EEPROM Write Error Int/Ext, Tag Removed, RS232 Command Error, Dispense Limit, MFRC Chip Error, Block Read/Write Error, No Flow, Prox Detect, Low Battery, Pressure Event, SuperTap Top-Up, Host Valve Off, Start-Up, No Flow Repeat, Tamper, Health State), eventCategory (dispense/error/warning/status/startup), deviceTimeStr (device RTC time HH:MM:SS DD/MM/YYYY), tagUid (8-char hex NFC tag UID), batteryVolts, flowTicks, litres (flowTicks÷LCF — null when LCF unknown), flowTimeSecs, creditUsedMits, startCreditMits, endCreditMits, fcf (flow conversion factor), xorValid. Event-specific extras: unmeteredFlowTicks (No Credit event); tamper.tamp1Open/tamp2Open (Tamper event); pressureOk (Pressure event); startUp.powerUpCount + startUp.firmwareDateStr (Start-Up event); healthState.vbatAdcRaw/vwatAdcRaw/vsen1/vsen2/vsen3/tickAccumulatorHex/flags (valveOn, lowBattery, tamper1, tamper2, gsmNotLocked, rfidDisabled, proxFlag, lockFlag) for Health State event.\n\n" +
        "kind='ewc-reply' — EWC reply from the device (0x80 success / 0x88 error). Fields: ok (true=success), cmdName (e.g. Get Status, Valve ON, Valve OFF, Tap Top-Up, Read SPI Log, Set Clock, Read/Write EEPROM Byte/Word, Read Tick Accumulator, Get Time, Read/Write Log Pointer, Factory Reset, Version Message), xorValid, replyKind. Reply-kind-specific extras: get-status → deviceTimeStr, tagUid, batteryVolts, pressureOk, valveOn, tamp1, tamp2, lowBattery, rfidDisabled, flowCount, samplePeriodMs; read-log → logNumber + logDatalog (fully decoded EWC datalog embedded in the reply); valve-on/valve-off/top-up → creditMits; eeprom-read/eeprom-word-read → eepromAddr, eepromValue; tick-accumulator → tickAccHex; get-time → deviceTimeStr; log-pointer-read → logPointer.\n\n" +
        "kind='cmdapi' — CommandApi outgoing command (base64 JSON wrapper). Fields: cmdName (same command names as ewc-reply), outgoingPipeline, priority, retry, args (object whose shape depends on cmdName: credit → creditMits; read-log → logNumber; set-clock → timeStr; eeprom-read → addr; eeprom-write → addr+value; eeprom-word-write → addr+value; log-pointer-write → pointer).\n\n" +
        "kind='shengda-nbiot' — Shengda NB-IoT CBOR/LwM2M meter frame. Fields: valid (CRC check), messageType, messageFunction, meterReading (pulse count), prepayLitres, supplyVoltage, batteryState, valveStatus, signalPower, signalSnr, errorCode, magneticAttack, description (human-readable summary of all fields).\n\n" +
        "decoded is null for unknown or undecipherable payloads (rawPayload still present for inspection).\n\n" +
        "When to call: when asked about recent device activity, last packet received, whether a device is online/transmitting, NFC tap events, valve commands sent, meter readings, battery health in raw logs, or to debug a specific dispense or error event. " +
        "Where assetId comes from: the primary_asset_id field from get_tag, the id field from list_assets or get_asset, or a numeric asset ID mentioned in the conversation — never guess. " +
        "What to call next: if decoded.tagUid matches a tag you want to investigate → get_tag(tagUid); if logs show repeated No Flow or Low Battery events → get_asset_flow_rate or get_asset_ewc_settings; if Shengda errorCode is non-zero → get_calibration_analysis.",
      inputSchema: {
        assetId: z.string().describe("The eWater asset ID (numeric, as a string)"),
        days: z.number().int().min(1).max(30).default(7).describe("How many days of logs to fetch (1–30, default 7)"),
        limit: z.number().int().min(1).max(100).default(50).describe("Max log entries to return (1–100, default 50)"),
        before: z.string().optional().describe("ISO timestamp cursor — return only entries received before this time (for paging; use the timestamp of the last entry from the previous call)"),
        protocol: z.string().optional().describe("Filter by protocol name (e.g. Ewc2_5, CmdApi, 4CCv1) — omit to return all protocols"),
      },
    },
    async ({ assetId, days, limit, before, protocol }) => {
      const credErr = requireEwaterCredentials();
      if (credErr) return errorToolResult(credErr.error);
      try {
        const page = await getAssetLogs(assetId, { days, limit, before, protocol });
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
