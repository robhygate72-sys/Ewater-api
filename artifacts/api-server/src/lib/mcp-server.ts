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
  listAssets,
  getAssetEwcSettings,
  getAssetFlowRate,
  getAssetEsenseCharts,
  getCalibrationAnalysis,
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
    "list_assets",
    {
      title: "List eWater assets",
      description:
        "Lists all eWater assets (dispensers/taps) visible to the configured account, including id, name, type, status, location, and water system/country grouping.",
      inputSchema: {},
    },
    async () => {
      const credErr = requireEwaterCredentials();
      if (credErr) return errorToolResult(credErr.error);
      try {
        const assets = await listAssets();
        return jsonToolResult({ assets, count: assets.length });
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
        "Returns time-series history for one eWater asset over the last N days: tank height (water/chlorine), daily water inflow, battery voltage history + status, and dispense flow-rate history.",
      inputSchema: {
        assetId: z.string().describe("The eWater asset ID"),
        days: z.number().int().min(1).max(180).default(7).describe("Number of days of history to return (1-180, default 7)"),
      },
    },
    async ({ assetId, days }) => {
      const credErr = requireEwaterCredentials();
      if (credErr) return errorToolResult(credErr.error);
      try {
        const charts = await getAssetEsenseCharts(assetId, days ?? 7);
        const { dispenseVolumes: _dispenseVolumes, ...history } = charts;
        return jsonToolResult({ assetId, days: days ?? 7, ...history });
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
        "Returns the electronic water controller (EWC) device settings for one asset: flow conversion factor (FCF), litres conversion factor (LCF), currency conversion (FX), preload charge, price of water, and other device configuration values.",
      inputSchema: {
        assetId: z.string().describe("The eWater asset ID"),
      },
    },
    async ({ assetId }) => {
      const credErr = requireEwaterCredentials();
      if (credErr) return errorToolResult(credErr.error);
      try {
        const settings = await getAssetEwcSettings(assetId);
        return jsonToolResult({ assetId, ...settings });
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
        "Returns the most recent dispense flow rate (litres/minute) for one asset, derived from the last 24 hours of device logs.",
      inputSchema: {
        assetId: z.string().describe("The eWater asset ID"),
      },
    },
    async ({ assetId }) => {
      const credErr = requireEwaterCredentials();
      if (credErr) return errorToolResult(credErr.error);
      try {
        const result = await getAssetFlowRate(assetId);
        return jsonToolResult({ assetId, ...result });
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
        "Runs a calibration and non-revenue-water (NRW) gap analysis for one asset over the last N days. Compares the configured litres-conversion factor (LCF) against the typical dispense volume derived from a KDE of dispense events (assumed to cluster around a true 20L fill), and compares the configured preload against the measured preload from 'no credit' events. Returns the LCF gap %, preload gap, and a plain-language interpretation of likely meter drift / under- or over-reading.",
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
        return jsonToolResult(analysis);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err, assetId }, "MCP get_calibration_analysis failed");
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
