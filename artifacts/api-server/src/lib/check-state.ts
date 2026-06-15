export const CHECK_INTERVAL_MS = 5 * 60 * 1000;

export let lastCheckAt: Date | null = null;

export function setLastCheckAt(d: Date): void {
  lastCheckAt = d;
}
