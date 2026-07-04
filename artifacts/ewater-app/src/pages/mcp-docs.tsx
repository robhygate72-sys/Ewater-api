import { Droplets, Terminal, Lock, Wrench, AlertTriangle } from "lucide-react";
import { useMemo } from "react";

interface ToolDoc {
  name: string;
  summary: string;
  inputs: { name: string; type: string; note: string }[];
}

const TOOLS: ToolDoc[] = [
  {
    name: "list_countries",
    summary:
      "Lists all countries in the eWater entity hierarchy (Country \u2192 Organisation \u2192 Water System \u2192 Asset), with organisation/water-system/asset counts under each. Top of the drill-down chain.",
    inputs: [],
  },
  {
    name: "list_organisations",
    summary:
      "Lists organisations in the hierarchy, optionally filtered by country. Each entry includes its water-system/asset counts.",
    inputs: [
      { name: "countryId", type: "number", note: "optional" },
      { name: "countryName", type: "string", note: "optional" },
    ],
  },
  {
    name: "list_water_systems",
    summary:
      "Lists water systems in the hierarchy, optionally filtered by organisation and/or country. Each entry includes its parent org/country and asset count.",
    inputs: [
      { name: "organisationId", type: "number", note: "optional" },
      { name: "organisationName", type: "string", note: "optional" },
      { name: "countryId", type: "number", note: "optional" },
      { name: "countryName", type: "string", note: "optional" },
    ],
  },
  {
    name: "list_assets",
    summary:
      "Lists eWater assets (dispensers/taps) visible to the configured account, including id, name, type, status, location, and water system/country grouping. Paginated and filterable by status, water system, organisation, or country.",
    inputs: [
      { name: "limit", type: "number", note: "1-100, default 50" },
      { name: "offset", type: "number", note: "default 0" },
      { name: "status", type: "string", note: "optional" },
      { name: "waterSystemId", type: "number", note: "optional" },
      { name: "waterSystemName", type: "string", note: "optional" },
      { name: "organisationId", type: "number", note: "optional" },
      { name: "organisationName", type: "string", note: "optional" },
      { name: "countryId", type: "number", note: "optional" },
      { name: "countryName", type: "string", note: "optional" },
    ],
  },
  {
    name: "get_asset_history",
    summary:
      "Time-series history for one asset over the last N days: tank height (water/chlorine), daily water inflow, battery voltage + status, and dispense flow-rate history. Each series is paginated independently.",
    inputs: [
      { name: "assetId", type: "string", note: "required" },
      { name: "days", type: "number", note: "1-180, default 7" },
      { name: "limit", type: "number", note: "1-2000, default 500" },
      { name: "offset", type: "number", note: "default 0" },
    ],
  },
  {
    name: "get_asset_ewc_settings",
    summary:
      "Electronic water controller (EWC) device settings for one asset: flow conversion factor (FCF), litres conversion factor (LCF), currency conversion (FX), preload charge, price of water, and other configuration values.",
    inputs: [{ name: "assetId", type: "string", note: "required" }],
  },
  {
    name: "get_asset_flow_rate",
    summary:
      "The most recent dispense flow rate (litres/minute) for one asset, derived from the last 24 hours of device logs.",
    inputs: [{ name: "assetId", type: "string", note: "required" }],
  },
  {
    name: "get_calibration_analysis",
    summary:
      "Calibration / non-revenue-water (NRW) gap analysis for one asset over the last N days: compares configured LCF against the typical dispense volume, and configured preload against measured preload, returning gap % and a plain-language interpretation.",
    inputs: [
      { name: "assetId", type: "string", note: "required" },
      { name: "days", type: "number", note: "1-180, default 30" },
    ],
  },
];

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="bg-slate-900 text-slate-100 text-[12px] leading-relaxed rounded-lg p-4 overflow-x-auto whitespace-pre">
      <code>{children}</code>
    </pre>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-primary">{icon}</span>
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      </div>
      <div className="space-y-3 text-[15px] leading-relaxed text-foreground/90">{children}</div>
    </section>
  );
}

export default function McpDocsPage() {
  const mcpUrl = useMemo(() => {
    if (typeof window === "undefined") return "https://your-domain/api/mcp";
    return `${window.location.origin}/api/mcp`;
  }, []);

  const configSnippet = `{
  "mcpServers": {
    "ewater-monitor": {
      "url": "${mcpUrl}",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN_HERE"
      }
    }
  }
}`;

  const curlSnippet = `curl -X POST ${mcpUrl} \\
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list"
  }'`;

  const callSnippet = `{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "get_calibration_analysis",
    "arguments": { "assetId": "2227", "days": 30 }
  }
}`;

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="border-b border-border bg-primary text-primary-foreground">
        <div className="max-w-3xl mx-auto px-6 py-8">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-primary-foreground/15 flex items-center justify-center shrink-0">
              <Droplets className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">eWater Monitor MCP Server</h1>
              <p className="text-primary-foreground/80 text-sm mt-0.5">
                Developer documentation for connecting external tools and LLM clients
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10">
        <Section icon={<Terminal className="w-5 h-5" />} title="Overview">
          <p>
            This project exposes a remote{" "}
            <a
              href="https://modelcontextprotocol.io"
              target="_blank"
              rel="noreferrer"
              className="text-primary underline underline-offset-2"
            >
              Model Context Protocol (MCP)
            </a>{" "}
            server over Streamable HTTP. Any MCP-compatible client — Claude, another one of your apps, or a custom
            integration — can connect to it and call tools that read live eWater asset data and derived
            calibration / non-revenue-water (NRW) insights, without needing to talk to the eWater API directly.
          </p>
          <p>
            The server is stateless: every request is handled independently, there is no session to keep alive, and
            all responses are read-only (no tools can change device settings or issue commands).
          </p>
        </Section>

        <Section icon={<Lock className="w-5 h-5" />} title="Endpoint & Authentication">
          <p>The MCP endpoint speaks JSON-RPC 2.0 over HTTP and supports POST, GET, and DELETE:</p>
          <CodeBlock>{mcpUrl}</CodeBlock>
          <p>
            Every request must include a bearer token in the <code className="text-sm bg-muted px-1.5 py-0.5 rounded">Authorization</code> header.
            Requests without a valid token receive a <code className="text-sm bg-muted px-1.5 py-0.5 rounded">401</code> JSON-RPC error.
          </p>
          <CodeBlock>{`Authorization: Bearer YOUR_TOKEN_HERE`}</CodeBlock>
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-4 py-3 text-sm">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              The token itself is not published here. Ask the project owner for your access token — it is a shared
              secret separate from any eWater account credentials.
            </span>
          </div>
        </Section>

        <Section icon={<Terminal className="w-5 h-5" />} title="Quick start">
          <p>Minimal example using an MCP client config (e.g. Claude Desktop / any remote-MCP-capable client):</p>
          <CodeBlock>{configSnippet}</CodeBlock>
          <p>Or call it directly over HTTP to list the available tools:</p>
          <CodeBlock>{curlSnippet}</CodeBlock>
          <p>Example tool call:</p>
          <CodeBlock>{callSnippet}</CodeBlock>
        </Section>

        <Section icon={<Wrench className="w-5 h-5" />} title="Available tools">
          <div className="space-y-4">
            {TOOLS.map((tool) => (
              <div key={tool.name} className="border border-border rounded-lg p-4 bg-card">
                <div className="font-mono text-sm font-semibold text-primary mb-1.5">{tool.name}</div>
                <p className="text-sm text-foreground/80 mb-2">{tool.summary}</p>
                {tool.inputs.length > 0 ? (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted-foreground border-b border-border">
                        <th className="py-1 pr-4 font-medium">Parameter</th>
                        <th className="py-1 pr-4 font-medium">Type</th>
                        <th className="py-1 font-medium">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tool.inputs.map((input) => (
                        <tr key={input.name} className="border-b border-border/60 last:border-0">
                          <td className="py-1.5 pr-4 font-mono">{input.name}</td>
                          <td className="py-1.5 pr-4 text-muted-foreground">{input.type}</td>
                          <td className="py-1.5 text-muted-foreground">{input.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-xs text-muted-foreground italic">No parameters.</p>
                )}
              </div>
            ))}
          </div>
        </Section>

        <Section icon={<AlertTriangle className="w-5 h-5" />} title="Notes & limits">
          <ul className="list-disc pl-5 space-y-1.5 text-[14px]">
            <li>All tools are read-only — there is no way to change device settings or issue commands through this endpoint.</li>
            <li>Responses are structured JSON, returned both as a text content block and as <code className="text-xs bg-muted px-1 py-0.5 rounded">structuredContent</code> for clients that support it.</li>
            <li>
              Every tool response uses the same pagination envelope: <code className="text-xs bg-muted px-1 py-0.5 rounded">totalCount</code>,{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">returnedCount</code>,{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">offset</code>,{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">limit</code>, and{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">hasMore</code>. List tools return their items under a named array field (e.g.{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">assets</code>); single-object tools (<code className="text-xs bg-muted px-1 py-0.5 rounded">get_asset_ewc_settings</code>,{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">get_asset_flow_rate</code>,{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">get_calibration_analysis</code>) return the result under{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">data</code> with <code className="text-xs bg-muted px-1 py-0.5 rounded">totalCount</code>/<code className="text-xs bg-muted px-1 py-0.5 rounded">returnedCount</code> fixed at 1 and{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">hasMore</code> fixed at false.
            </li>
            <li><code className="text-xs bg-muted px-1 py-0.5 rounded">get_asset_history</code> paginates each time-series (tankHeight, dailyInflow, voltageHistory, flowRateHistory) independently using the same envelope.</li>
            <li>Use <code className="text-xs bg-muted px-1 py-0.5 rounded">totalCount</code> from <code className="text-xs bg-muted px-1 py-0.5 rounded">list_assets</code> to answer "how many" questions directly, without paging through every result.</li>
            <li>If the server has no eWater account credentials configured, tool calls will return an explicit error rather than fabricated data.</li>
            <li>The server is stateless — do not rely on session IDs or server-initiated notifications between calls.</li>
          </ul>
        </Section>
      </main>

      <footer className="border-t border-border">
        <div className="max-w-3xl mx-auto px-6 py-6 text-xs text-muted-foreground">
          eWater Monitor — Remote MCP server documentation
        </div>
      </footer>
    </div>
  );
}
