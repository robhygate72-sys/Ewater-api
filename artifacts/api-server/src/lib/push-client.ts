import webpush from "web-push";
import { logger } from "./logger";

let initialised = false;

export function initialisePush(): void {
  const publicKey = process.env["VAPID_PUBLIC_KEY"];
  const privateKey = process.env["VAPID_PRIVATE_KEY"];
  const subject = process.env["VAPID_SUBJECT"] ?? "mailto:admin@ewater.io";

  if (!publicKey || !privateKey) {
    logger.warn("VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY not set — push notifications disabled");
    return;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  initialised = true;
  logger.info("Web push initialised");
}

export function isPushEnabled(): boolean {
  return initialised;
}

export async function sendPush(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: { title: string; body: string; tag?: string; url?: string }
): Promise<void> {
  if (!initialised) return;

  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload)
    );
  } catch (err: unknown) {
    const status = (err as Record<string, unknown>)["statusCode"];
    if (status === 404 || status === 410) {
      throw Object.assign(new Error("Subscription expired"), { expired: true });
    }
    throw err;
  }
}
