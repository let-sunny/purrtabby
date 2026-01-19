/**
 * Test helpers for purrtabby
 */

// Mock BroadcastChannel for testing
class MockBroadcastChannel {
  name: string;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  private static channels = new Map<string, Set<MockBroadcastChannel>>();

  constructor(name: string) {
    this.name = name;
    if (!MockBroadcastChannel.channels.has(name)) {
      MockBroadcastChannel.channels.set(name, new Set());
    }
    MockBroadcastChannel.channels.get(name)!.add(this);
  }

  postMessage(message: unknown): void {
    const channelSet = MockBroadcastChannel.channels.get(this.name);
    if (!channelSet) return;

    // Synchronously call onmessage for other channels (simulates BroadcastChannel behavior)
    // Use a small delay via Promise.resolve() to ensure subscription handlers are set up
    const channelsToNotify = Array.from(channelSet).filter((ch) => ch !== this && ch.onmessage);
    if (channelsToNotify.length > 0) {
      Promise.resolve().then(() => {
        channelsToNotify.forEach((channel) => {
          if (channel.onmessage) {
            channel.onmessage({ data: message } as MessageEvent);
          }
        });
      });
    }
  }

  close(): void {
    const channelSet = MockBroadcastChannel.channels.get(this.name);
    if (channelSet) {
      channelSet.delete(this);
    }
  }

  static cleanup(): void {
    MockBroadcastChannel.channels.clear();
  }
}

export function setupBroadcastChannelMock(): void {
  if (typeof globalThis.BroadcastChannel === 'undefined') {
    (
      globalThis as typeof globalThis & { BroadcastChannel: typeof MockBroadcastChannel }
    ).BroadcastChannel = MockBroadcastChannel;
  }
}

export function cleanupBroadcastChannelMock(): void {
  MockBroadcastChannel.cleanup();
}
