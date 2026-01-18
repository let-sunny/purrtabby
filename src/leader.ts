import type { LeaderElector, LeaderElectorOptions, InternalLeaderState, LeaderEvent, LeaderEventType } from './types.js';
import { leaderEventsGenerator } from './generators.js';
import { createLeaderEvent, addJitter, readLeaderLease, writeLeaderLease, removeLeaderLease, isValidLeaderLease, handleBufferOverflow, executeCallbacks, type LeaderLease } from './utils.js';

/**
 * Emit an event to all callbacks (pure function, testable)
 * @param event - Leader event
 * @param state - Internal leader state
 * @param eventQueue - Event queue for streaming
 */
export function emitLeaderEvent(
  event: LeaderEvent,
  state: InternalLeaderState,
  eventQueue: LeaderEvent[]
): void {
  // Notify type-specific callbacks
  const typeCallbacks = state.eventCallbacks.get(event.type);
  executeCallbacks(typeCallbacks, event, 'Error in LeaderElector callback:');

  // Notify all-event callbacks
  executeCallbacks(state.allCallbacks, event, 'Error in LeaderElector all callback:');

  // Add to queue for stream generators (only if there are active iterators)
  if (state.activeIterators === 0) return;

  const overflowResult = handleBufferOverflow(
    state.bufferOverflow,
    eventQueue,
    event,
    state.bufferSize
  );

  if (overflowResult.action === 'error') {
    console.error('Event buffer overflow');
    return;
  }

  if (overflowResult.action === 'drop_newest') {
    return; // Drop newest (current event)
  }

  if (overflowResult.action === 'drop_oldest') {
    // Oldest already removed by handleBufferOverflow
  }

  // Add event to queue
  eventQueue.push(event);
  state.eventResolvers.forEach((resolve) => resolve());
  state.eventResolvers.clear();
}

/**
 * Try to acquire leadership (pure function, testable)
 * @param state - Internal leader state
 * @param eventQueue - Event queue for streaming
 * @returns True if leadership was acquired
 */
export function tryAcquireLeadership(
  state: InternalLeaderState,
  eventQueue: LeaderEvent[]
): boolean {
  if (state.stopped) return false;

  const currentLease = readLeaderLease(state.key);
  
  // If no lease or expired, try to acquire
  if (!isValidLeaderLease(currentLease)) {
    const newLease: LeaderLease = {
      tabId: state.tabId,
      timestamp: Date.now(),
      leaseMs: state.leaseMs,
    };
    writeLeaderLease(state.key, newLease);
    
    // Double-check: read back to see if we got it
    const acquiredLease = readLeaderLease(state.key);
    if (acquiredLease?.tabId === state.tabId) {
      if (!state.isLeader) {
        state.isLeader = true;
        emitLeaderEvent(createLeaderEvent('acquire', { tabId: state.tabId }), state, eventQueue);
      }
      return true;
    }
  }

  // Check if we're still the leader
  if (currentLease?.tabId === state.tabId && isValidLeaderLease(currentLease)) {
    if (!state.isLeader) {
      state.isLeader = true;
      emitLeaderEvent(createLeaderEvent('acquire', { tabId: state.tabId }), state, eventQueue);
    }
    return true;
  }

  // Lost leadership
  if (state.isLeader) {
    state.isLeader = false;
      emitLeaderEvent(createLeaderEvent('lose', { 
        tabId: state.tabId,
        newLeader: currentLease?.tabId,
      }), state, eventQueue);
  }

  return false;
}

/**
 * Send heartbeat to renew lease (pure function, testable)
 * @param state - Internal leader state
 * @param eventQueue - Event queue for streaming
 */
export function sendLeaderHeartbeat(
  state: InternalLeaderState,
  eventQueue: LeaderEvent[]
): void {
  if (state.stopped || !state.isLeader) return;

  const currentLease = readLeaderLease(state.key);
  if (currentLease?.tabId === state.tabId) {
    const updatedLease: LeaderLease = {
      ...currentLease,
      timestamp: Date.now(),
    };
    writeLeaderLease(state.key, updatedLease);
  } else {
    // Lost leadership between checks
    if (state.isLeader) {
      state.isLeader = false;
      emitLeaderEvent(createLeaderEvent('lose', { tabId: state.tabId }), state, eventQueue);
    }
  }
}

/**
 * Check for leadership changes (polling) (pure function, testable)
 * @param state - Internal leader state
 * @param eventQueue - Event queue for streaming
 */
export function checkLeaderLeadership(
  state: InternalLeaderState,
  eventQueue: LeaderEvent[]
): void {
  if (state.stopped) return;

  const currentLease = readLeaderLease(state.key);
  const wasLeader = state.isLeader;
  const isNowLeader = currentLease?.tabId === state.tabId && isValidLeaderLease(currentLease);

  if (!wasLeader && isNowLeader) {
    state.isLeader = true;
    emitLeaderEvent(createLeaderEvent('acquire', { tabId: state.tabId }), state, eventQueue);
  } else if (wasLeader && !isNowLeader) {
    state.isLeader = false;
      emitLeaderEvent(createLeaderEvent('lose', { 
        tabId: state.tabId,
        newLeader: currentLease?.tabId,
      }), state, eventQueue);
  } else if (wasLeader && isNowLeader && currentLease?.tabId !== state.tabId) {
    // Leadership changed to another tab
    emitLeaderEvent(createLeaderEvent('change', {
      tabId: state.tabId,
      newLeader: currentLease.tabId,
    }), state, eventQueue);
  }
}

/**
 * Create a LeaderElector instance for leader election
 * @param options - Leader elector configuration options
 * @returns LeaderElector instance
 */
export function createLeaderElector(options: LeaderElectorOptions): LeaderElector {
  const {
    key,
    tabId,
    leaseMs = 5000,
    heartbeatMs = 2000,
    jitterMs = 500,
    buffer,
  } = options;
  const bufferSize = buffer?.size ?? 100;
  const bufferOverflow = buffer?.overflow ?? 'oldest';

  if (typeof localStorage === 'undefined') {
    throw new Error('localStorage is not supported in this environment');
  }

  const state: InternalLeaderState = {
    key,
    tabId,
    leaseMs,
    heartbeatMs,
    jitterMs,
    isLeader: false,
    heartbeatTimer: null,
    checkTimer: null,
    eventCallbacks: new Map(),
    allCallbacks: new Set(),
    eventResolvers: new Set(),
    activeIterators: 0,
    stopped: false,
    bufferSize,
    bufferOverflow,
  };

  // Event queue for stream generators
  const eventQueue: LeaderEvent[] = [];


  if (typeof window !== 'undefined') {
    // Listen to storage events for cross-tab communication
    window.addEventListener('storage', handleStorageEvent);

    // Register page unload handlers for automatic cleanup
    // Use pagehide for better reliability (works in mobile browsers too)
    window.addEventListener('pagehide', handlePageUnload);
    // Fallback to beforeunload for older browsers
    window.addEventListener('beforeunload', handlePageUnload);
  }

  /** Handle storage events from other tabs */
  function handleStorageEvent(e: StorageEvent): void {
    if (e.key !== state.key || e.storageArea !== localStorage) return;
    checkLeaderLeadership(state, eventQueue);
  }

  /** Handle page unload - cleanup leadership if we're the leader */
  function handlePageUnload(): void {
    if (state.isLeader) {
      const currentLease = readLeaderLease(state.key);
      if (currentLease?.tabId === state.tabId) {
        removeLeaderLease(state.key);
      }
    }
  }

  const leader: LeaderElector = {
    start(): void {
      if (state.stopped) {
        state.stopped = false;
      }

      // Try to acquire leadership immediately
      tryAcquireLeadership(state, eventQueue);

      // Start heartbeat if we're the leader
      if (state.isLeader) {
        const heartbeatInterval = addJitter(state.heartbeatMs, state.jitterMs);
        state.heartbeatTimer = setInterval(() => {
          sendLeaderHeartbeat(state, eventQueue);
        }, heartbeatInterval) as any;
      }

      // Start checking for leadership changes
      const checkInterval = addJitter(state.heartbeatMs / 2, state.jitterMs);
      state.checkTimer = setInterval(() => {
        checkLeaderLeadership(state, eventQueue);
      }, checkInterval) as any;
    },

    stop(): void {
      state.stopped = true;

      if (state.heartbeatTimer) {
        clearInterval(state.heartbeatTimer);
        state.heartbeatTimer = null;
      }

      if (state.checkTimer) {
        clearInterval(state.checkTimer);
        state.checkTimer = null;
      }

      // Release leadership if we're the leader
      if (state.isLeader) {
        const currentLease = readLeaderLease(state.key);
        if (currentLease?.tabId === state.tabId) {
          removeLeaderLease(state.key);
        }
        state.isLeader = false;
        emitLeaderEvent(createLeaderEvent('lose', { tabId: state.tabId, reason: 'stopped' }), state, eventQueue);
      }

      // Remove storage event listener
      if (typeof window !== 'undefined') {
        window.removeEventListener('storage', handleStorageEvent);
        window.removeEventListener('pagehide', handlePageUnload);
        window.removeEventListener('beforeunload', handlePageUnload);
      }
    },

    isLeader(): boolean {
      return state.isLeader;
    },

    on(event: LeaderEventType, handler: (event: LeaderEvent) => void): () => void {
      if (!state.eventCallbacks.has(event)) {
        state.eventCallbacks.set(event, new Set());
      }
      state.eventCallbacks.get(event)!.add(handler);

      return () => {
        const callbacks = state.eventCallbacks.get(event);
        if (callbacks) {
          callbacks.delete(handler);
          if (callbacks.size === 0) {
            state.eventCallbacks.delete(event);
          }
        }
      };
    },

    onAll(handler: (event: LeaderEvent) => void): () => void {
      state.allCallbacks.add(handler);
      return () => {
        state.allCallbacks.delete(handler);
      };
    },

    stream(options?: { signal?: AbortSignal }): AsyncIterable<LeaderEvent> {
      return leaderEventsGenerator(state, { events: eventQueue }, options?.signal);
    },

    getTabId(): string {
      return state.tabId;
    },
  };

  return leader;
}
