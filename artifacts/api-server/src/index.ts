import app from "./app";
import { logger } from "./lib/logger";
import { initialisePush } from "./lib/push-client";
import { checkAlerts } from "./lib/alert-checker";
import { CHECK_INTERVAL_MS, setLastCheckAt } from "./lib/check-state";

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

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

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
});
