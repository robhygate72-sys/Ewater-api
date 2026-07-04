# eWater MCP Server — Recommended Changes for Pagination & Filtering

## Background

The WA Admin dashboard's WhatsApp AI agent ("Tapha") connects to the eWater
MCP server (`https://ewater-api-tests.replit.app/api/mcp`) to answer
questions about eWater assets. Investigation of a production incident
("Tapha goes silent when asked about eWater data") traced the root cause to
the `list_assets` tool: it has no pagination or filtering parameters, so it
always returns the full asset list in one response. With enough assets, this
payload is large enough to push the AI agent's conversation past its LLM
provider's context window limit, causing the request to fail outright.

The WA Admin side already has a client-side mitigation (summarizing
oversized tool results into a total count + bounded sample), but the
proper, non-lossy fix is for the eWater MCP server to support real
pagination and filtering. This document specifies the recommended changes.

## Current state

`list_assets` tool schema (as registered today):

```json
{
  "name": "list_assets",
  "description": "Lists all eWater assets (dispensers/taps) visible to the configured account, including id, name, type, status, location, and water system/country grouping.",
  "inputSchema": {
    "type": "object",
    "properties": {}
  }
}
```

No `limit`, `offset`, `cursor`, or filter parameters exist. The response
returns every asset in a single call, with no way to request a subset.

The other four tools (`get_asset_history`, `get_asset_ewc_settings`,
`get_asset_flow_rate`, `get_calibration_analysis`) are already scoped to a
single `assetId` per call and are not affected by this issue.

## Recommended changes

### 1. Add pagination parameters to `list_assets`

```json
{
  "type": "object",
  "properties": {
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 100,
      "default": 50,
      "description": "Max number of assets to return per call (1-100, default 50)"
    },
    "cursor": {
      "type": "string",
      "description": "Opaque pagination cursor from a previous call's nextCursor. Omit for the first page."
    }
  },
  "additionalProperties": false
}
```

**Cursor-based vs. offset-based:** prefer cursor-based pagination if the
asset list can change between calls (added/removed assets), since
offset-based pagination can skip or duplicate records under concurrent
writes. If the asset list is largely static, offset-based pagination
(`offset`/`limit`) is simpler to implement and acceptable.

### 2. Wrap the response with pagination metadata

Whatever the current response shape is (bare array or `{ assets: [...] }`),
change it to:

```json
{
  "assets": [ /* up to `limit` items for this page */ ],
  "totalCount": 1350,
  "returnedCount": 50,
  "nextCursor": "eyJvZmZzZXQiOjUwfQ==",
  "hasMore": true
}
```

`totalCount` is the most important field for the agent's use case — it lets
the model answer "how many assets are there" accurately from a single call,
without needing to page through the entire list.

### 3. Add filter parameters

The tool description already references type, status, location, and water
system/country grouping. Expose these as filters so the agent can request
exactly what it needs instead of pulling everything and filtering
client-side:

```json
{
  "status": {
    "type": "string",
    "enum": ["active", "inactive"],
    "description": "Filter by asset status"
  },
  "waterSystem": {
    "type": "string",
    "description": "Filter by water system name"
  },
  "country": {
    "type": "string",
    "description": "Filter by country"
  }
}
```

(Adjust the `status` enum to match the actual values used in the system.)

### 4. Consider a dedicated `count_assets` tool

If "how many assets" / "how many active assets" is a common question
pattern, a lightweight tool that returns only aggregated counts avoids the
pagination dance entirely for that use case:

```json
{
  "totalCount": 1350,
  "byStatus": { "active": 1200, "inactive": 150 },
  "byCountry": { "Kenya": 800, "Uganda": 550 }
}
```

This is the cheapest and fastest option for count-style questions
specifically.

### 5. Update the tool description to teach the model how to use the new parameters

MCP tool descriptions double as instructions to the LLM on how to call the
tool. Be explicit about the new capabilities, for example:

> "Lists eWater assets, paginated (max 100 per call). Use `limit`/`cursor`
> to page through results. The response's `totalCount` is the true total
> across all pages — use it directly to answer 'how many' questions
> without needing to fetch every page. Use `status`/`waterSystem`/`country`
> filters to narrow results instead of paging through everything."

Without this, the model may still try to page through the entire list even
when a single call with `totalCount` (or the dedicated count tool) would
answer the question.

### 6. Apply the same pattern to any future unbounded-list tools

Only `list_assets` is unbounded today. If new listing-style tools are added
later (e.g. "list dispense events"), design pagination, filtering, and a
`totalCount`-style aggregate in from the start rather than retrofitting
after a similar incident.

## Why this matters (impact if left unchanged)

- Large `list_assets` responses can, on their own or combined with other
  tool calls in the same conversation, exceed the LLM's context window and
  cause the entire agent turn to fail silently from the user's perspective.
- Client-side truncation (implemented as a stopgap on the WA Admin side) is
  inherently lossy: it can only approximate a count via a sample rather
  than guarantee full accuracy, and cannot answer questions about specific
  assets outside the sampled subset.
- Proper server-side pagination and filtering removes the need for lossy
  client-side workarounds and lets the agent answer both aggregate
  ("how many") and specific ("tell me about asset X") questions accurately
  and cheaply.
