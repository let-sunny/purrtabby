/**
 * generators.test.ts
 * 
 * Purpose: Tests for async generator functions (busMessagesGenerator and leaderEventsGenerator)
 * 
 * Test Coverage:
 * - busMessagesGenerator basic message streaming
 * - busMessagesGenerator queue management (multiple messages, queue clearing)
 * - leaderEventsGenerator basic event streaming
 * - leaderEventsGenerator queue management
 * - Iterator lifecycle (activeIterators counter, queue clearing on last iterator)
 * - waitForItems basic paths: hasItems check, polling
 * 
 * Boundaries:
 * - Generator functions are used internally by bus.ts and leader.ts
 * - These tests verify the generator logic in isolation
 * - AbortSignal integration is tested in detail in abort-signal.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { busMessagesGenerator, leaderEventsGenerator } from '../src/generators.js';
import { createLeaderEvent } from '../src/utils.js';
import type { InternalBusState, InternalLeaderState, TabBusMessage, LeaderEvent } from '../src/types.js';

describe('busMessagesGenerator', () => {
  let state: InternalBusState;
  let queue: { messages: TabBusMessage[] };

  beforeEach(() => {
    vi.useFakeTimers();
    queue = { messages: [] };
    state = {
      channel: null,
      tabId: 'test-tab',
      messageCallbacks: new Map(),
      allCallbacks: new Set(),
      messageResolvers: new Set(),
      activeIterators: 0,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should yield messages from queue', async () => {
    const message1: TabBusMessage = { type: 'test1', tabId: 'tab1', ts: Date.now() };
    const message2: TabBusMessage = { type: 'test2', tabId: 'tab1', ts: Date.now() };
    queue.messages = [message1, message2];

    const generator = busMessagesGenerator(state, queue);
    const results: TabBusMessage[] = [];

    // Consume first message
    const result1 = await generator.next();
    expect(result1.done).toBe(false);
    expect(result1.value).toEqual(message1);
    results.push(result1.value);

    // Consume second message
    const result2 = await generator.next();
    expect(result2.done).toBe(false);
    expect(result2.value).toEqual(message2);
    results.push(result2.value);

    expect(results).toHaveLength(2);
    expect(state.activeIterators).toBe(1);
  });


  it('should wait for new messages when queue is empty', async () => {
    vi.useRealTimers();
    
    const generator = busMessagesGenerator(state, queue);
    let resolved = false;

    // Start consuming (queue is empty, should wait)
    const consumePromise = generator.next().then(() => {
      resolved = true;
    });

    // Wait a bit to ensure it's waiting
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(resolved).toBe(false);

    // Add message to queue and trigger resolver
    const message: TabBusMessage = { type: 'test', tabId: 'tab1', ts: Date.now() };
    queue.messages.push(message);
    state.messageResolvers.forEach(resolve => resolve());
    state.messageResolvers.clear();

    // Wait for message to be consumed
    await new Promise(resolve => setTimeout(resolve, 50));

    // Should have consumed the message
    await consumePromise;
    expect(resolved).toBe(true);
    
    vi.useFakeTimers();
  });


  it('should resolve immediately if items exist in waitForItems (line 46-48)', async () => {
    vi.useRealTimers();
    
    const queue: { messages: TabBusMessage[] } = {
      messages: [{ type: 'test', tabId: 'tab1', ts: Date.now() }],
    };

    const state: InternalBusState = {
      channel: null,
      tabId: 'test-tab',
      messageCallbacks: new Map(),
      allCallbacks: new Set(),
      messageResolvers: new Set(),
      activeIterators: 0,
    };

    const generator = busMessagesGenerator(state, queue);
    
    // Should resolve immediately (line 45-48)
    // waitForItems will check hasItems() first (line 45)
    // Since queue has items, it will call doResolve() and return (line 46-48)
    const result = await generator.next();
    expect(result.done).toBe(false);
    expect(result.value).toBeDefined();
    
    vi.useFakeTimers();
  });

  it('should use polling when no AbortSignal provided (line 52-58)', async () => {
    vi.useRealTimers();
    
    const queue: { messages: TabBusMessage[] } = { messages: [] };
    const state: InternalBusState = {
      channel: null,
      tabId: 'test-tab',
      messageCallbacks: new Map(),
      allCallbacks: new Set(),
      messageResolvers: new Set(),
      activeIterators: 0,
    };

    const generator = busMessagesGenerator(state, queue);
    let resolved = false;

    const consumePromise = generator.next().then(() => {
      resolved = true;
    });

    // Wait a bit to ensure polling started
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(resolved).toBe(false);

    // Add message (polling should detect it - line 52-58)
    queue.messages.push({ type: 'test', tabId: 'tab1', ts: Date.now() });
    
    // Wait for polling to detect (polling happens every 100ms)
    await new Promise(resolve => setTimeout(resolve, 150));

    await consumePromise;
    expect(resolved).toBe(true);
    
    vi.useFakeTimers();
  });


  it('should clear queue when last iterator ends', async () => {
    const message: TabBusMessage = { type: 'test', tabId: 'tab1', ts: Date.now() };
    queue.messages = [message];

    const generator = busMessagesGenerator(state, queue);
    
    // Consume message
    await generator.next();
    
    // Add more messages
    queue.messages.push({ type: 'test2', tabId: 'tab1', ts: Date.now() });
    
    // End iterator
    await generator.return(undefined);

    // Queue should be cleared
    expect(queue.messages).toHaveLength(0);
    expect(state.activeIterators).toBe(0);
  });

  it('should handle multiple iterators independently', async () => {
    const message1: TabBusMessage = { type: 'test1', tabId: 'tab1', ts: Date.now() };
    const message2: TabBusMessage = { type: 'test2', tabId: 'tab1', ts: Date.now() };
    queue.messages = [message1, message2];

    const generator1 = busMessagesGenerator(state, queue);
    const generator2 = busMessagesGenerator(state, queue);

    // Start both generators (activeIterators increases when next() is called)
    const promise1 = generator1.next();
    const promise2 = generator2.next();

    // Both should get messages
    const result1 = await promise1;
    const result2 = await promise2;

    expect(state.activeIterators).toBe(2);
    expect(result1.value).toBeDefined();
    expect(result2.value).toBeDefined();

    await generator1.return(undefined);
    expect(state.activeIterators).toBe(1);

    await generator2.return(undefined);
    expect(state.activeIterators).toBe(0);
    expect(queue.messages).toHaveLength(0);
  });
});

describe('leaderEventsGenerator', () => {
  let state: InternalLeaderState;
  let queue: { events: LeaderEvent[] };

  beforeEach(() => {
    vi.useFakeTimers();
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
    queue = { events: [] };
    state = {
      key: 'test-key',
      tabId: 'test-tab',
      leaseMs: 5000,
      heartbeatMs: 2000,
      jitterMs: 500,
      isLeader: false,
      heartbeatTimer: null,
      checkTimer: null,
      eventCallbacks: new Map(),
      allCallbacks: new Set(),
      eventResolvers: new Set(),
      activeIterators: 0,
      stopped: false,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
  });

  it('should yield events from queue', async () => {
    const event1 = createLeaderEvent('acquire', { tabId: 'tab1' });
    const event2 = createLeaderEvent('lose', { tabId: 'tab1' });
    queue.events = [event1, event2];

    const generator = leaderEventsGenerator(state, queue);
    const results: LeaderEvent[] = [];

    const result1 = await generator.next();
    expect(result1.done).toBe(false);
    expect(result1.value).toEqual(event1);
    results.push(result1.value);

    const result2 = await generator.next();
    expect(result2.done).toBe(false);
    expect(result2.value).toEqual(event2);
    results.push(result2.value);

    expect(results).toHaveLength(2);
    expect(state.activeIterators).toBe(1);
  });


  it('should wait for new events when queue is empty', async () => {
    vi.useRealTimers();
    
    const generator = leaderEventsGenerator(state, queue);
    let resolved = false;

    const consumePromise = generator.next().then(() => {
      resolved = true;
    });

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(resolved).toBe(false);

    const event = createLeaderEvent('acquire', { tabId: 'tab1' });
    queue.events.push(event);
    state.eventResolvers.forEach(resolve => resolve());
    state.eventResolvers.clear();

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(resolved).toBe(true);
    
    vi.useFakeTimers();
  });

  it('should clear queue when last iterator ends', async () => {
    const event = createLeaderEvent('acquire', { tabId: 'tab1' });
    queue.events = [event];

    const generator = leaderEventsGenerator(state, queue);
    await generator.next();
    
    queue.events.push(createLeaderEvent('lose', { tabId: 'tab1' }));
    await generator.return(undefined);

    expect(queue.events).toHaveLength(0);
    expect(state.activeIterators).toBe(0);
  });

  it('should handle multiple iterators independently', async () => {
    const event1 = createLeaderEvent('acquire', { tabId: 'tab1' });
    const event2 = createLeaderEvent('lose', { tabId: 'tab1' });
    queue.events = [event1, event2];

    const generator1 = leaderEventsGenerator(state, queue);
    const generator2 = leaderEventsGenerator(state, queue);

    // Start both generators
    const promise1 = generator1.next();
    const promise2 = generator2.next();

    const result1 = await promise1;
    const result2 = await promise2;

    expect(state.activeIterators).toBe(2);
    expect(result1.value).toBeDefined();
    expect(result2.value).toBeDefined();

    await generator1.return(undefined);
    expect(state.activeIterators).toBe(1);

    await generator2.return(undefined);
    expect(state.activeIterators).toBe(0);
    expect(queue.events).toHaveLength(0);
  });

});
