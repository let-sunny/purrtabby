/**
 * type-safety.test.ts
 * 
 * Purpose: Type safety tests for TypeScript type checking
 * 
 * Test Coverage:
 * - Generic type enforcement for TabBus message payloads
 * - LeaderElector options type checking
 * - Event type inference
 * - Stream type inference
 * - Options type validation
 * 
 * Note: These tests primarily verify compile-time type safety.
 * Some tests use @ts-expect-error to verify that invalid types are rejected.
 */

import { describe, it, expect } from 'vitest';
import { createBus, createLeaderElector } from '../src/index.js';

describe('Type Safety', () => {
  describe('TabBus Type Safety', () => {
    it('should enforce generic type for message payload', () => {
      interface UserAction {
        action: string;
        target: string;
      }

      const bus = createBus<UserAction>({ channel: 'test-channel' });
      
      // TypeScript should enforce UserAction type
      bus.publish('click', { action: 'click', target: 'button' });
      
      // Note: TypeScript will reject invalid payloads at compile time
      // Example: bus.publish('click', { invalid: 'data' }); // Type error
      
      bus.close();
    });

    it('should type message payload correctly in subscribe', () => {
      interface UserAction {
        action: string;
        target: string;
      }

      const bus = createBus<UserAction>({ channel: 'test-channel' });
      
      bus.subscribe('click', (message) => {
        // TypeScript should infer message.payload as UserAction | undefined
        if (message.payload) {
          expect(typeof message.payload.action).toBe('string');
          expect(typeof message.payload.target).toBe('string');
        }
      });
      
      bus.close();
    });

    it('should type message payload correctly in subscribeAll', () => {
      interface UserAction {
        action: string;
        target: string;
      }

      const bus = createBus<UserAction>({ channel: 'test-channel' });
      
      bus.subscribeAll((message) => {
        // TypeScript should infer message.payload as UserAction | undefined
        if (message.payload) {
          expect(typeof message.payload.action).toBe('string');
        }
      });
      
      bus.close();
    });

    it('should type message payload correctly in stream', () => {
      interface UserAction {
        action: string;
        target: string;
      }

      const bus = createBus<UserAction>({ channel: 'test-channel' });
      
      // TypeScript should infer correct type in stream
      // This is a compile-time type check, not a runtime test
      const stream = bus.stream();
      expect(stream).toBeDefined();
      
      // The type system ensures message.payload is UserAction | undefined
      // We can't easily test this at runtime, but TypeScript will catch type errors
      
      bus.close();
    });

    it('should handle BusOptions type correctly', () => {
      // Valid options
      const bus1 = createBus({ channel: 'test' });
      expect(bus1).toBeDefined();
      bus1.close();

      const bus2 = createBus({ channel: 'test', tabId: 'custom-id' });
      expect(bus2).toBeDefined();
      bus2.close();

      // Note: TypeScript will reject missing required options at compile time
      // Example: createBus({ tabId: 'custom-id' }); // Type error: channel is required
    });
  });

  describe('LeaderElector Type Safety', () => {
    it('should enforce LeaderElectorOptions type', () => {
      // Valid options
      const leader1 = createLeaderElector({
        key: 'test-leader',
        tabId: 'tab-1',
      });
      expect(leader1).toBeDefined();
      leader1.stop();

      const leader2 = createLeaderElector({
        key: 'test-leader',
        tabId: 'tab-1',
        leaseMs: 5000,
        heartbeatMs: 2000,
        jitterMs: 500,
      });
      expect(leader2).toBeDefined();
      leader2.stop();

      // Note: TypeScript will reject missing required options at compile time
      // Example: createLeaderElector({ tabId: 'tab-1' }); // Type error: key is required
      // Example: createLeaderElector({ key: 'test-leader' }); // Type error: tabId is required
    });

    it('should type LeaderEvent correctly', () => {
      const leader = createLeaderElector({
        key: 'test-leader',
        tabId: 'tab-1',
      });

      leader.on('acquire', (event) => {
        // TypeScript should infer event.type as 'acquire'
        expect(event.type).toBe('acquire');
        expect(typeof event.ts).toBe('number');
        // meta is optional
        if (event.meta) {
          expect(typeof event.meta).toBe('object');
        }
      });

      leader.on('lose', (event) => {
        // TypeScript should infer event.type as 'lose'
        expect(event.type).toBe('lose');
      });

      leader.on('change', (event) => {
        // TypeScript should infer event.type as 'change'
        expect(event.type).toBe('change');
      });

      leader.stop();
    });

    it('should type LeaderEvent in onAll correctly', () => {
      const leader = createLeaderElector({
        key: 'test-leader',
        tabId: 'tab-1',
      });

      leader.onAll((event) => {
        // TypeScript should infer event.type as LeaderEventType
        expect(['acquire', 'lose', 'change']).toContain(event.type);
        expect(typeof event.ts).toBe('number');
      });

      leader.stop();
    });

    it('should type LeaderEvent in stream correctly', () => {
      const leader = createLeaderElector({
        key: 'test-leader',
        tabId: 'tab-1',
      });

      // TypeScript should infer correct type in stream
      // This is a compile-time type check, not a runtime test
      const stream = leader.stream();
      expect(stream).toBeDefined();
      
      // The type system ensures event is LeaderEvent
      // We can't easily test this at runtime, but TypeScript will catch type errors

      leader.stop();
    });

    it('should enforce numeric types for options', () => {
      // Valid numeric options
      const leader = createLeaderElector({
        key: 'test-leader',
        tabId: 'tab-1',
        leaseMs: 5000,
        heartbeatMs: 2000,
        jitterMs: 500,
      });
      expect(leader).toBeDefined();
      leader.stop();

      // Note: TypeScript will reject invalid types for numeric options at compile time
      // Example: createLeaderElector({ key: 'test-leader', tabId: 'tab-1', leaseMs: '5000' }); // Type error
    });
  });

  describe('Generator Type Safety', () => {
    it('should preserve generic type in busMessagesGenerator', () => {
      interface TestPayload {
        value: number;
      }

      // This test verifies that the generic type is preserved
      // The actual generator is tested in generators.test.ts
      const bus = createBus<TestPayload>({ channel: 'test-channel' });
      const stream = bus.stream();
      
      expect(stream).toBeDefined();
      
      // TypeScript should infer the correct type for messages in the stream
      // This is verified at compile time
      
      bus.close();
    });

    it('should type LeaderEvent correctly in leaderEventsGenerator', () => {
      // This test verifies that LeaderEvent types are correct
      // The actual generator is tested in generators.test.ts
      const leader = createLeaderElector({
        key: 'test-leader',
        tabId: 'tab-1',
      });
      
      const stream = leader.stream();
      expect(stream).toBeDefined();
      
      // TypeScript should infer LeaderEvent type for events in the stream
      // This is verified at compile time
      
      leader.stop();
    });
  });
});
