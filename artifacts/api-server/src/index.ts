import app from "./app";
import { logger } from "./lib/logger";
import { initialisePush } from "./lib/push-client";
import { checkAlerts } from "./lib/alert-checker";
import { CHECK_INTERVAL_MS, setLastCheckAt } from "./lib/check-state";
import { notifierTick, getOrCreateSettings } from "./lib/registration-notifier";
import {
  setNotifierState,
  setInFlight,
  inFlight,
  lastRunAt,
} from "./lib/notifier-state";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

initialisePush();

app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Log notifier startup state
  try {
    const settings = await getOrCreateSettings();
    const webhookUrl = settings.webhookUrl?.trim() ?? "";
    const maskedUrl = webhookUrl
      ? (() => {
          try {
            const u = new URL(webhookUrl);
            return `${u.protocol}//${u.hostname}/…`;
          } catch {
            return "(invalid URL)";
          }
        })()
      : "(none)";
    logger.info(
      {
        notifierEnabled: settings.enabled,
        refreshMinutes: settings.refreshMinutes,
        webhookHost: maskedUrl,
      },
      "Registration notifier initialised",
    );
  } catch (e) {
    logger.warn({ err: e }, "Failed to read notifier settings on startup");
  }

  // Alert checker — runs every CHECK_INTERVAL_MS
  setInterval(async () => {
    const now = new Date();
    setLastCheckAt(now);
    try {
      const result = await checkAlerts();
      logger.info(result, "Alert check complete");
    } catch (err) {
      logger.error({ err }, "Alert check error");
    }
  }, CHECK_INTERVAL_MS);

  // Registration notifier — 1-minute tick that reads refreshMinutes from DB
  // so cadence changes in Settings take effect without a restart.
  setInterval(async () => {
    if (inFlight) {
      logger.debug("Registration notifier: previous run still in flight — skipping tick");
      return;
    }

    const settings = await getOrCreateSettings().catch(() => null);
    if (!settings) return;

    const refreshMs = (settings.refreshMinutes ?? 30) * 60_000;
    const elapsed = lastRunAt ? Date.now() - lastRunAt.getTime() : Infinity;
    if (elapsed < refreshMs) return;

    setInFlight(true);
    try {
      const result = await notifierTick();
      setNotifierState(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setNotifierState("failed", message);
    } finally {
      setInFlight(false);
    }
  }, 60_000);
});
