import { describe, it, expect, vi } from 'vitest';
import {
  generateTabId,
  createTabBusEvent,
  createLeaderEvent,
  addJitter,
  executeCallbacks,
  handleBufferOverflow,
  removeLeaderLease,
} from '../src/utils.js';

describe('Utils', () => {
  describe('generateTabId', () => {
    it('should generate unique tab IDs', () => {
      const id1 = generateTabId();
      const id2 = generateTabId();

      expect(id1).toBeTruthy();
      expect(id2).toBeTruthy();
      expect(id1).not.toBe(id2);
      expect(typeof id1).toBe('string');
    });
  });

  describe('createTabBusEvent', () => {
    it('should create a TabBus event', () => {
      const event = createTabBusEvent('msg');

      expect(event.type).toBe('msg');
      expect(typeof event.ts).toBe('number');
      expect(event.meta).toBeUndefined();
    });

    it('should create a TabBus event with meta', () => {
      const meta = { error: 'test' };
      const event = createTabBusEvent('err', meta);

      expect(event.type).toBe('err');
      expect(event.meta).toEqual(meta);
      expect(typeof event.ts).toBe('number');
    });
  });

  describe('createLeaderEvent', () => {
    it('should create a Leader event', () => {
      const event = createLeaderEvent('acquire');

      expect(event.type).toBe('acquire');
      expect(typeof event.ts).toBe('number');
      expect(event.meta).toBeUndefined();
    });

    it('should create a Leader event with meta', () => {
      const meta = { tabId: 'tab-1' };
      const event = createLeaderEvent('lose', meta);

      expect(event.type).toBe('lose');
      expect(event.meta).toEqual(meta);
      expect(typeof event.ts).toBe('number');
    });
  });

  describe('addJitter', () => {
    it('should add jitter to a value', () => {
      const value = 1000;
      const jitterMs = 100;

      const result = addJitter(value, jitterMs);

      expect(result).toBeGreaterThanOrEqual(900);
      expect(result).toBeLessThanOrEqual(1100);
    });

    it('should not return negative values', () => {
      const value = 10;
      const jitterMs = 1000;

      const result = addJitter(value, jitterMs);

      expect(result).toBeGreaterThanOrEqual(0);
    });

    it('should handle zero jitter', () => {
      const value = 1000;
      const jitterMs = 0;

      const result = addJitter(value, jitterMs);

      expect(result).toBe(1000);
    });
  });

  describe('executeCallbacks', () => {
    it('should execute all callbacks', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const callbacks = new Set([callback1, callback2]);
      const arg = { test: 'data' };

      executeCallbacks(callbacks, arg, 'Error:');

      expect(callback1).toHaveBeenCalledWith(arg);
      expect(callback2).toHaveBeenCalledWith(arg);
    });

    it('should handle undefined callbacks', () => {
      const arg = { test: 'data' };

      expect(() => executeCallbacks(undefined, arg, 'Error:')).not.toThrow();
    });

    it('should handle empty callbacks set', () => {
      const callbacks = new Set<(arg: { test: string }) => void>();
      const arg = { test: 'data' };

      expect(() => executeCallbacks(callbacks, arg, 'Error:')).not.toThrow();
    });

    it('should catch and log errors from callbacks', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const error = new Error('Test error');
      const failingCallback = vi.fn(() => {
        throw error;
      });
      const successCallback = vi.fn();
      const callbacks = new Set([failingCallback, successCallback]);
      const arg = { test: 'data' };

      executeCallbacks(callbacks, arg, 'Error in callback:');

      expect(failingCallback).toHaveBeenCalledWith(arg);
      expect(successCallback).toHaveBeenCalledWith(arg);
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error in callback:', error);

      consoleErrorSpy.mockRestore();
    });
  });

  describe('handleBufferOverflow', () => {
    it('should return add action when buffer has space', () => {
      const buffer: Array<{ test: string }> = [];
      const bufferSize = 10;
      const newItem = { test: 'item' };

      const result = handleBufferOverflow('oldest', buffer, newItem, bufferSize);

      expect(result.action).toBe('add');
    });

    it('should drop oldest when policy is oldest', () => {
      const buffer = [{ id: 1 }, { id: 2 }, { id: 3 }];
      const bufferSize = 3;
      const newItem = { id: 4 };

      const result = handleBufferOverflow('oldest', buffer, newItem, bufferSize);

      expect(result.action).toBe('drop_oldest');
      expect(result.dropped).toEqual({ id: 1 });
      expect(buffer.length).toBe(2); // Oldest removed
    });

    it('should drop newest when policy is newest', () => {
      const buffer = [{ id: 1 }, { id: 2 }, { id: 3 }];
      const bufferSize = 3;
      const newItem = { id: 4 };

      const result = handleBufferOverflow('newest', buffer, newItem, bufferSize);

      expect(result.action).toBe('drop_newest');
      expect(result.dropped).toEqual(newItem);
      expect(buffer.length).toBe(3); // Buffer unchanged
    });

    it('should return error action when policy is error', () => {
      const buffer = [{ id: 1 }, { id: 2 }, { id: 3 }];
      const bufferSize = 3;
      const newItem = { id: 4 };

      const result = handleBufferOverflow('error', buffer, newItem, bufferSize);

      expect(result.action).toBe('error');
    });
  });

  describe('removeLeaderLease', () => {
    it('should remove leader lease from localStorage', () => {
      const key = 'test-lease-key';
      localStorage.setItem(
        key,
        JSON.stringify({ tabId: 'tab-1', timestamp: Date.now(), leaseMs: 5000 })
      );

      removeLeaderLease(key);

      expect(localStorage.getItem(key)).toBeNull();
    });

    it('should handle errors when removing lease', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const key = 'test-lease-key';

      // Create a mock that throws error
      const originalRemoveItem = Object.getPrototypeOf(localStorage).removeItem;
      Object.getPrototypeOf(localStorage).removeItem = function (this: Storage, _key: string) {
        throw new Error('Storage quota exceeded');
      };

      expect(() => removeLeaderLease(key)).not.toThrow();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error removing leader lease:',
        expect.any(Error)
      );

      Object.getPrototypeOf(localStorage).removeItem = originalRemoveItem;
      consoleErrorSpy.mockRestore();
    });
  });
});
