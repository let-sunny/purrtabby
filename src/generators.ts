import type { TabBusMessage, InternalBusState, LeaderEvent, InternalLeaderState, MessageQueue, EventQueue } from './types.js';
import { waitForItems } from './utils.js';

/**
 * Async generator for TabBus messages
 * @param state - Internal bus state
 * @param queue - Message queue
 * @param signal - Optional AbortSignal for cancellation
 * @yields TabBus messages
 */
export async function* busMessagesGenerator<T = any>(
  state: InternalBusState<T>,
  queue: MessageQueue,
  signal?: AbortSignal
): AsyncGenerator<TabBusMessage<T>> {
  state.activeIterators++;

  try {
    while (true) {
      if (signal?.aborted) break;

      while (queue.messages.length > 0) {
        if (signal?.aborted) break;
        yield queue.messages.shift()!;
      }

      await waitForItems(
        signal,
        () => queue.messages.length > 0,
        state.messageResolvers,
        (resolve) => state.messageResolvers.add(resolve),
        (resolve) => state.messageResolvers.delete(resolve)
      );
    }
  } finally {
    state.activeIterators--;
    if (state.activeIterators === 0) {
      queue.messages = [];
    }
  }
}

/**
 * Async generator for Leader events
 * @param state - Internal leader state
 * @param queue - Event queue
 * @param signal - Optional AbortSignal for cancellation
 * @yields Leader events
 */
export async function* leaderEventsGenerator(
  state: InternalLeaderState,
  queue: EventQueue,
  signal?: AbortSignal
): AsyncGenerator<LeaderEvent> {
  state.activeIterators++;

  try {
    while (true) {
      if (signal?.aborted) break;

      while (queue.events.length > 0) {
        if (signal?.aborted) break;
        yield queue.events.shift()!;
      }

      await waitForItems(
        signal,
        () => queue.events.length > 0,
        state.eventResolvers,
        (resolve) => state.eventResolvers.add(resolve),
        (resolve) => state.eventResolvers.delete(resolve)
      );
    }
  } finally {
    state.activeIterators--;
    if (state.activeIterators === 0) {
      queue.events = [];
    }
  }
}
