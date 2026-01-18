import type { LeaderElector, LeaderElectorOptions, LeaderEvent, LeaderEventType, InternalLeaderState } from './types.js';
import { createLeaderEvent, addJitter } from './utils.js';
import { leaderEventsGenerator } from './generators.js';

/** Leader lease data structure stored in localStorage */
interface LeaderLease {
  tabId: string;
  timestamp: number;
  leaseMs: number;
}

/** Create a LeaderElector instance for leader election */
export function createLeaderElector(options: LeaderElectorOptions): LeaderElector {
  const {
    key,
    tabId,
    leaseMs = 5000,
    heartbeatMs = 2000,
    jitterMs = 500,
  } = options;

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
  };

  // Event queue for stream generators
  const eventQueue: LeaderEvent[] = [];

  /** Emit an event to all callbacks */
  function emitEvent(event: LeaderEvent): void {
    // Notify type-specific callbacks
    const typeCallbacks = state.eventCallbacks.get(event.type);
    if (typeCallbacks) {
      typeCallbacks.forEach((callback) => {
        try {
          callback(event);
        } catch (error) {
          console.error('Error in LeaderElector callback:', error);
        }
      });
    }

    // Notify all-event callbacks
    state.allCallbacks.forEach((callback) => {
      try {
        callback(event);
      } catch (error) {
        console.error('Error in LeaderElector all callback:', error);
      }
    });

    // Add to queue for stream generators
    eventQueue.push(event);
    state.eventResolvers.forEach((resolve) => resolve());
    state.eventResolvers.clear();
  }

  /** Read current lease from localStorage */
  function readLease(): LeaderLease | null {
    try {
      const data = localStorage.getItem(state.key);
      if (!data) return null;
      return JSON.parse(data) as LeaderLease;
    } catch {
      return null;
    }
  }

  /** Write lease to localStorage */
  function writeLease(lease: LeaderLease): void {
    try {
      localStorage.setItem(state.key, JSON.stringify(lease));
    } catch (error) {
      console.error('Error writing leader lease:', error);
    }
  }

  /** Remove lease from localStorage */
  function removeLease(): void {
    try {
      localStorage.removeItem(state.key);
    } catch (error) {
      console.error('Error removing leader lease:', error);
    }
  }

  /** Check if current lease is valid */
  function isValidLease(lease: LeaderLease | null): boolean {
    if (!lease) return false;
    const now = Date.now();
    return now - lease.timestamp < lease.leaseMs;
  }

  /** Try to acquire leadership */
  function tryAcquireLeadership(): boolean {
    if (state.stopped) return false;

    const currentLease = readLease();
    
    // If no lease or expired, try to acquire
    if (!isValidLease(currentLease)) {
      const newLease: LeaderLease = {
        tabId: state.tabId,
        timestamp: Date.now(),
        leaseMs: state.leaseMs,
      };
      writeLease(newLease);
      
      // Double-check: read back to see if we got it
      const acquiredLease = readLease();
      if (acquiredLease?.tabId === state.tabId) {
        if (!state.isLeader) {
          state.isLeader = true;
          emitEvent(createLeaderEvent('acquired', { tabId: state.tabId }));
        }
        return true;
      }
    }

    // Check if we're still the leader
    if (currentLease?.tabId === state.tabId && isValidLease(currentLease)) {
      if (!state.isLeader) {
        state.isLeader = true;
        emitEvent(createLeaderEvent('acquired', { tabId: state.tabId }));
      }
      return true;
    }

    // Lost leadership
    if (state.isLeader) {
      state.isLeader = false;
      emitEvent(createLeaderEvent('lost', { 
        tabId: state.tabId,
        newLeader: currentLease?.tabId,
      }));
    }

    return false;
  }

  /** Send heartbeat to renew lease */
  function sendHeartbeat(): void {
    if (state.stopped || !state.isLeader) return;

    const currentLease = readLease();
    if (currentLease?.tabId === state.tabId) {
      const updatedLease: LeaderLease = {
        ...currentLease,
        timestamp: Date.now(),
      };
      writeLease(updatedLease);
    } else {
      // Lost leadership between checks
      if (state.isLeader) {
        state.isLeader = false;
        emitEvent(createLeaderEvent('lost', { tabId: state.tabId }));
      }
    }
  }

  /** Check for leadership changes (polling) */
  function checkLeadership(): void {
    if (state.stopped) return;

    const currentLease = readLease();
    const wasLeader = state.isLeader;
    const isNowLeader = currentLease?.tabId === state.tabId && isValidLease(currentLease);

    if (!wasLeader && isNowLeader) {
      state.isLeader = true;
      emitEvent(createLeaderEvent('acquired', { tabId: state.tabId }));
    } else if (wasLeader && !isNowLeader) {
      state.isLeader = false;
      emitEvent(createLeaderEvent('lost', { 
        tabId: state.tabId,
        newLeader: currentLease?.tabId,
      }));
    } else if (wasLeader && isNowLeader && currentLease?.tabId !== state.tabId) {
      // Leadership changed to another tab
      emitEvent(createLeaderEvent('changed', {
        tabId: state.tabId,
        newLeader: currentLease.tabId,
      }));
    }
  }

  /** Handle storage events from other tabs */
  function handleStorageEvent(e: StorageEvent): void {
    if (e.key !== state.key || e.storageArea !== localStorage) return;
    checkLeadership();
  }

  // Listen to storage events for cross-tab communication
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', handleStorageEvent);
  }

  const leader: LeaderElector = {
    start(): void {
      if (state.stopped) {
        state.stopped = false;
      }

      // Try to acquire leadership immediately
      tryAcquireLeadership();

      // Start heartbeat if we're the leader
      if (state.isLeader) {
        const heartbeatInterval = addJitter(state.heartbeatMs, state.jitterMs);
        state.heartbeatTimer = setInterval(() => {
          sendHeartbeat();
        }, heartbeatInterval) as any;
      }

      // Start checking for leadership changes
      const checkInterval = addJitter(state.heartbeatMs / 2, state.jitterMs);
      state.checkTimer = setInterval(() => {
        checkLeadership();
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
        const currentLease = readLease();
        if (currentLease?.tabId === state.tabId) {
          removeLease();
        }
        state.isLeader = false;
        emitEvent(createLeaderEvent('lost', { tabId: state.tabId, reason: 'stopped' }));
      }

      // Remove storage event listener
      if (typeof window !== 'undefined') {
        window.removeEventListener('storage', handleStorageEvent);
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
