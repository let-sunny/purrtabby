import type { TabBusEvent, TabBusEventType, LeaderEvent, LeaderEventType, BufferOverflowPolicy } from './types.js';

/**
 * Execute callbacks safely with error handling
 * @param callbacks - Set of callback functions
 * @param arg - Argument to pass to callbacks
 * @param errorMessage - Error message prefix for logging
 */
export function executeCallbacks<T>(
  callbacks: Set<(arg: T) => void> | undefined,
  arg: T,
  errorMessage: string
): void {
  if (!callbacks) return;
  
  callbacks.forEach((callback) => {
    try {
      callback(arg);
    } catch (error) {
      console.error(errorMessage, error);
    }
  });
}

/**
 * Generate a unique tab ID
 * @returns Unique tab identifier string
 */
export function generateTabId(): string {
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
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }

    if (hasItems()) {
      resolve();
      return;
    }

    const cleanup = () => {
      removeResolver(resolve);
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    };

    const onAbort = () => {
      cleanup();
      resolve();
    };

    if (signal) {
      signal.addEventListener('abort', onAbort);
    }

    addResolver(() => {
      cleanup();
      resolve();
    });
  });
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
    const stored = localStorage.getItem(key);
    if (!stored) return null;
    return JSON.parse(stored) as LeaderLease;
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
 * Handle buffer overflow according to policy
 * @param policy - Overflow policy: 'oldest', 'newest', or 'error'
 * @param buffer - The buffer array
 * @param newItem - New item to potentially add
 * @param bufferSize - Maximum buffer size
 * @returns Object with action: 'drop_oldest' | 'drop_newest' | 'error' | 'add', and dropped item if any
 */
export function handleBufferOverflow<T>(
  policy: BufferOverflowPolicy,
  buffer: T[],
  newItem: T,
  bufferSize: number
): {
  action: 'drop_oldest' | 'drop_newest' | 'error' | 'add';
  dropped?: T;
} {
  if (buffer.length < bufferSize) {
    return { action: 'add' };
  }

  if (policy === 'oldest') {
    const dropped = buffer.shift();
    return { action: 'drop_oldest', dropped };
  }

  if (policy === 'newest') {
    return { action: 'drop_newest', dropped: newItem };
  }

  // error policy
  return { action: 'error' };
}
