# purrtabby Architecture Documentation

## Table of Contents

1. [Overview](#overview)
2. [Core Design Principles](#core-design-principles)
3. [Module Structure](#module-structure)
4. [TabBus Architecture](#tabbus-architecture)
5. [Leader Election Architecture](#leader-election-architecture)
6. [Generator-Based Streams](#generator-based-streams)
7. [Data Flow](#data-flow)
8. [Design Decisions](#design-decisions)
9. [Performance Considerations](#performance-considerations)
10. [Conclusion](#conclusion)

---

## Overview

purrtabby is a lightweight library for cross-tab communication and leader election in browser environments. It uses BroadcastChannel for inter-tab messaging and localStorage for leader election with lease-based heartbeat mechanism.

### Key Features

- **Lightweight**: Less than 7KB (~3KB when gzipped)
- **Cross-tab Communication**: BroadcastChannel-based pub-sub messaging
- **Leader Election**: localStorage-based lease with heartbeat mechanism
- **Async Iterable**: Generator-based message and event streams
- **Type Safety**: Full TypeScript support
- **Zero Dependencies**: Uses only native Browser APIs (BroadcastChannel, localStorage)

---

## Core Design Principles

### 1. Functional Programming Approach

We adopted a functional programming style with pure functions to improve testability and maintainability.

**Why Functional?**

- **Pure Functions**: Core logic is implemented as pure functions that take state as parameters
  - `handleBusMessage()`: Processes incoming messages
  - `handleBusMessageEvent()`: Handles BroadcastChannel events with error handling
  - `tryAcquireLeadership()`: Attempts to acquire leadership
  - `sendLeaderHeartbeat()`: Sends heartbeat to maintain leadership
  - `checkLeaderLeadership()`: Checks current leadership status
- **Testability**: Pure functions are easy to test in isolation
- **No Hidden State**: All dependencies are explicit parameters
- **Composability**: Functions can be easily composed and reused

### 2. Event-Driven Architecture

All state changes are tracked as events to ensure transparency and ease of debugging.

### 3. Generator-Based Streams

Messages and events are processed as streams using async iterables, allowing for clean async/await patterns.

---

## Module Structure

```
src/
├── index.ts          # Public API entry point
├── bus.ts            # TabBus implementation
├── leader.ts         # LeaderElector implementation
├── generators.ts      # Async iterable generators
├── utils.ts          # Utility functions (ID generation, event creation, localStorage helpers)
└── types.ts          # TypeScript type definitions
```

### Module Responsibilities

#### `index.ts`
- Exports public API: `createBus()`, `createLeaderElector()`
- Re-exports types for TypeScript users

#### `bus.ts`
- `createBus()`: Factory function to create TabBus instance
- `handleBusMessage()`: Pure function to process incoming messages
- `handleBusMessageEvent()`: Pure function to handle BroadcastChannel events
- TabBus implementation with publish/subscribe/stream APIs

#### `leader.ts`
- `createLeaderElector()`: Factory function to create LeaderElector instance
- `tryAcquireLeadership()`: Pure function to attempt leadership acquisition
- `sendLeaderHeartbeat()`: Pure function to send heartbeat
- `checkLeaderLeadership()`: Pure function to check leadership status
- `emitLeaderEvent()`: Pure function to emit leader events
- LeaderElector implementation with start/stop/stream APIs

#### `generators.ts`
- `busMessagesGenerator()`: Async generator for TabBus messages
- `leaderEventsGenerator()`: Async generator for Leader events

#### `utils.ts`
- `generateTabId()`: Generate unique tab identifier
- `createTabBusEvent()`: Create TabBus event object
- `createLeaderEvent()`: Create Leader event object
- `addJitter()`: Add jitter to values
- `waitForItems()`: Wait for items using event-based notification
- `readLeaderLease()`, `writeLeaderLease()`, `removeLeaderLease()`: localStorage helpers
- `isValidLeaderLease()`: Validate leader lease

#### `types.ts`
- TypeScript interfaces and types for all public and internal APIs

---

## TabBus Architecture

### Core Components

1. **BroadcastChannel**: Native browser API for cross-tab communication
2. **Message Queue**: Array to buffer messages for stream generators
3. **Callbacks**: Map-based callback storage for type-specific and all-message subscriptions
4. **Resolvers**: Set of promise resolvers to notify waiting generators

### Message Flow

```
Publish Message
    ↓
BroadcastChannel.postMessage()
    ↓
Other tabs receive via BroadcastChannel.onmessage
    ↓
handleBusMessageEvent() (with error handling)
    ↓
handleBusMessage() (pure function)
    ↓
├─→ Type-specific callbacks
├─→ All-message callbacks
└─→ Message queue (for stream generators)
    ↓
    Notify waiting generators via resolvers
```

### Key Functions

#### `handleBusMessage()`
Pure function that processes a message:
- Notifies type-specific callbacks
- Notifies all-message callbacks
- Adds message to queue for stream generators
- Resolves waiting generators

#### `handleBusMessageEvent()`
Pure function that handles BroadcastChannel message events:
- Parses message from event
- Calls `handleBusMessage()` with error handling
- Emits error events on parsing failure

### Self-Message Handling

By default, `BroadcastChannel` does not deliver messages to the sending tab. To support the leader-follower pattern where all tabs use the same code, we explicitly call `handleBusMessage()` for self-messages using `setTimeout(0)`.

---

## Leader Election Architecture

### Core Components

1. **localStorage**: Stores leader lease with tabId, timestamp, and lease duration
2. **Heartbeat Timer**: Interval timer to periodically update lease
3. **Check Timer**: Interval timer to poll for leadership changes
4. **Event Queue**: Array to buffer events for stream generators
5. **Callbacks**: Map-based callback storage for type-specific and all-event subscriptions

### Leader Lease Structure

```typescript
interface LeaderLease {
  tabId: string;      // ID of the leader tab
  timestamp: number;   // When the lease was created/updated
  leaseMs: number;     // Lease duration in milliseconds
}
```

### Election Flow

```
Start Election
    ↓
tryAcquireLeadership()
    ↓
Check if lease exists and is valid
    ↓
If no lease or expired:
    ├─→ Write new lease to localStorage
    ├─→ Set isLeader = true
    └─→ Emit 'acquire' event
    ↓
Start heartbeat timer
    ↓
Periodically send heartbeat (sendLeaderHeartbeat)
    ↓
Update lease timestamp in localStorage
```

### Heartbeat Mechanism

The leader periodically updates its lease timestamp to maintain leadership:

```typescript
// Every heartbeatMs milliseconds
sendLeaderHeartbeat() {
  if (isLeader && lease is still valid) {
    writeLeaderLease() // Update timestamp
  } else {
    // Lost leadership
    emitLeaderEvent('lose')
  }
}
```

### Leadership Check

Non-leader tabs periodically check for leadership changes:

```typescript
// Every checkInterval milliseconds
checkLeaderLeadership() {
  const currentLease = readLeaderLease()
  
  if (currentLease is valid && currentLease.tabId === this.tabId) {
    // We are the leader
    if (!wasLeader) {
      emitLeaderEvent('acquire')
    }
  } else if (wasLeader) {
    // We lost leadership
    emitLeaderEvent('lose')
  } else if (currentLease?.tabId !== this.tabId) {
    // Leadership changed to another tab
    emitLeaderEvent('change')
  }
}
```

### Key Functions

#### `tryAcquireLeadership()`
Pure function that attempts to acquire leadership:
- Reads current lease from localStorage
- If no lease or expired, writes new lease
- Returns true if leadership was acquired

#### `sendLeaderHeartbeat()`
Pure function that sends heartbeat:
- Checks if still leader
- Updates lease timestamp if valid
- Emits 'lose' event if leadership lost

#### `checkLeaderLeadership()`
Pure function that checks leadership status:
- Reads current lease
- Compares with own tabId
- Emits appropriate events ('acquire', 'lose', 'change')

---

## Generator-Based Streams

### Message Stream Generator

```typescript
async function* busMessagesGenerator(state, queue, signal?) {
  state.activeIterators++;
  try {
    while (true) {
      // Yield buffered messages
      while (queue.messages.length > 0) {
        yield queue.messages.shift()!;
      }
      
      // Wait for new messages
      await waitForItems(signal, ...);
    }
  } finally {
    state.activeIterators--;
    // Clear queue when last iterator exits
    if (state.activeIterators === 0) {
      queue.messages = [];
    }
  }
}
```

### Event Stream Generator

Similar structure for leader events, but uses event queue instead of message queue.

### Wait Mechanism

`waitForItems()` uses an event-based notification system:
- Adds resolver to a Set when waiting
- Resolves when items arrive (via `forEach(resolve)`)
- Cleans up resolver on abort or when items arrive
- Supports AbortSignal for cancellation

### Multiple Iterators

Multiple iterators can consume from the same stream:
- Each iterator increments `activeIterators`
- Messages/events are consumed by the first iterator that reads them
- Queue is cleared only when the last iterator exits

---

## Data Flow

### TabBus Message Flow

```
Tab A: bus.publish('type', payload)
    ↓
BroadcastChannel.postMessage({ type, payload, tabId, ts })
    ↓
Tab B: BroadcastChannel.onmessage
    ↓
handleBusMessageEvent(event)
    ↓
handleBusMessage(message)
    ↓
├─→ bus.subscribe('type', callback) → callback(message)
├─→ bus.subscribeAll(callback) → callback(message)
└─→ bus.stream() → yield message
```

### Leader Election Flow

```
Tab A: leader.start()
    ↓
tryAcquireLeadership()
    ↓
Write lease to localStorage
    ↓
Emit 'acquire' event
    ↓
Start heartbeat timer
    ↓
Periodically: sendLeaderHeartbeat()
    ↓
Update lease timestamp
    ↓
Tab B: checkLeaderLeadership()
    ↓
Read lease from localStorage
    ↓
Emit 'change' event (if different leader)
```

---

## Design Decisions

### 1. Why Functional Over Class-Based?

- **Testability**: Pure functions are easier to test in isolation
- **Simplicity**: No need to manage `this` context
- **Composability**: Functions can be easily composed
- **Lightweight**: Less overhead than classes

### 2. Why Pure Functions?

- **Explicit Dependencies**: All dependencies are passed as parameters
- **No Hidden State**: State is explicitly managed
- **Easier Testing**: Can test functions with mock state
- **Better Coverage**: Can test error paths and edge cases directly

### 3. Why Self-Messages?

- **Consistency**: All tabs use the same code
- **Leader-Follower Pattern**: Leader can process its own messages
- **Simpler Logic**: No need to check `if (!leader.isLeader())` everywhere

### 4. Why localStorage for Leader Election?

- **Persistence**: Survives page refreshes
- **Cross-Tab Visibility**: All tabs can read/write
- **Simple**: No need for complex coordination protocols
- **Reliable**: Works even if BroadcastChannel is unavailable

### 5. Why Lease-Based Heartbeat?

- **Fault Tolerance**: Leader failure is detected when lease expires
- **Automatic Recovery**: New leader can be elected when lease expires
- **No Central Authority**: No need for a separate coordinator

### 6. Why Generator-Based Streams?

- **Modern API**: Uses async/await patterns
- **Cancellable**: Supports AbortSignal
- **Memory Efficient**: Messages are consumed and removed from queue
- **Multiple Consumers**: Multiple iterators can consume from same stream

---

## Performance Considerations

### Memory Management

- **Message Queue**: Cleared when last iterator exits
- **Event Queue**: Cleared when last iterator exits
- **Callbacks**: Removed when unsubscribed
- **Resolvers**: Cleared after resolving

### BroadcastChannel Performance

- **Message Size**: Keep messages small (< 64KB recommended)
- **Message Frequency**: High-frequency messages may cause performance issues
- **Tab Count**: Performance degrades with many tabs

### localStorage Performance

- **Read Frequency**: Polling interval should be reasonable (default: 2s)
- **Write Frequency**: Heartbeat interval should be reasonable (default: 2s)
- **Storage Size**: localStorage has size limits (~5-10MB)

### Generator Performance

- **Multiple Iterators**: Each iterator consumes messages independently
- **Queue Clearing**: Queue is cleared only when last iterator exits
- **AbortSignal**: Proper cleanup prevents memory leaks

---

## Conclusion

purrtabby is designed with simplicity and lightweight in mind. The functional programming approach with pure functions makes the code easy to test and maintain. The generator-based streams provide a modern API for consuming messages and events, while the lease-based leader election ensures reliable coordination across tabs.

Key strengths:
- **Lightweight**: Minimal bundle size
- **Testable**: Pure functions enable comprehensive testing
- **Modern**: Uses async iterables and TypeScript
- **Reliable**: Lease-based heartbeat ensures fault tolerance
- **Simple**: Clear separation of concerns and explicit dependencies
