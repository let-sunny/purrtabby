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
11. [Appendix: Detailed Leader Election Algorithm](#appendix-detailed-leader-election-algorithm)

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

By default, `BroadcastChannel` does not deliver messages to the sending tab. To support the leader-follower pattern where all tabs use the same code, we explicitly call `handleBusMessage()` for self-messages using `queueMicrotask()` to defer execution to the next microtask.

---

## Leader Election Architecture

### Core Components

1. **localStorage**: Stores leader lease with tabId, timestamp, and lease duration
2. **Heartbeat Timer**: Interval timer to periodically update lease
3. **Check Timer**: Interval timer to poll for leadership changes
4. **Event Queue**: Array to buffer events for stream generators
5. **Callbacks**: Map-based callback storage for type-specific and all-event subscriptions

### Leader Lease Structure

**What is a Lease?**

A **lease** is a time-limited "contract" that grants a tab the right to be the leader. Think of it like renting an apartment:
- The lease has an expiration time
- The leader must renew the lease periodically (via heartbeat) to maintain leadership
- If the lease expires, any tab can acquire leadership
- This ensures that if a leader tab crashes or closes, another tab can take over automatically

```typescript
interface LeaderLease {
  tabId: string;      // ID of the leader tab
  timestamp: number;   // When the lease was created/updated
  leaseMs: number;     // Lease duration in milliseconds
}
```

The lease is stored in `localStorage` and contains:
- **tabId**: Which tab is currently the leader
- **timestamp**: When the lease was last updated (used to calculate expiration)
- **leaseMs**: How long the lease is valid (default: 5000ms = 5 seconds)

A lease is considered **expired** when: `timestamp + leaseMs < Date.now()`

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

---

## Appendix: Detailed Leader Election Algorithm

This section provides a step-by-step explanation of how leader election works in purrtabby.

### Overview

Leader election uses a **lease-based mechanism** stored in `localStorage`. The lease contains:
- `tabId`: Identifier of the current leader tab
- `timestamp`: When the lease was last updated
- `leaseMs`: Duration the lease is valid (default: 5000ms)

### Step-by-Step: Acquiring Leadership

When `leader.start()` is called, the following process occurs:

#### Step 1: Initial Acquisition Attempt

```typescript
tryAcquireLeadership(state, eventQueue)
```

1. **Read current lease** from localStorage:
   ```typescript
   const currentLease = readLeaderLease(state.key);
   ```

2. **Check if lease is valid**:
   ```typescript
   isValidLeaderLease(currentLease)
   // Returns false if:
   // - lease is null/undefined
   // - lease.timestamp + lease.leaseMs < Date.now() (expired)
   ```

3. **If lease is invalid (no leader or expired)**:
   - Create new lease with current tab's ID:
     ```typescript
     const newLease = {
       tabId: state.tabId,
       timestamp: Date.now(),
       leaseMs: state.leaseMs,
     };
     writeLeaderLease(state.key, newLease);
     ```
   - **Double-check**: Read back the lease to verify we got it
     - This handles race conditions when multiple tabs try simultaneously
     - Only one tab will successfully write (last write wins)
   - If `acquiredLease.tabId === state.tabId`:
     - Set `state.isLeader = true`
     - Emit `'acquire'` event
     - Return `true`

4. **If lease is valid and belongs to this tab**:
   - Set `state.isLeader = true` (if not already)
   - Emit `'acquire'` event (if wasn't leader before)
   - Return `true`

5. **If lease is valid but belongs to another tab**:
   - If we were leader before, emit `'lose'` event
   - Set `state.isLeader = false`
   - Return `false`

### Step-by-Step: Maintaining Leadership (Heartbeat)

Once a tab becomes leader, it must periodically renew its lease:

#### Heartbeat Timer

```typescript
setInterval(() => {
  sendLeaderHeartbeat(state, eventQueue);
}, heartbeatMs + jitter);
```

**Heartbeat Process** (`sendLeaderHeartbeat`):

1. **Check preconditions**:
   ```typescript
   if (state.stopped || !state.isLeader) return;
   ```

2. **Read current lease**:
   ```typescript
   const currentLease = readLeaderLease(state.key);
   ```

3. **If lease still belongs to this tab**:
   - Update timestamp:
     ```typescript
     const updatedLease = {
       ...currentLease,
       timestamp: Date.now(),
     };
     writeLeaderLease(state.key, updatedLease);
     ```
   - Lease is renewed for another `leaseMs` duration

4. **If lease belongs to another tab**:
   - Set `state.isLeader = false`
   - Emit `'lose'` event
   - This can happen if:
     - Another tab acquired leadership
     - Tab was inactive and lease expired

### Step-by-Step: Detecting Leadership Changes (Polling)

Non-leader tabs periodically check for leadership opportunities:

#### Check Timer

```typescript
setInterval(() => {
  checkLeaderLeadership(state, eventQueue);
}, heartbeatMs / 2 + jitter);
```

**Check Process** (`checkLeaderLeadership`):

1. **Read current lease**:
   ```typescript
   const currentLease = readLeaderLease(state.key);
   ```

2. **Determine current state**:
   ```typescript
   const wasLeader = state.isLeader;
   const isNowLeader = currentLease?.tabId === state.tabId 
                     && isValidLeaderLease(currentLease);
   ```

3. **Handle state transitions**:
   - **Became leader** (`!wasLeader && isNowLeader`):
     - Set `state.isLeader = true`
     - Emit `'acquire'` event
   
   - **Lost leadership** (`wasLeader && !isNowLeader`):
     - Set `state.isLeader = false`
     - Emit `'lose'` event with `newLeader` metadata
   
   - **Leadership changed** (`wasLeader && isNowLeader && currentLease.tabId !== state.tabId`):
     - This case is logically impossible (if `isNowLeader`, then `currentLease.tabId === state.tabId`)
     - Emit `'change'` event (edge case handling)

### Race Condition Handling

**Problem**: Multiple tabs might try to acquire leadership simultaneously.

**Solution**: Double-check pattern:
1. Write lease to localStorage
2. Immediately read it back
3. Only consider leadership acquired if read value matches our tabId

This ensures only one tab succeeds even in race conditions.

### Lease Expiration

A lease expires when:
```typescript
lease.timestamp + lease.leaseMs < Date.now()
```

**Expired lease handling**:
- Any tab can acquire leadership when lease expires
- Leader must renew before expiration (via heartbeat)
- If leader tab crashes/closes, lease expires and another tab can take over

### Example Timeline

```
Time 0ms:   Tab A starts, acquires leadership (lease expires at 5000ms)
Time 2000ms: Tab A sends heartbeat (lease expires at 7000ms)
Time 3000ms: Tab B starts, sees valid lease (Tab A is leader)
Time 4000ms: Tab A sends heartbeat (lease expires at 9000ms)
Time 5000ms: Tab A closes/crashes
Time 6000ms: Tab B checks, sees expired lease, acquires leadership
Time 8000ms: Tab B sends heartbeat (lease expires at 13000ms)
```

### Key Design Decisions

1. **Why localStorage?**
   - Synchronous API (no async overhead)
   - Shared across all tabs in same origin
   - Persists across page reloads (with expiration)

2. **Why double-check?**
   - Handles race conditions when multiple tabs compete
   - Ensures only one tab succeeds

3. **Why heartbeat?**
   - Proves leader is still alive
   - Prevents stale leadership if leader tab crashes

4. **Why polling?**
   - Detects leadership changes
   - Allows non-leaders to acquire when lease expires
   - Storage events help but polling ensures reliability
