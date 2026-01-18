import type { TabBus, BusOptions, TabBusMessage, InternalBusState } from './types.js';
import { busMessagesGenerator } from './generators.js';
import { generateTabId, createTabBusEvent, handleBufferOverflow, executeCallbacks } from './utils.js';

/**
 * Handle incoming message (pure function, testable)
 * @param message - TabBus message
 * @param tabId - Current tab ID
 * @param state - Internal bus state
 * @param messageQueue - Message queue for streaming
 */
export function handleBusMessage<T>(
  message: TabBusMessage<T>,
  tabId: string,
  state: InternalBusState<T>,
  messageQueue: TabBusMessage<T>[]
): void {
  // Allow receiving own messages (for leader-follower pattern)
  // All tabs use the same code, leader receives its own messages

  // Notify type-specific callbacks
  const typeCallbacks = state.messageCallbacks.get(message.type);
  executeCallbacks(typeCallbacks, message, 'Error in TabBus callback:');

  // Notify all-message callbacks
  executeCallbacks(state.allCallbacks, message, 'Error in TabBus all callback:');

  // Add to queue for stream generators (only if there are active iterators)
  if (state.activeIterators === 0) return;

  const overflowResult = handleBufferOverflow(
    state.bufferOverflow,
    messageQueue,
    message,
    state.bufferSize
  );

  if (overflowResult.action === 'error') {
    console.error('Message buffer overflow');
    return;
  }

  if (overflowResult.action === 'drop_newest') {
    return; // Drop newest (current message)
  }

  if (overflowResult.action === 'drop_oldest') {
    // Oldest already removed by handleBufferOverflow
  }

  // Add message to queue
  messageQueue.push(message);
  
  state.messageResolvers.forEach((resolve) => resolve());
  state.messageResolvers.clear();
}

/**
 * Handle message event with error handling (pure function, testable)
 * @param event - MessageEvent from BroadcastChannel
 * @param tabId - Current tab ID
 * @param state - Internal bus state
 * @param messageQueue - Message queue for streaming
 */
export function handleBusMessageEvent<T>(
  event: MessageEvent,
  tabId: string,
  state: InternalBusState<T>,
  messageQueue: TabBusMessage<T>[]
): void {
  try {
    const message: TabBusMessage<T> = event.data;
    handleBusMessage(message, tabId, state, messageQueue);
  } catch (error) {
    console.error('Error handling TabBus message:', error);
  }
}

/**
 * Create a TabBus instance for cross-tab communication
 * @param options - Bus configuration options
 * @returns TabBus instance
 */
export function createBus<T = any>(options: BusOptions): TabBus<T> {
  const { channel, tabId, buffer } = options;
  const finalTabId = tabId || generateTabId();
  const bufferSize = buffer?.size ?? 100;
  const bufferOverflow = buffer?.overflow ?? 'oldest';

  if (typeof BroadcastChannel === 'undefined') {
    throw new Error('BroadcastChannel is not supported in this environment');
  }

  const bc = new BroadcastChannel(channel);
  const state: InternalBusState<T> = {
    channel: bc,
    tabId: finalTabId,
    messageCallbacks: new Map(),
    allCallbacks: new Set(),
    messageResolvers: new Set(),
    activeIterators: 0,
    bufferSize,
    bufferOverflow,
  };

  // Message queue for stream generators
  const messageQueue: TabBusMessage<T>[] = [];

  // Handle incoming messages
  bc.onmessage = (event: MessageEvent) => {
    handleBusMessageEvent(event, finalTabId, state, messageQueue);
  };

  bc.onmessageerror = () => {
    const errorEvent = createTabBusEvent('err', {
      error: 'Failed to receive message',
    });
    // Could emit error event if needed
  };

  const bus: TabBus<T> = {
    publish(type: string, payload?: T): void {
      const message: TabBusMessage<T> = {
        type,
        payload,
        tabId: finalTabId,
        ts: Date.now(),
      };
      bc.postMessage(message);
      
      // BroadcastChannel doesn't deliver to self, so handle locally
      // This allows leader to receive its own messages (leader-follower pattern)
      queueMicrotask(() => {
        handleBusMessage(message, finalTabId, state, messageQueue);
      });
    },

    subscribe(type: string, handler: (message: TabBusMessage<T>) => void): () => void {
      if (!state.messageCallbacks.has(type)) {
        state.messageCallbacks.set(type, new Set());
      }
      state.messageCallbacks.get(type)!.add(handler);

      return () => {
        const callbacks = state.messageCallbacks.get(type);
        if (callbacks) {
          callbacks.delete(handler);
          if (callbacks.size === 0) {
            state.messageCallbacks.delete(type);
          }
        }
      };
    },

    subscribeAll(handler: (message: TabBusMessage<T>) => void): () => void {
      state.allCallbacks.add(handler);
      return () => {
        state.allCallbacks.delete(handler);
      };
    },

    stream(options?: { signal?: AbortSignal }): AsyncIterable<TabBusMessage<T>> {
      return busMessagesGenerator(state, { messages: messageQueue }, options?.signal);
    },

    getTabId(): string {
      return finalTabId;
    },

    close(): void {
      bc.close();
      state.channel = null;
      state.messageCallbacks.clear();
      state.allCallbacks.clear();
      state.messageResolvers.clear();
    },
  };

  return bus;
}
