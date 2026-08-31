export interface PollingScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

const browserPollingScheduler: PollingScheduler = {
  setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clearTimeout: handle => window.clearTimeout(handle as number),
};

export const createSingleFlightLoader = (load: () => Promise<void>) => {
  let inFlight: Promise<void> | undefined;
  return () => {
    if (!inFlight) {
      inFlight = Promise.resolve()
        .then(load)
        .finally(() => {
          inFlight = undefined;
        });
    }
    return inFlight;
  };
};

export const startNonOverlappingPolling = (
  load: () => Promise<void>,
  intervalMs: number,
  scheduler: PollingScheduler = browserPollingScheduler,
) => {
  let stopped = false;
  let timer: unknown;

  const run = async () => {
    if (stopped) return;
    try {
      await load();
    } finally {
      if (!stopped) {
        timer = scheduler.setTimeout(() => {
          timer = undefined;
          void run();
        }, intervalMs);
      }
    }
  };

  void run();
  return () => {
    stopped = true;
    if (timer !== undefined) scheduler.clearTimeout(timer);
  };
};
