import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchUdpModemHealth,
  getAssetUdpHealth,
  isValidImei,
  parseUdpModemHealthHtml,
  summariseUdpCommunications,
} from "./udp-modem-health.ts";

const IMEI_1 = "869595067003870";
const IMEI_2 = "867997060000001";

test("validates canonical 15-digit IMEIs", () => {
  assert.equal(isValidImei(IMEI_1), true);
  assert.equal(isValidImei("123"), false);
  assert.equal(isValidImei("86959506700387x"), false);
});

test("parses recognised modem health fields from table HTML", () => {
  const result = parseUdpModemHealthHtml(
    IMEI_1,
    `<html><body><table>
      <tr><th>IMEI</th><td>${IMEI_1}</td></tr>
      <tr><th>Last Sync</th><td>2026-08-20 08:00:00 UTC</td></tr>
      <tr><th>Network Operator</th><td>Safaricom</td></tr>
      <tr><th>Modem Firmware Version</th><td>2.7.1</td></tr>
      <tr><th>ICCID</th><td>8925402000000000001</td></tr>
      <tr><th>RSRP</th><td>-91 dBm</td></tr>
    </table></body></html>`,
    "2026-08-20T08:05:00.000Z",
  );

  assert.equal(result.fetchStatus, "success");
  assert.equal(result.lastSyncAt, "2026-08-20T08:00:00.000Z");
  assert.equal(result.network, "Safaricom");
  assert.equal(result.firmwareVersion, "2.7.1");
  assert.equal(result.iccid, "8925402000000000001");
  assert.equal(result.signal, "-91 dBm");
});

test("scrapes the live UDP definition-list page format", () => {
  const result = parseUdpModemHealthHtml(
    IMEI_1,
    `<html><body><dl>
      <dt>Found: True</dt><dd>'true' when the modem exists</dd>
      <dt>Last sync date time: 2026-08-20 08:16:52 (8.8 min ago)</dt><dd>Most recent message</dd>
      <dt>Server ledger lag: 2</dt><dd>Entries waiting to be confirmed</dd>
      <dt>ICCID: 8999922102090180625</dt><dd>Most recent SIM id</dd>
      <dt>IMEI: ${IMEI_1}</dt><dd>Unique modem identifier</dd>
      <dt>Endpoint: 37.220.2.4:63452</dt><dd>Last network address</dd>
      <dt>Network: 0,0,&quot;Safaricom&quot;,7</dt><dd>Last network provider</dd>
      <dt>Last reported ESP32 firmware: 28</dt><dd>Current modem firmware</dd>
    </dl></body></html>`,
    "2026-08-20T08:25:00.000Z",
  );

  assert.equal(result.fetchStatus, "success");
  assert.equal(result.lastSyncAt, "2026-08-20T08:16:52.000Z");
  assert.equal(result.network, '0,0,"Safaricom",7');
  assert.equal(result.firmwareVersion, "28");
  assert.equal(result.iccid, "8999922102090180625");
  assert.equal(result.endpoint, "37.220.2.4:63452");
  assert.equal(result.serverLedgerLag, 2);
});

test("uses the public UDP health/imei endpoint without API-key headers", async () => {
  let requestedUrl = "";
  let requestedHeaders;
  const result = await fetchUdpModemHealth(IMEI_1, {
    useCache: false,
    fetchImpl: async (url, init) => {
      requestedUrl = String(url);
      requestedHeaders = init?.headers;
      return new Response(
        `<dl><dt>IMEI: ${IMEI_1}</dt><dd>id</dd><dt>Network: Safaricom</dt><dd>network</dd></dl>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    },
  });

  assert.equal(requestedUrl, `https://udp.ewater.io/api/health/imei/${IMEI_1}`);
  assert.deepEqual(requestedHeaders, { Accept: "text/html" });
  assert.equal(result.fetchStatus, "success");
});

test("rejects malformed and mismatched HTML without fabricating data", () => {
  const malformed = parseUdpModemHealthHtml(IMEI_1, "<html><body>hello</body></html>");
  assert.equal(malformed.fetchStatus, "invalid_response");
  assert.equal(malformed.lastSyncAt, null);

  const mismatched = parseUdpModemHealthHtml(
    IMEI_1,
    `<table><tr><th>IMEI</th><td>${IMEI_2}</td></tr><tr><th>Network</th><td>LTE</td></tr></table>`,
  );
  assert.equal(mismatched.fetchStatus, "invalid_response");
  assert.equal(mismatched.network, null);
});

test("treats a found modem with no telemetry yet as a valid empty result", () => {
  const result = parseUdpModemHealthHtml(
    IMEI_1,
    `<dl>
      <dt>Found: True</dt><dd>The modem exists</dd>
      <dt>Last sync date time: unknown (- ago)</dt><dd>No sync received</dd>
      <dt>IMEI: ${IMEI_1}</dt><dd>Identifier</dd>
    </dl>`,
  );

  assert.equal(result.fetchStatus, "success");
  assert.equal(result.lastSyncAt, null);
  assert.equal(result.network, null);
});

test("classifies not-found, oversized, and timeout responses safely", async () => {
  const notFound = await fetchUdpModemHealth(IMEI_1, {
    useCache: false,
    fetchImpl: async () => new Response("missing", { status: 404, headers: { "content-type": "text/html" } }),
  });
  assert.equal(notFound.fetchStatus, "not_found");

  const oversized = await fetchUdpModemHealth(IMEI_1, {
    useCache: false,
    maxResponseBytes: 4,
    fetchImpl: async () => new Response("12345", { status: 200, headers: { "content-type": "text/html" } }),
  });
  assert.equal(oversized.fetchStatus, "unavailable");

  const timeout = await fetchUdpModemHealth(IMEI_2, {
    useCache: false,
    timeoutMs: 5,
    fetchImpl: async (_url, init) => await new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }),
  });
  assert.equal(timeout.fetchStatus, "timeout");
});

test("uses the freshest successful modem sync for communications status", () => {
  const first = parseUdpModemHealthHtml(
    IMEI_1,
    `<table><tr><th>Last Sync</th><td>2026-08-18 08:00:00 UTC</td></tr></table>`,
  );
  const second = parseUdpModemHealthHtml(
    IMEI_2,
    `<table><tr><th>Last Sync</th><td>2026-08-20 07:30:00 UTC</td></tr></table>`,
  );
  const summary = summariseUdpCommunications([first, second], new Date("2026-08-20T08:00:00.000Z"));

  assert.equal(summary.status, "online");
  assert.equal(summary.selectedImei, IMEI_2);
  assert.equal(summary.lastSyncAt, "2026-08-20T07:30:00.000Z");
  assert.equal(summary.ageSeconds, 1800);
});

test("bounds per-asset fan-out and lookup concurrency", async () => {
  const imeis = Array.from({ length: 15 }, (_, i) => `${860000000000000 + i}`);
  let active = 0;
  let maxActive = 0;
  let calls = 0;
  const result = await getAssetUdpHealth("asset-1", imeis, async (imei) => {
    calls++;
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active--;
    return parseUdpModemHealthHtml(
      imei,
      "<table><tr><th>Network</th><td>NB-IoT</td></tr></table>",
    );
  });

  assert.equal(result.imeis.length, 15);
  assert.equal(result.modems.length, 12);
  assert.equal(result.lookupLimited, true);
  assert.equal(result.omittedImeiCount, 3);
  assert.equal(calls, 12);
  assert.ok(maxActive <= 3);
});