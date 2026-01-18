import type { TabBus, RPC, RPCOptions, RPCRequest, RPCResponse, InternalRPCState } from './types.js';
import { generateRequestId } from './utils.js';

/**
 * Handle incoming RPC request (pure function, testable)
 * @param request - RPC request message
 * @param state - Internal RPC state
 * @param tabId - Current tab ID
 */
export function handleRPCRequest(
  request: RPCRequest,
  state: InternalRPCState,
  tabId: string
): void {
  // Don't handle requests from self (RPC should call other tabs)
  if (request.tabId === tabId) {
    return;
  }

  const handler = state.handlers.get(request.method);
  
  if (!handler) {
    // No handler found, send error response
    const response: RPCResponse = {
      type: 'rpc-response',
      requestId: request.requestId,
      error: `No handler found for method: ${request.method}`,
      tabId,
      ts: Date.now(),
    };
    try {
      state.bus.publish('rpc-response', response);
    } catch (e) {
      // Bus might be closed, ignore
    }
    return;
  }

  // Execute handler
  Promise.resolve(handler(request.params))
    .then((result) => {
      const response: RPCResponse = {
        type: 'rpc-response',
        requestId: request.requestId,
        result,
        tabId,
        ts: Date.now(),
      };
      // Publish response - it will be delivered to all tabs including the requester
      try {
        state.bus.publish('rpc-response', response);
      } catch (e) {
        // Bus might be closed, ignore
      }
    })
    .catch((error) => {
      const response: RPCResponse = {
        type: 'rpc-response',
        requestId: request.requestId,
        error: error instanceof Error ? error.message : String(error),
        tabId,
        ts: Date.now(),
      };
      // Publish error response - it will be delivered to all tabs including the requester
      try {
        state.bus.publish('rpc-response', response);
      } catch (e) {
        // Bus might be closed, ignore
      }
    });
}

/**
 * Handle incoming RPC response (pure function, testable)
 * @param response - RPC response message
 * @param state - Internal RPC state
 * @param tabId - Current tab ID
 */
export function handleRPCResponse(
  response: RPCResponse,
  state: InternalRPCState,
  tabId: string
): void {
  // Only handle responses to our own requests
  // (responses from other tabs to their requests should be ignored)
  const pending = state.pendingRequests.get(response.requestId);
  
  if (!pending) {
    // Request not found (might have timed out, already resolved, or from another tab)
    return;
  }

  // Clear timeout
  clearTimeout(pending.timeout);
  state.pendingRequests.delete(response.requestId);

  // Resolve or reject the promise
  if (response.error) {
    pending.reject(new Error(response.error));
  } else {
    pending.resolve(response.result);
  }
}

/**
 * Create an RPC instance for request-response communication
 * @param options - RPC configuration options
 * @returns RPC instance
 */
export function createRPC(options: RPCOptions): RPC {
  const { bus, timeout = 5000 } = options;
  const tabId = bus.getTabId();

  const state: InternalRPCState = {
    bus,
    timeout,
    pendingRequests: new Map(),
    handlers: new Map(),
  };

  // Subscribe to RPC requests
  const unsubscribeRequest = bus.subscribe('rpc-request', (message) => {
    const request = message.payload as RPCRequest;
    if (request && request.type === 'rpc-request') {
      handleRPCRequest(request, state, tabId);
    }
  });

  // Subscribe to RPC responses
  const unsubscribeResponse = bus.subscribe('rpc-response', (message) => {
    const response = message.payload as RPCResponse;
    if (response && response.type === 'rpc-response') {
      handleRPCResponse(response, state, tabId);
    }
  });

  const rpc: RPC = {
    call<TParams = any, TResult = any>(
      method: string,
      params?: TParams,
      options?: { timeout?: number }
    ): Promise<TResult> {
      const requestId = generateRequestId();
      const requestTimeout = options?.timeout ?? state.timeout;

      return new Promise<TResult>((resolve, reject) => {
        // Set timeout
        const timeoutId = setTimeout(() => {
          state.pendingRequests.delete(requestId);
          reject(new Error(`RPC call timeout: ${method} (${requestTimeout}ms)`));
        }, requestTimeout);

        // Store pending request
        state.pendingRequests.set(requestId, {
          resolve,
          reject,
          timeout: timeoutId,
        });

        // Send request
        const request: RPCRequest = {
          type: 'rpc-request',
          method,
          params,
          requestId,
          tabId,
          ts: Date.now(),
        };
        bus.publish('rpc-request', request);
      });
    },

    handle<TParams = any, TResult = any>(
      method: string,
      handler: (params?: TParams) => Promise<TResult> | TResult
    ): () => void {
      state.handlers.set(method, handler);

      return () => {
        state.handlers.delete(method);
      };
    },

    close(): void {
      // Reject all pending requests
      state.pendingRequests.forEach((pending) => {
        clearTimeout(pending.timeout);
        pending.reject(new Error('RPC closed'));
      });
      state.pendingRequests.clear();
      state.handlers.clear();
      unsubscribeRequest();
      unsubscribeResponse();
    },
  };

  return rpc;
}
