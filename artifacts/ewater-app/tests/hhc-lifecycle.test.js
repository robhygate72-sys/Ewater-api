/**
 * HHC lifecycle-button smoke test
 *
 * Verifies that clicking every lifecycle pill, advancing pages, and using
 * the Water-system / Country header dropdowns on /hhc never surfaces an
 * error-boundary screen.
 *
 * Tolerance: meter-state API calls can take ~27 s, so timeouts are generous.
 */

const { chromium } = await import("playwright");

// Use the Replit dev proxy (port 80) so the full app is routed correctly
const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:80";
const NAV_TIMEOUT = 60_000; // ms for initial navigation
const SHELL_TIMEOUT = 30_000; // ms to wait for React shell to mount
const TABLE_TIMEOUT = 90_000; // ms to wait for fleet table after filter change

// Selectors
const SEL_TAB_OVERVIEW = '[data-testid="tab-hhc-overview"]';
const SEL_API_OK = '[data-testid="status-api-connection"]';
const SEL_LC_ALL = '[data-testid="filter-lifecycle-all"]';
const LIFECYCLE_IDS = ["preinstallation", "staged", "active", "test"];
const SEL_NEXT = '[data-testid="button-fleet-next"]';
const SEL_PREV = '[data-testid="button-fleet-prev"]';
const SEL_WATER = '[data-testid="filter-water-system"]';
const SEL_COUNTRY = '[data-testid="filter-country"]';
const SEL_COVERAGE = '[data-testid="text-coverage"]';

// Error boundary texts that indicate a crash
const ERROR_TEXTS = [
  "Dashboard render error",
  "tab encountered an error",
  "encountered an error",
];

async function assertNoCrash(page, label) {
  const body = await page.locator("body").textContent({ timeout: 5_000 });
  for (const text of ERROR_TEXTS) {
    if (body.includes(text)) {
      throw new Error(`[FAIL] Error boundary detected after: ${label}\n  Matched: "${text}"`);
    }
  }
  console.log(`  ✓ No crash: ${label}`);
}

/**
 * Wait until the fleet table area has settled — either rows, empty state,
 * or error state. Uses the coverage text element as the "table rendered" signal
 * because it appears in all non-loading states.
 */
async function waitForFleetReady(page) {
  // Wait for any of: table rows, empty state, error/retry button, OR coverage text
  await page
    .locator(
      `[data-testid^="row-meter-"], [data-testid="button-retry-fleet"], [data-testid="button-refresh-empty"], ${SEL_COVERAGE}`
    )
    .first()
    .waitFor({ timeout: TABLE_TIMEOUT })
    .catch(() => {
      // If nothing appears within TABLE_TIMEOUT it could be a completely empty
      // lifecycle — treat as non-crash (we'll check for error boundary next).
    });
}

let browser;
let context;
let page;
let passed = false;

try {
  console.log(`\n=== HHC Lifecycle Smoke Test ===`);
  console.log(`Target: ${BASE_URL}/hhc\n`);

  browser = await chromium.launch({
    headless: true,
    executablePath: "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium-browser",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  context = await browser.newContext({ ignoreHTTPSErrors: true });
  page = await context.newPage();

  // Capture console errors for the summary
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  // ── 1. Navigate to /hhc ───────────────────────────────────────────────────
  console.log("1. Navigating to /hhc …");
  await page.goto(`${BASE_URL}/hhc`, {
    timeout: NAV_TIMEOUT,
    waitUntil: "domcontentloaded",
  });

  // Wait for the React shell to mount (tab bar is the earliest stable landmark)
  await page.locator(SEL_TAB_OVERVIEW).waitFor({ timeout: SHELL_TIMEOUT });
  console.log("   ✓ React shell mounted (tab bar visible)");

  // Wait for the API connection badge (inside FleetTabInner)
  await page.locator(SEL_API_OK).waitFor({ timeout: SHELL_TIMEOUT });
  console.log("   ✓ Fleet tab rendered");

  // Wait for the fleet list query to settle
  await waitForFleetReady(page);
  await assertNoCrash(page, "initial page load");

  // ── 2. Click each lifecycle pill ─────────────────────────────────────────
  // Use force:true to bypass any overlay (e.g. Replit cartographer badge)
  // that may intercept pointer events.
  console.log("\n2. Clicking lifecycle pills …");
  for (const lc of LIFECYCLE_IDS) {
    const sel = `[data-testid="filter-lifecycle-${lc}"]`;
    console.log(`   → ${lc}`);
    await page.locator(sel).click({ force: true });
    await waitForFleetReady(page);
    await assertNoCrash(page, `lifecycle pill: ${lc}`);
  }

  // Reset to All
  console.log("   → all (reset)");
  await page.locator(SEL_LC_ALL).click({ force: true });
  await waitForFleetReady(page);
  await assertNoCrash(page, "lifecycle pill: all (reset)");

  // ── 3. Pagination ─────────────────────────────────────────────────────────
  // Use page.evaluate to dispatch the click directly, bypassing Playwright's
  // actionability checks entirely (needed in the headless Replit env where
  // overlays can block pointer events even with force:true).
  console.log("\n3. Testing pagination …");
  const nextDisabled = await page.locator(SEL_NEXT).getAttribute("disabled").catch(() => "disabled");
  const isNextEnabled = nextDisabled === null;
  if (isNextEnabled) {
    await page.evaluate((sel) => document.querySelector(sel)?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })), SEL_NEXT);
    await waitForFleetReady(page);
    await assertNoCrash(page, "next page");

    const prevDisabled = await page.locator(SEL_PREV).getAttribute("disabled").catch(() => "disabled");
    if (prevDisabled === null) {
      await page.evaluate((sel) => document.querySelector(sel)?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })), SEL_PREV);
      await waitForFleetReady(page);
      await assertNoCrash(page, "prev page (back to page 1)");
    }
  } else {
    console.log("   ℹ Next page button disabled (≤1 page of results) — skipping");
  }

  // Helper: JS-dispatch a click on a CSS selector (bypasses overlay/pointer-events guards)
  const jsClick = (sel) =>
    page.evaluate(
      (s) => document.querySelector(s)?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })),
      sel,
    );

  // ── 4. Water-system header dropdown ──────────────────────────────────────
  console.log("\n4. Testing Water-system header dropdown …");
  await jsClick(SEL_WATER);

  // Wait for the Radix select content to appear
  const selectContent = page.locator('[role="listbox"], [data-radix-select-content]');
  await selectContent.waitFor({ timeout: 5_000 }).catch(() => {});

  // Helper: JS-dispatch a click on the nth matching element (0-indexed)
  const jsClickNth = (sel, n) =>
    page.evaluate(
      ([s, i]) => document.querySelectorAll(s)[i]?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })),
      [sel, n],
    );
  // Helper: JS-dispatch on a button whose text matches
  const jsClickText = (text) =>
    page.evaluate(
      (t) => {
        const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === t);
        btn?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      },
      text,
    );

  const wsOptions = await page.locator('[role="option"]').all();
  console.log(`   Found ${wsOptions.length} option(s)`);
  if (wsOptions.length > 1) {
    // options[0] is typically the "All" sentinel — pick the second one
    await jsClickNth('[role="option"]', 1);
    await waitForFleetReady(page);
    await assertNoCrash(page, "water-system filter applied");

    // Clear via Clear-filters button
    const clearVisible = await page.locator("button", { hasText: "Clear filters" }).isVisible().catch(() => false);
    if (clearVisible) {
      await jsClickText("Clear filters");
      await waitForFleetReady(page);
      await assertNoCrash(page, "water-system filter cleared");
    }
  } else {
    await page.keyboard.press("Escape");
    console.log("   ℹ No filterable water-system options — skipping");
  }

  // ── 5. Country header dropdown ────────────────────────────────────────────
  console.log("\n5. Testing Country header dropdown …");
  await jsClick(SEL_COUNTRY);
  await selectContent.waitFor({ timeout: 5_000 }).catch(() => {});

  const coOptions = await page.locator('[role="option"]').all();
  console.log(`   Found ${coOptions.length} option(s)`);
  if (coOptions.length > 1) {
    await jsClickNth('[role="option"]', 1);
    await waitForFleetReady(page);
    await assertNoCrash(page, "country filter applied");

    const clearVisible2 = await page.locator("button", { hasText: "Clear filters" }).isVisible().catch(() => false);
    if (clearVisible2) {
      await jsClickText("Clear filters");
      await waitForFleetReady(page);
      await assertNoCrash(page, "country filter cleared");
    }
  } else {
    await page.keyboard.press("Escape");
    console.log("   ℹ No filterable country options — skipping");
  }

  // ── 6. Final state ────────────────────────────────────────────────────────
  console.log("\n6. Final state check …");
  await assertNoCrash(page, "end of test");

  if (consoleErrors.length > 0) {
    console.warn(`\n   ⚠ Console errors captured (${consoleErrors.length}):`);
    consoleErrors.slice(0, 5).forEach((e) => console.warn("     ", e.slice(0, 200)));
  }

  passed = true;
  console.log("\n✅ ALL CHECKS PASSED — no error-boundary crash detected.\n");
} catch (err) {
  console.error("\n❌ TEST FAILED:", err.message);
  process.exit(1);
} finally {
  await page?.close().catch(() => {});
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
}

if (!passed) process.exit(1);
