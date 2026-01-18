import type { TabBusEvent, TabBusEventType, LeaderEvent, LeaderEventType } from './types.js';

/** Generate a unique tab ID */
export function generateTabId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/** Create a TabBus event */
export function createTabBusEvent(
  type: TabBusEventType,
  meta?: Record<string, any>
): TabBusEvent {
  return {
    type,
    ts: Date.now(),
    meta,
  };
}

/** Create a Leader event */
export function createLeaderEvent(
  type: LeaderEventType,
  meta?: Record<string, any>
): LeaderEvent {
  return {
    type,
    ts: Date.now(),
    meta,
  };
}

/** Add jitter to a value */
export function addJitter(value: number, jitterMs: number): number {
  const jitter = (Math.random() * 2 - 1) * jitterMs;
  return Math.max(0, value + jitter);
}

/** Wait for items using event-based notification */
export function waitForItems(
  signal: AbortSignal | undefined,
  hasItems: () => boolean,
  resolvers: Set<() => void>,
  addResolver: (resolve: () => void) => void,
  removeResolver: (resolve: () => void) => void
): Promise<void> {
  return new Promise<void>((resolve) => {
    let checkInterval: ReturnType<typeof setTimeout> | null = null;
    let resolved = false;

    const cleanup = () => {
      if (resolved) return;
      if (signal) {
        signal.removeEventListener('abort', abortHandler);
      }
      removeResolver(doResolve);
      if (checkInterval !== null) {
        clearTimeout(checkInterval);
        checkInterval = null;
      }
    };

    const doResolve = () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve();
    };

    const abortHandler = () => doResolve();

    if (signal?.aborted) {
      doResolve();
      return;
    }

    if (signal) {
      signal.addEventListener('abort', abortHandler);
    }

    if (hasItems()) {
      doResolve();
      return;
    }

    addResolver(doResolve);

    if (!signal) {
      const poll = () => {
        if (resolved) return;
        if (hasItems()) {
          doResolve();
          return;
        }
        checkInterval = setTimeout(poll, 100) as any;
      };
      poll();
    }
  });
}
