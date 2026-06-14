import app from "./app";
import { logger } from "./lib/logger";
import { initialisePush } from "./lib/push-client";
import { checkAlerts } from "./lib/alert-checker";

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

  // Check alerts every 5 minutes
  const CHECK_INTERVAL_MS = 5 * 60 * 1000;
  setInterval(async () => {
    try {
      const result = await checkAlerts();
      if (result.checked > 0) {
        logger.info(result, "Alert check complete");
      }
    } catch (err) {
      logger.error({ err }, "Alert check error");
    }
  }, CHECK_INTERVAL_MS);
});
