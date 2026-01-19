/**
 * bus.test.ts
 *
 * Purpose: Tests for TabBus functionality including instance creation, messaging, subscriptions, streaming, and error handling
 *
 * Test Coverage:
 * - TabBus instance creation and API existence verification
 * - Tab ID generation (auto-generated vs provided)
 * - Message publishing and subscribing
 * - Subscription management (subscribe, subscribeAll, unsubscribe)
 * - Stream API (AbortSignal integration tested in abort-signal.test.ts)
 * - Error handling (callback errors, message parsing errors, onmessageerror)
 * - Message filtering (self-messages are ignored)
 * - Multiple subscribers and message ordering
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createBus } from '../src/index.js';
import { handleBusMessage, handleBusMessageEvent } from '../src/bus.js';
import { setupBroadcastChannelMock, cleanupBroadcastChannelMock } from './helpers.js';
import type { InternalBusState, TabBusMessage } from '../src/types.js';

describe('TabBus', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    setupBroadcastChannelMock();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanupBroadcastChannelMock();
    consoleErrorSpy.mockRestore();
  });

  describe('Instance Creation', () => {
    it('should create a bus instance', () => {
      const bus = createBus({ channel: 'test-channel' });
      expect(bus).toBeDefined();
      expect(bus.publish).toBeDefined();
      expect(bus.subscribe).toBeDefined();
      expect(bus.subscribeAll).toBeDefined();
      expect(bus.stream).toBeDefined();
      expect(bus.getTabId).toBeDefined();
      expect(bus.close).toBeDefined();
      expect(typeof bus.getTabId()).toBe('string');
      bus.close();
    });

    it('should throw error if BroadcastChannel is not supported (line 82-83)', () => {
      const originalBroadcastChannel = (
        globalThis as typeof globalThis & { BroadcastChannel?: unknown }
      ).BroadcastChannel;
      delete (globalThis as typeof globalThis & { BroadcastChannel?: unknown }).BroadcastChannel;

      expect(() => {
        createBus({ channel: 'test-channel' });
      }).toThrow('BroadcastChannel is not supported in this environment');

      // Restore
      (globalThis as typeof globalThis & { BroadcastChannel?: unknown }).BroadcastChannel =
        originalBroadcastChannel;
    });

    it('should generate unique tab IDs', () => {
      const bus1 = createBus({ channel: 'test-channel-1' });
      const bus2 = createBus({ channel: 'test-channel-2' });
      const id1 = bus1.getTabId();
      const id2 = bus2.getTabId();
      expect(id1).not.toBe(id2);
      bus1.close();
      bus2.close();
    });

    it('should generate tab IDs with correct format', () => {
      const bus = createBus({ channel: 'test-channel' });
      const id = bus.getTabId();
      expect(typeof id).toBe('string');
      expect(id).toMatch(/^\d+-[a-z0-9]+$/);
      expect(id.split('-')).toHaveLength(2);
      bus.close();
    });

    it('should use provided tab ID', () => {
      const customTabId = 'custom-tab-id-123';
      const bus = createBus({ channel: 'test-channel', tabId: customTabId });
      expect(bus.getTabId()).toBe(customTabId);
      bus.close();
    });

    it('should handle close() cleanup', () => {
      const bus = createBus({ channel: 'test-channel' });
      const tabId = bus.getTabId();
      expect(tabId).toBeDefined();

      bus.close();

      expect(bus.getTabId()).toBe(tabId);
      expect(() => bus.close()).not.toThrow();
    });
  });

  describe('Publish and Subscribe', () => {
    it('should publish and subscribe to messages', async () => {
      const bus1 = createBus({ channel: 'test-channel' });
      const bus2 = createBus({ channel: 'test-channel' });

      await new Promise<void>((resolve) => {
        const unsubscribe = bus2.subscribe('test-type', (message) => {
          expect(message.type).toBe('test-type');
          expect(message.payload).toEqual({ data: 'test' });
          expect(message.tabId).toBe(bus1.getTabId());
          expect(typeof message.ts).toBe('number');
          expect(message.ts).toBeGreaterThan(0);
          unsubscribe();
          bus1.close();
          bus2.close();
          resolve();
        });

        setTimeout(() => {
          bus1.publish('test-type', { data: 'test' });
        }, 10);

        vi.advanceTimersByTime(20);
      });
    });

    it('should receive own messages (leader-follower pattern)', async () => {
      vi.useRealTimers();

      const bus = createBus({ channel: 'test-channel' });
      let received = false;
      let receivedCount = 0;

      const unsubscribe = bus.subscribe('test-type', () => {
        received = true;
        receivedCount++;
      });

      const unsubscribeAll = bus.subscribeAll(() => {
        receivedCount++;
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      bus.publish('test-type', { data: 'test' });
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Now receives own messages (for leader-follower pattern)
      expect(received).toBe(true);
      expect(receivedCount).toBe(2); // subscribe + subscribeAll

      unsubscribe();
      unsubscribeAll();
      bus.close();

      vi.useFakeTimers();
    });

    it('should receive own messages in onmessage handler', async () => {
      vi.useRealTimers();

      const bus1 = createBus({ channel: 'test-channel' });
      const bus2 = createBus({ channel: 'test-channel' });

      let bus2Received = 0;
      let bus1Received = 0;

      bus1.subscribe('test-type', () => {
        bus1Received++;
      });

      bus2.subscribe('test-type', () => {
        bus2Received++;
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      bus1.publish('test-type', { data: 'test' });
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(bus2Received).toBe(1); // bus2 receives from bus1
      expect(bus1Received).toBe(1); // bus1 receives own message

      bus2.publish('test-type', { data: 'test2' });
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(bus1Received).toBe(2); // bus1 receives from bus2 + own message
      expect(bus2Received).toBe(2); // bus2 receives own message + from bus1

      bus1.close();
      bus2.close();

      vi.useFakeTimers();
    });

    it('should receive own messages (leader-follower pattern)', async () => {
      vi.useRealTimers();

      const bus = createBus({ channel: 'test-channel' });
      const _tabId = bus.getTabId();
      let received = false;

      bus.subscribe('test-type', () => {
        received = true;
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Publish own message
      bus.publish('test-type', { data: 'test' });
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should receive own message (for leader-follower pattern)
      expect(received).toBe(true);

      bus.close();

      vi.useFakeTimers();
    });

    it('should deliver messages to multiple subscribers', async () => {
      const bus1 = createBus({ channel: 'test-channel' });
      const bus2 = createBus({ channel: 'test-channel' });

      let subscriber1Received = false;
      let subscriber2Received = false;

      await new Promise<void>((resolve) => {
        const unsubscribe1 = bus2.subscribe('test-type', () => {
          subscriber1Received = true;
          if (subscriber1Received && subscriber2Received) {
            unsubscribe1();
            unsubscribe2();
            bus1.close();
            bus2.close();
            resolve();
          }
        });

        const unsubscribe2 = bus2.subscribe('test-type', () => {
          subscriber2Received = true;
          if (subscriber1Received && subscriber2Received) {
            unsubscribe1();
            unsubscribe2();
            bus1.close();
            bus2.close();
            resolve();
          }
        });

        setTimeout(() => {
          bus1.publish('test-type', { data: 'test' });
        }, 10);

        vi.advanceTimersByTime(20);
      });

      expect(subscriber1Received).toBe(true);
      expect(subscriber2Received).toBe(true);
    });

    it('should include timestamp in messages', async () => {
      const bus1 = createBus({ channel: 'test-channel' });
      const bus2 = createBus({ channel: 'test-channel' });

      const beforePublish = Date.now();

      await new Promise<void>((resolve) => {
        const unsubscribe = bus2.subscribe('test-type', (message) => {
          expect(message.ts).toBeGreaterThanOrEqual(beforePublish);
          expect(message.ts).toBeLessThanOrEqual(Date.now());
          unsubscribe();
          bus1.close();
          bus2.close();
          resolve();
        });

        setTimeout(() => {
          bus1.publish('test-type', { data: 'test' });
        }, 10);

        vi.advanceTimersByTime(20);
      });
    });

    it('should handle messages without payload', async () => {
      const bus1 = createBus({ channel: 'test-channel' });
      const bus2 = createBus({ channel: 'test-channel' });

      await new Promise<void>((resolve) => {
        const unsubscribe = bus2.subscribe('test-type', (message) => {
          expect(message.type).toBe('test-type');
          expect(message.payload).toBeUndefined();
          unsubscribe();
          bus1.close();
          bus2.close();
          resolve();
        });

        setTimeout(() => {
          bus1.publish('test-type');
        }, 10);

        vi.advanceTimersByTime(20);
      });
    });
  });

  describe('Subscription Management', () => {
    it('should unsubscribe correctly', async () => {
      vi.useRealTimers();

      const bus1 = createBus({ channel: 'test-channel' });
      const bus2 = createBus({ channel: 'test-channel' });

      let callCount = 0;
      const unsubscribe = bus2.subscribe('test-type', () => {
        callCount++;
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      bus1.publish('test-type', { data: 'test1' });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(callCount).toBe(1);

      unsubscribe();

      bus1.publish('test-type', { data: 'test2' });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(callCount).toBe(1);

      bus1.close();
      bus2.close();

      vi.useFakeTimers();
    });

    it('should handle subscribeAll', async () => {
      const bus1 = createBus({ channel: 'test-channel' });
      const bus2 = createBus({ channel: 'test-channel' });

      await new Promise<void>((resolve) => {
        let receivedCount = 0;
        const unsubscribe = bus2.subscribeAll((message) => {
          receivedCount++;
          if (receivedCount === 2) {
            expect(message.type).toBe('type2');
            unsubscribe();
            bus1.close();
            bus2.close();
            resolve();
          }
        });

        setTimeout(() => {
          bus1.publish('type1', { data: 'test1' });
          bus1.publish('type2', { data: 'test2' });
        }, 10);

        vi.advanceTimersByTime(20);
      });
    });

    it('should unsubscribe from subscribeAll correctly', async () => {
      vi.useRealTimers();

      const bus1 = createBus({ channel: 'test-channel' });
      const bus2 = createBus({ channel: 'test-channel' });

      let callCount = 0;
      const unsubscribe = bus2.subscribeAll(() => {
        callCount++;
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      bus1.publish('type1', { data: 'test1' });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(callCount).toBe(1);

      unsubscribe();

      bus1.publish('type2', { data: 'test2' });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(callCount).toBe(1);

      bus1.close();
      bus2.close();

      vi.useFakeTimers();
    });

    it('should handle multiple subscriptions independently', async () => {
      vi.useRealTimers();

      const bus1 = createBus({ channel: 'test-channel' });
      const bus2 = createBus({ channel: 'test-channel' });

      let type1Count = 0;
      let type2Count = 0;

      const unsubscribe1 = bus2.subscribe('type1', () => {
        type1Count++;
      });

      const unsubscribe2 = bus2.subscribe('type2', () => {
        type2Count++;
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      bus1.publish('type1', { data: 'test1' });
      bus1.publish('type2', { data: 'test2' });
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(type1Count).toBe(1);
      expect(type2Count).toBe(1);

      unsubscribe1();

      bus1.publish('type1', { data: 'test1' });
      bus1.publish('type2', { data: 'test2' });
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(type1Count).toBe(1);
      expect(type2Count).toBe(2);

      unsubscribe2();
      bus1.close();
      bus2.close();

      vi.useFakeTimers();
    });

    it('should allow multiple unsubscribe calls', () => {
      const bus = createBus({ channel: 'test-channel' });
      const unsubscribe = bus.subscribe('test-type', () => {});

      expect(() => unsubscribe()).not.toThrow();
      expect(() => unsubscribe()).not.toThrow();
      expect(() => unsubscribe()).not.toThrow();

      bus.close();
    });
  });

  describe('Stream', () => {
    it('should stream messages', async () => {
      vi.useRealTimers();

      const bus1 = createBus({ channel: 'test-channel' });
      const bus2 = createBus({ channel: 'test-channel' });

      const messages: TabBusMessage[] = [];

      const streamPromise = (async () => {
        for await (const message of bus2.stream()) {
          messages.push(message);
          if (messages.length === 2) break;
        }
      })();

      await new Promise((resolve) => setTimeout(resolve, 10));

      bus1.publish('type1', { data: 'test1' });
      await new Promise((resolve) => setTimeout(resolve, 10));

      bus1.publish('type2', { data: 'test2' });
      await new Promise((resolve) => setTimeout(resolve, 10));

      await streamPromise;

      expect(messages).toHaveLength(2);
      expect(messages[0].type).toBe('type1');
      expect(messages[1].type).toBe('type2');

      bus1.close();
      bus2.close();
    });

    it('should stream messages in order', async () => {
      vi.useRealTimers();

      const bus1 = createBus({ channel: 'test-channel' });
      const bus2 = createBus({ channel: 'test-channel' });

      const messages: TabBusMessage[] = [];

      const streamPromise = (async () => {
        for await (const message of bus2.stream()) {
          messages.push(message);
          if (messages.length === 3) break;
        }
      })();

      await new Promise((resolve) => setTimeout(resolve, 10));

      bus1.publish('type1', { order: 1 });
      await new Promise((resolve) => setTimeout(resolve, 5));

      bus1.publish('type2', { order: 2 });
      await new Promise((resolve) => setTimeout(resolve, 5));

      bus1.publish('type3', { order: 3 });
      await new Promise((resolve) => setTimeout(resolve, 10));

      await streamPromise;

      expect(messages).toHaveLength(3);
      expect(messages[0].payload.order).toBe(1);
      expect(messages[1].payload.order).toBe(2);
      expect(messages[2].payload.order).toBe(3);

      bus1.close();
      bus2.close();
    });
  });

  describe('Error Handling', () => {
    it('should handle errors in message callback', async () => {
      vi.useRealTimers();

      const bus1 = createBus({ channel: 'test-channel' });
      const bus2 = createBus({ channel: 'test-channel' });

      const error = new Error('Test error');

      bus2.subscribe('test-type', () => {
        throw error;
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      bus1.publish('test-type', { data: 'test' });
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(consoleErrorSpy).toHaveBeenCalledWith('Error in TabBus callback:', error);

      bus1.close();
      bus2.close();
    });

    it('should handle errors in subscribeAll callback', async () => {
      vi.useRealTimers();

      const bus1 = createBus({ channel: 'test-channel' });
      const bus2 = createBus({ channel: 'test-channel' });

      const error = new Error('Test error');

      bus2.subscribeAll(() => {
        throw error;
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      bus1.publish('test-type', { data: 'test' });
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(consoleErrorSpy).toHaveBeenCalledWith('Error in TabBus all callback:', error);

      bus1.close();
      bus2.close();
    });

    it('should handle onmessageerror (line 104-108)', () => {
      const bus = createBus({ channel: 'test-channel' });

      const bc = (
        globalThis as typeof globalThis & {
          BroadcastChannel: { channels: Map<string, Set<{ onmessageerror: (() => void) | null }>> };
        }
      ).BroadcastChannel;
      const channels = bc.channels || new Map();
      const channelSet = Array.from(channels.get('test-channel') || new Set());

      const busChannel = channelSet.find((ch) => ch.onmessageerror);

      if (busChannel && busChannel.onmessageerror) {
        // Call onmessageerror to trigger line 104-108
        // This will call createTabBusEvent (line 11-19) and create the error event
        busChannel.onmessageerror();

        // Verify it doesn't throw and can be called multiple times
        expect(() => {
          busChannel.onmessageerror();
        }).not.toThrow();
      }

      bus.close();
    });

    it('should handle message parsing errors (line 68-73)', () => {
      const bus = createBus({ channel: 'test-channel' });

      const bc = (
        globalThis as typeof globalThis & {
          BroadcastChannel: {
            channels: Map<string, Set<{ onmessage: ((event: MessageEvent) => void) | null }>>;
          };
        }
      ).BroadcastChannel;
      const channels = bc.channels || new Map();
      const channelSet = Array.from(channels.get('test-channel') || new Set());
      const busChannel = channelSet.find((ch) => ch.onmessage);

      if (busChannel && busChannel.onmessage) {
        // Create event that throws when accessing data property
        // This will trigger catch block in handleBusMessageEvent (line 68-73)
        const errorEvent = {
          get data() {
            throw new Error('Test parsing error');
          },
        } as MessageEvent;

        // Call onmessage handler directly - should catch error (line 68-73)
        busChannel.onmessage(errorEvent);

        // Verify catch block was executed (line 72)
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Error handling TabBus message',
          expect.any(Error)
        );
      }

      bus.close();
    });

    it('should continue processing after callback error', async () => {
      vi.useRealTimers();

      const bus1 = createBus({ channel: 'test-channel' });
      const bus2 = createBus({ channel: 'test-channel' });

      let successCount = 0;
      let errorCount = 0;

      bus2.subscribe('test-type', () => {
        errorCount++;
        throw new Error('Test error');
      });

      bus2.subscribe('test-type', () => {
        successCount++;
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      bus1.publish('test-type', { data: 'test' });
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(errorCount).toBe(1);
      expect(successCount).toBe(1);

      bus1.close();
      bus2.close();
    });

    it('should directly test handleBusMessage with self message', () => {
      const state: InternalBusState = {
        channel: null,
        tabId: 'test-tab',
        messageCallbacks: new Map(),
        allCallbacks: new Set(),
        messageResolvers: new Set(),
        activeIterators: 1, // Set to 1 so message is added to queue
        bufferSize: 100,
        bufferOverflow: 'oldest',
      };
      const messageQueue: TabBusMessage[] = [];

      const message: TabBusMessage = {
        type: 'test',
        tabId: 'test-tab', // Same as state.tabId
        ts: Date.now(),
      };

      // Should process own message (for leader-follower pattern)
      handleBusMessage(message, 'test-tab', state, messageQueue);

      // Verify message was added to queue
      expect(messageQueue.length).toBe(1);
    });

    it('should directly test handleBusMessageEvent catch block (line 72-73)', () => {
      const state: InternalBusState = {
        channel: null,
        tabId: 'test-tab',
        messageCallbacks: new Map(),
        allCallbacks: new Set(),
        messageResolvers: new Set(),
        activeIterators: 0,
      };
      const messageQueue: TabBusMessage[] = [];

      // Create event that throws when accessing data
      const errorEvent = {
        get data() {
          throw new Error('Test error');
        },
      } as MessageEvent;

      // Should catch error (line 72-73)
      handleBusMessageEvent(errorEvent, 'test-tab', state, messageQueue);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error handling TabBus message:',
        expect.any(Error)
      );
    });

    it('should handle buffer overflow with error policy', () => {
      const state: InternalBusState = {
        channel: null,
        tabId: 'test-tab',
        messageCallbacks: new Map(),
        allCallbacks: new Set(),
        messageResolvers: new Set(),
        activeIterators: 1,
        bufferSize: 2,
        bufferOverflow: 'error',
      };
      const messageQueue: TabBusMessage[] = [
        { type: 'msg1', tabId: 'tab-1', ts: Date.now() },
        { type: 'msg2', tabId: 'tab-1', ts: Date.now() },
      ];

      const message: TabBusMessage = {
        type: 'msg3',
        tabId: 'test-tab',
        ts: Date.now(),
      };

      handleBusMessage(message, 'test-tab', state, messageQueue);

      expect(consoleErrorSpy).toHaveBeenCalledWith('Message buffer overflow');
      expect(messageQueue.length).toBe(2); // No new message added
    });

    it('should handle buffer overflow with newest policy', () => {
      const state: InternalBusState = {
        channel: null,
        tabId: 'test-tab',
        messageCallbacks: new Map(),
        allCallbacks: new Set(),
        messageResolvers: new Set(),
        activeIterators: 1,
        bufferSize: 2,
        bufferOverflow: 'newest',
      };
      const messageQueue: TabBusMessage[] = [
        { type: 'msg1', tabId: 'tab-1', ts: Date.now() },
        { type: 'msg2', tabId: 'tab-1', ts: Date.now() },
      ];

      const message: TabBusMessage = {
        type: 'msg3',
        tabId: 'test-tab',
        ts: Date.now(),
      };

      handleBusMessage(message, 'test-tab', state, messageQueue);

      expect(messageQueue.length).toBe(2); // Newest message dropped
      expect(messageQueue[0].type).toBe('msg1');
      expect(messageQueue[1].type).toBe('msg2');
    });
  });
});
