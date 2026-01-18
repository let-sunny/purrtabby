import type { TabBusEvent, TabBusEventType, LeaderEvent, LeaderEventType } from './types.js';

/**
 * Generate a unique tab ID
 * @returns Unique tab identifier string
 */
export function generateTabId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Generate a unique request ID
 * @returns Unique request identifier string
 */
export function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Create a TabBus event
 * @param type - Event type
 * @param meta - Optional metadata
 * @returns TabBus event object
 */
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

/**
 * Create a Leader event
 * @param type - Event type
 * @param meta - Optional metadata
 * @returns Leader event object
 */
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

/**
 * Add jitter to a value
 * @param value - Base value
 * @param jitterMs - Jitter range in milliseconds
 * @returns Value with jitter applied (never negative)
 */
export function addJitter(value: number, jitterMs: number): number {
  const jitter = (Math.random() * 2 - 1) * jitterMs;
  return Math.max(0, value + jitter);
}

/** Leader lease data structure stored in localStorage */
export interface LeaderLease {
  tabId: string;
  timestamp: number;
  leaseMs: number;
}

/**
 * Read current lease from localStorage
 * @param key - localStorage key
 * @returns Leader lease or null if not found/invalid
 */
export function readLeaderLease(key: string): LeaderLease | null {
  try {
    const data = localStorage.getItem(key);
    if (!data) return null;
    return JSON.parse(data) as LeaderLease;
  } catch {
    return null;
  }
}

/**
 * Write lease to localStorage
 * @param key - localStorage key
 * @param lease - Leader lease to write
 */
export function writeLeaderLease(key: string, lease: LeaderLease): void {
  try {
    localStorage.setItem(key, JSON.stringify(lease));
  } catch (error) {
    console.error('Error writing leader lease:', error);
  }
}

/**
 * Remove lease from localStorage
 * @param key - localStorage key
 */
export function removeLeaderLease(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.error('Error removing leader lease:', error);
  }
}

/**
 * Check if current lease is valid
 * @param lease - Leader lease to validate
 * @returns True if lease is valid and not expired
 */
export function isValidLeaderLease(lease: LeaderLease | null): boolean {
  if (!lease) return false;
  const now = Date.now();
  return now - lease.timestamp < lease.leaseMs;
}

/**
 * Wait for items using event-based notification
 * @param signal - Optional AbortSignal for cancellation
 * @param hasItems - Function to check if items exist
 * @param resolvers - Set of resolver functions
 * @param addResolver - Function to add a resolver
 * @param removeResolver - Function to remove a resolver
 * @returns Promise that resolves when items are available or signal is aborted
 */
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
