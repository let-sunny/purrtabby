import { describe, it, expect } from 'vitest';
import { generateTabId, createTabBusEvent, createLeaderEvent, addJitter } from '../src/utils.js';

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
});
