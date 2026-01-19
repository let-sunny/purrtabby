# Using with WebSocket

purrtabby can be used with WebSocket to share a single connection across multiple tabs. Instead of creating a WebSocket connection for each tab, only the leader tab manages the WebSocket connection, while other tabs communicate via tab-to-tab messaging.

## Why Use This Pattern?

When multiple tabs are open, creating a WebSocket connection for each tab leads to:

- Increased server load
- Unnecessary network resource usage
- Receiving the same messages multiple times

With purrtabby:

- Only the leader tab maintains the WebSocket connection
- Other tabs communicate through the leader
- Reduced server load and efficient resource usage

## Basic Pattern

### 1. Leader Manages WebSocket

```typescript
import createSocket from 'purrcat'; // or any other WebSocket library
import { createBus, createLeaderElector } from 'purrtabby';

const bus = createBus({ channel: 'my-app-ws' });
const leader = createLeaderElector({ key: 'ws-leader' });

let socket: ReturnType<typeof createSocket> | null = null;

leader.start();

// Create WebSocket connection when becoming leader
leader.on('acquire', () => {
  console.log('Became leader. Starting WebSocket connection.');

  socket = createSocket({
    url: 'wss://api.example.com/ws',
  });

  // Forward messages from WebSocket to all tabs
  socket.onMessage((message) => {
    bus.publish('server-message', message);
  });

  // Cleanup on WebSocket close
  socket.onClose(() => {
    console.log('WebSocket connection closed.');
    socket = null;
  });
});

// Close WebSocket connection when losing leadership
leader.on('lose', () => {
  console.log('Lost leadership. Closing WebSocket connection.');
  if (socket) {
    socket.close();
    socket = null;
  }
});
```

### 2. Receive Server Messages in All Tabs

```typescript
// Handle server messages in all tabs (including leader)
bus.subscribe('server-message', (message) => {
  const data = message.payload;
  console.log('Received message from server:', data);

  // Common logic like UI updates
  updateUI(data);
});
```

### 3. Send Messages to Server from All Tabs

```typescript
// Any tab can send messages to server
function sendToServer(data: any) {
  // Leader receives this message and forwards it via WebSocket
  bus.publish('to-server', data);
}

// Leader receives to-server messages and forwards via WebSocket
bus.subscribe('to-server', (message) => {
  if (leader.isLeader() && socket) {
    // Only leader actually sends to WebSocket
    socket.send(message.payload);
  }
});
```

## Complete Example

```typescript
import createSocket from 'purrcat';
import { createBus, createLeaderElector } from 'purrtabby';

// ========== Initialization ==========
const bus = createBus({ channel: 'chat-app' });
const leader = createLeaderElector({
  key: 'chat-leader',
  tabId: `tab-${Date.now()}`,
});

let socket: ReturnType<typeof createSocket> | null = null;

// ========== Leader Management ==========
leader.start();

leader.on('acquire', () => {
  console.log('✅ Became leader. Starting WebSocket connection');

  socket = createSocket({
    url: 'wss://chat.example.com/ws',
  });

  // Forward WebSocket messages to all tabs
  socket.onMessage((message) => {
    bus.publish('server-message', message);
  });

  socket.onOpen(() => {
    console.log('WebSocket connected');
    bus.publish('server-message', {
      type: 'system',
      message: 'WebSocket connected',
    });
  });

  socket.onClose(() => {
    console.log('WebSocket connection closed');
    socket = null;
  });

  socket.onError((error) => {
    console.error('WebSocket error:', error);
    bus.publish('server-message', {
      type: 'error',
      message: 'WebSocket connection error',
    });
  });
});

leader.on('lose', () => {
  console.log('❌ Lost leadership. Closing WebSocket connection');
  if (socket) {
    socket.close();
    socket = null;
  }
});

// ========== Receive Server Messages (All Tabs) ==========
function handleServerMessage(message: any) {
  console.log('📨 Server message:', message);

  switch (message.type) {
    case 'chat':
      displayChatMessage(message);
      break;
    case 'notification':
      showNotification(message);
      break;
    case 'error':
      showError(message);
      break;
  }
}

// Leader also receives this message for consistency
bus.subscribe('server-message', (msg) => {
  handleServerMessage(msg.payload);
});

// ========== Send Messages to Server (All Tabs) ==========
function sendToServer(data: any) {
  // All tabs send in the same way
  bus.publish('to-server', data);
}

// Leader receives to-server messages and forwards via WebSocket
bus.subscribe('to-server', (message) => {
  if (leader.isLeader() && socket) {
    socket.send(message.payload);
  }
});

// ========== Usage Example ==========
// User sends chat message
document.getElementById('send-btn')?.addEventListener('click', () => {
  const input = document.getElementById('message-input') as HTMLInputElement;
  const text = input.value;

  if (text) {
    sendToServer({
      type: 'chat',
      text: text,
      timestamp: Date.now(),
    });
    input.value = '';
  }
});

// ========== Cleanup ==========
window.addEventListener('beforeunload', () => {
  leader.stop();
  bus.close();
  if (socket) {
    socket.close();
  }
});
```

## Implementing Request-Response Pattern

You can implement a request-response pattern using only TabBus without RPC. For example, only the leader executes database queries and returns results to other tabs.

```typescript
import createSocket from 'purrcat';
import { createBus, createLeaderElector } from 'purrtabby';

const bus = createBus({ channel: 'app' });
const leader = createLeaderElector({ key: 'app-leader' });

let socket: ReturnType<typeof createSocket> | null = null;
const pendingRequests = new Map<
  string,
  {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }
>();

leader.start();

// When becoming leader, connect WebSocket and register query handler
leader.on('acquire', () => {
  socket = createSocket({ url: 'wss://api.example.com/ws' });

  socket.onMessage((message) => {
    bus.publish('server-message', message);
  });

  // Handle query requests
  bus.subscribe('query-request', (msg) => {
    const { requestId, query } = msg.payload || {};
    if (!socket || !requestId) return;

    // Request via WebSocket
    socket.send({
      type: 'query',
      requestId,
      query,
    });
  });
});

// Handle server responses (all tabs)
bus.subscribe('server-message', (msg) => {
  const { requestId, result, error } = msg.payload || {};
  if (!requestId) return;

  const pending = pendingRequests.get(requestId);
  if (!pending) return;

  pendingRequests.delete(requestId);
  clearTimeout(pending.timeout);

  if (error) {
    pending.reject(new Error(error));
  } else {
    pending.resolve(result);
  }
});

// Follower tabs request server queries
function queryServer(query: string, timeout = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const requestId = `req-${Date.now()}-${Math.random()}`;

    const timeoutId = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error('Query timeout'));
    }, timeout);

    pendingRequests.set(requestId, { resolve, reject, timeout: timeoutId });

    bus.publish('query-request', { requestId, query });
  });
}

// Usage example
try {
  const result = await queryServer('SELECT * FROM users');
  console.log('Query result:', result);
} catch (error) {
  console.error('Query failed:', error);
}
```

## Important Notes

1. **Leader Changes**: When the leader changes, the new leader must recreate the WebSocket connection.

2. **Connection State Management**: You need to implement reconnection logic when the WebSocket connection is lost (purrcat supports automatic reconnection).

3. **Message Ordering**: Messages sent simultaneously from multiple tabs may not be guaranteed in order. Add ordering logic if needed.

4. **Error Handling**: Properly handle situations like WebSocket connection failures and leader changes.

5. **Cleanup**: Clean up resources when closing the page (`leader.stop()`, `bus.close()`, `socket.close()`).

## Real-World Use Cases

### Chat Application

- Only leader tab maintains WebSocket connection
- All tabs can receive and send chat messages
- When one tab closes, another tab becomes leader and maintains connection

### Real-time Dashboard

- Only leader tab connects to server via WebSocket
- All tabs receive real-time data
- Minimizes server load

### Collaboration Tool

- Leader tab synchronizes with server
- Other tabs communicate with server through leader
- Efficient even with multiple users working simultaneously
