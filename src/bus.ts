import type { TabBus, BusOptions, TabBusMessage, InternalBusState } from './types.js';
import { generateTabId, createTabBusEvent } from './utils.js';
import { busMessagesGenerator } from './generators.js';

/** Create a TabBus instance for cross-tab communication */
export function createBus<T = any>(options: BusOptions): TabBus<T> {
  const { channel, tabId } = options;
  const finalTabId = tabId || generateTabId();

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
  };

  // Message queue for stream generators
  const messageQueue: TabBusMessage<T>[] = [];

  // Handle incoming messages
  bc.onmessage = (event: MessageEvent) => {
    try {
      const message: TabBusMessage<T> = event.data;
      
      // Ignore messages from self
      if (message.tabId === finalTabId) {
        return;
      }

      // Notify type-specific callbacks
      const typeCallbacks = state.messageCallbacks.get(message.type);
      if (typeCallbacks) {
        typeCallbacks.forEach((callback) => {
          try {
            callback(message);
          } catch (error) {
            console.error('Error in TabBus callback:', error);
          }
        });
      }

      // Notify all-message callbacks
      state.allCallbacks.forEach((callback) => {
        try {
          callback(message);
        } catch (error) {
          console.error('Error in TabBus all callback:', error);
        }
      });

      // Add to queue for stream generators
      messageQueue.push(message);
      
      state.messageResolvers.forEach((resolve) => resolve());
      state.messageResolvers.clear();
    } catch (error) {
      console.error('Error handling TabBus message:', error);
    }
  };

  bc.onmessageerror = () => {
    const errorEvent = createTabBusEvent('error', {
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
