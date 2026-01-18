/**
 * basic.test.ts
 * 
 * Purpose: Tests for TabBus and LeaderElector basic functionality
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createBus, createLeaderElector } from '../src/index.js';
import { setupBroadcastChannelMock, cleanupBroadcastChannelMock } from './helpers.js';

describe('TabBus Basic Functionality', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setupBroadcastChannelMock();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanupBroadcastChannelMock();
  });

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

  it('should generate unique tab IDs', () => {
    const bus1 = createBus({ channel: 'test-channel-1' });
    const bus2 = createBus({ channel: 'test-channel-2' });
    const id1 = bus1.getTabId();
    const id2 = bus2.getTabId();
    expect(id1).not.toBe(id2);
    bus1.close();
    bus2.close();
  });

  it('should use provided tab ID', () => {
    const customTabId = 'custom-tab-id-123';
    const bus = createBus({ channel: 'test-channel', tabId: customTabId });
    expect(bus.getTabId()).toBe(customTabId);
    bus.close();
  });

  it('should publish and subscribe to messages', async () => {
    const bus1 = createBus({ channel: 'test-channel' });
    const bus2 = createBus({ channel: 'test-channel' });

    await new Promise<void>((resolve) => {
      const unsubscribe = bus2.subscribe('test-type', (message) => {
        expect(message.type).toBe('test-type');
        expect(message.payload).toEqual({ data: 'test' });
        expect(message.tabId).toBe(bus1.getTabId());
        unsubscribe();
        bus1.close();
        bus2.close();
        resolve();
      });

      // Small delay to ensure subscription is set up
      setTimeout(() => {
        bus1.publish('test-type', { data: 'test' });
      }, 10);

      vi.advanceTimersByTime(20);
    });
  });

  it('should unsubscribe correctly', async () => {
    vi.useRealTimers(); // Use real timers for this test
    
    const bus1 = createBus({ channel: 'test-channel' });
    const bus2 = createBus({ channel: 'test-channel' });

    let callCount = 0;
    const unsubscribe = bus2.subscribe('test-type', () => {
      callCount++;
    });

    // Wait a bit for subscription to be set up
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Publish first message
    bus1.publish('test-type', { data: 'test1' });
    // Wait for message to be processed
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(callCount).toBe(1);

    // Unsubscribe
    unsubscribe();
    
    // Publish second message - should not be received
    bus1.publish('test-type', { data: 'test2' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(callCount).toBe(1); // Should not increase

    bus1.close();
    bus2.close();
    
    vi.useFakeTimers(); // Restore fake timers
  });

  it('should handle subscribeAll', async () => {
    const bus1 = createBus({ channel: 'test-channel' });
    const bus2 = createBus({ channel: 'test-channel' });

    await new Promise<void>((resolve) => {
      let receivedCount = 0;
      const unsubscribe = bus2.subscribeAll((message) => {
        receivedCount++;
        if (receivedCount === 2) {
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
});

describe('LeaderElector Basic Functionality', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
  });

  afterEach(() => {
    vi.useRealTimers();
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
  });

  it('should create a leader elector instance', () => {
    const leader = createLeaderElector({
      key: 'test-leader',
      tabId: 'tab-1',
    });
    expect(leader).toBeDefined();
    expect(leader.start).toBeDefined();
    expect(leader.stop).toBeDefined();
    expect(leader.isLeader).toBeDefined();
    expect(leader.on).toBeDefined();
    expect(leader.onAll).toBeDefined();
    expect(leader.stream).toBeDefined();
    expect(leader.getTabId).toBeDefined();
    expect(leader.getTabId()).toBe('tab-1');
    leader.stop();
  });

  it('should acquire leadership when started', async () => {
    const leader = createLeaderElector({
      key: 'test-leader',
      tabId: 'tab-1',
      leaseMs: 5000,
      heartbeatMs: 1000,
    });

    await new Promise<void>((resolve) => {
      leader.on('acquired', () => {
        expect(leader.isLeader()).toBe(true);
        leader.stop();
        resolve();
      });

      leader.start();
      vi.advanceTimersByTime(100);
    });
  });

  it('should not be leader initially', () => {
    const leader = createLeaderElector({
      key: 'test-leader',
      tabId: 'tab-1',
    });
    expect(leader.isLeader()).toBe(false);
    leader.stop();
  });

  it('should handle multiple tabs competing for leadership', async () => {
    const leader1 = createLeaderElector({
      key: 'test-leader',
      tabId: 'tab-1',
      leaseMs: 5000,
      heartbeatMs: 1000,
    });

    const leader2 = createLeaderElector({
      key: 'test-leader',
      tabId: 'tab-2',
      leaseMs: 5000,
      heartbeatMs: 1000,
    });

    let leader1Acquired = false;
    let leader2Acquired = false;

    leader1.on('acquired', () => {
      leader1Acquired = true;
      expect(leader1.isLeader()).toBe(true);
    });

    leader2.on('acquired', () => {
      leader2Acquired = true;
      expect(leader2.isLeader()).toBe(true);
    });

    leader1.start();
    vi.advanceTimersByTime(100);

    leader2.start();
    vi.advanceTimersByTime(100);

    // Only one should be leader
    const leaderCount = [leader1, leader2].filter(l => l.isLeader()).length;
    expect(leaderCount).toBeLessThanOrEqual(1);

    await new Promise<void>((resolve) => {
      setTimeout(() => {
        leader1.stop();
        leader2.stop();
        resolve();
      }, 100);

      vi.advanceTimersByTime(200);
    });
  });

  it('should emit lost event when stopped', async () => {
    const leader = createLeaderElector({
      key: 'test-leader',
      tabId: 'tab-1',
      leaseMs: 5000,
      heartbeatMs: 1000,
    });

    await new Promise<void>((resolve) => {
      leader.on('acquired', () => {
        leader.stop();
      });

      leader.on('lost', () => {
        expect(leader.isLeader()).toBe(false);
        resolve();
      });

      leader.start();
      vi.advanceTimersByTime(200);
    });
  });
});
