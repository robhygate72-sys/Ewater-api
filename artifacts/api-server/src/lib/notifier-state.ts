export type NotifierResult = "sent" | "failed" | "skipped";

export let lastRunAt: Date | null = null;
export let lastResult: NotifierResult | null = null;
export let lastError: string | null = null;
export let inFlight = false;

export function setNotifierState(result: NotifierResult, error?: string): void {
  lastRunAt = new Date();
  lastResult = result;
  lastError = error ? error.slice(0, 500) : null;
}

export function setInFlight(value: boolean): void {
  inFlight = value;
}
