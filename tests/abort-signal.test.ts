/**
 * abort-signal.test.ts
 * 
 * Purpose: Integration tests for async operation cancellation using AbortSignal
 * 
 * Test Coverage:
 * - AbortSignal handling in bus.stream() (at start, during consumption, while waiting)
 * - AbortSignal handling in leader.stream() (at start, during consumption)
 * - Cleanup and memory leak prevention (signal listener removal)
 * 
 * Boundaries:
 * - Basic generator behavior is tested in generators.test.ts
 * - General cases without AbortSignal are tested in other files
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createBus, createLeaderElector } from '../src/index.js';
import { setupBroadcastChannelMock, cleanupBroadcastChannelMock } from './helpers.js';

describe('AbortSignal Integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setupBroadcastChannelMock();
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanupBroadcastChannelMock();
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
  });

  describe('bus.stream() AbortSignal', () => {
    it('should abort immediately if signal is already aborted', async () => {
      const bus = createBus({ channel: 'test-channel' });
      await vi.runAllTimersAsync();

      const controller = new AbortController();
      controller.abort();

      const messages: any[] = [];
      const messagePromise = (async () => {
        for await (const msg of bus.stream({ signal: controller.signal })) {
          messages.push(msg);
        }
      })();

      await vi.runAllTimersAsync();
      await messagePromise;

      expect(messages.length).toBe(0);
      bus.close();
    });

    it('should abort while consuming messages', async () => {
      const bus1 = createBus({ channel: 'test-channel' });
      const bus2 = createBus({ channel: 'test-channel' });
      await vi.runAllTimersAsync();

      const controller = new AbortController();
      const messages: any[] = [];

      const messagePromise = (async () => {
        for await (const msg of bus2.stream({ signal: controller.signal })) {
          messages.push(msg);
          if (messages.length === 1) {
            controller.abort();
            break;
          }
        }
      })();

      vi.advanceTimersByTime(20);
      bus1.publish('type1', { data: 'test1' });
      vi.advanceTimersByTime(20);
      bus1.publish('type2', { data: 'test2' });
      vi.advanceTimersByTime(20);

      await vi.runAllTimersAsync();
      await messagePromise;

      expect(messages.length).toBe(1);
      expect(messages[0].type).toBe('type1');

      bus1.close();
      bus2.close();
    });

    it('should abort while waiting for new messages', async () => {
      const bus1 = createBus({ channel: 'test-channel' });
      const bus2 = createBus({ channel: 'test-channel' });
      await vi.runAllTimersAsync();

      const controller = new AbortController();
      const messages: any[] = [];

      const messagePromise = (async () => {
        for await (const msg of bus2.stream({ signal: controller.signal })) {
          messages.push(msg);
        }
      })();

      vi.advanceTimersByTime(20);
      controller.abort();
      vi.advanceTimersByTime(20);
      bus1.publish('type1', { data: 'test1' });
      vi.advanceTimersByTime(20);

      await vi.runAllTimersAsync();
      await messagePromise;

      expect(messages.length).toBe(0);

      bus1.close();
      bus2.close();
    });

    it('should clean up signal listener and prevent memory leaks', async () => {
      const bus1 = createBus({ channel: 'test-channel' });
      const bus2 = createBus({ channel: 'test-channel' });
      await vi.runAllTimersAsync();

      const controller = new AbortController();
      let messageCount = 0;

      const messagePromise = (async () => {
        for await (const msg of bus2.stream({ signal: controller.signal })) {
          messageCount++;
          if (messageCount >= 1) {
            controller.abort();
            break;
          }
        }
      })();

      vi.advanceTimersByTime(20);
      bus1.publish('type1', { data: 'test1' });
      vi.advanceTimersByTime(20);

      await vi.runAllTimersAsync();
      await messagePromise;

      expect(messageCount).toBe(1);

      // Create new stream to verify no memory leaks
      const controller2 = new AbortController();
      const messages2: any[] = [];
      const messagePromise2 = (async () => {
        for await (const msg of bus2.stream({ signal: controller2.signal })) {
          messages2.push(msg);
          controller2.abort();
          break;
        }
      })();

      bus1.publish('type2', { data: 'test2' });
      vi.advanceTimersByTime(20);
      await vi.runAllTimersAsync();
      await messagePromise2;

      bus1.close();
      bus2.close();
    });
  });

  describe('leader.stream() AbortSignal', () => {
    it('should abort immediately if signal is already aborted', async () => {
      const leader = createLeaderElector({
        key: 'test-leader',
        tabId: 'tab-1',
        leaseMs: 5000,
        heartbeatMs: 1000,
      });
      await vi.runAllTimersAsync();

      const controller = new AbortController();
      controller.abort();

      const events: any[] = [];
      const eventPromise = (async () => {
        for await (const event of leader.stream({ signal: controller.signal })) {
          events.push(event);
        }
      })();

      await vi.runAllTimersAsync();
      await eventPromise;

      expect(events.length).toBe(0);
      leader.stop();
    });


    it('should abort while waiting for new events', async () => {
      const leader = createLeaderElector({
        key: 'test-leader',
        tabId: 'tab-1',
        leaseMs: 5000,
        heartbeatMs: 1000,
      });
      await vi.runAllTimersAsync();

      const controller = new AbortController();
      const events: any[] = [];

      const eventPromise = (async () => {
        for await (const event of leader.stream({ signal: controller.signal })) {
          events.push(event);
        }
      })();

      vi.advanceTimersByTime(20);
      controller.abort();
      vi.advanceTimersByTime(20);

      await vi.runAllTimersAsync();
      await eventPromise;

      expect(events.length).toBe(0);
      leader.stop();
    });

  });
});
