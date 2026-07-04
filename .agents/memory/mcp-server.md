---
name: Remote MCP server pattern
description: How to add a bearer-protected, stateless Streamable HTTP MCP server alongside an existing Express REST API without duplicating business logic.
---

## Pattern

- Extract shared business logic (data fetching, computed insights) into one lib module. Both REST routes and MCP tools call into it — never duplicate logic inline in a route handler or tool handler.
- Run the MCP server in **stateless** mode: `sessionIdGenerator: undefined`, and create a fresh `McpServer` + `StreamableHTTPServerTransport` per incoming request (don't try to reuse/cache a single server instance across requests). This avoids session-lifecycle bookkeeping (init/close tracking, session ID storage) that's unnecessary for a tool-only server with no server-initiated notifications.
- Mount the MCP endpoint on all three methods the Streamable HTTP spec uses — `POST`, `GET`, `DELETE` — pointed at the same handler; the transport internally branches on method.
- Mount the MCP route(s) *before* the general API router if paths could otherwise collide, and after body-parsing middleware (`express.json()`) since the SDK expects the already-parsed body passed into `transport.handleRequest(req, res, req.body)`.
- Gate every request with a bearer-token check (compare `Authorization: Bearer <token>` against an env secret) before constructing the transport; return a JSON-RPC formatted 401 error (`{jsonrpc:"2.0", error:{code:-32001,...}, id:null}`) on failure, not a plain HTTP 401 body.

**Why:** keeps the MCP surface as a thin adapter over the same insights module used by the REST API, so the two can never drift, and avoids the complexity of stateful session management when the tool has no need for server push or resumable streams.

**How to apply:** when adding a new remote-tool-callable capability (MCP, or a similar tool-calling protocol) to an existing Express API, follow this same shared-lib-plus-thin-adapter shape rather than building the tool logic directly into the transport layer.
