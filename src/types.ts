/** TabBus message structure */
export interface TabBusMessage<T = any> {
  type: string;
  payload?: T;
  tabId: string;
  ts: number;
}

/** TabBus event types */
export type TabBusEventType = 'msg' | 'err';

/** TabBus event structure */
export interface TabBusEvent {
  type: TabBusEventType;
  ts: number;
  meta?: Record<string, any>;
}

/** Options for createBus() */
export interface BusOptions {
  channel: string;
  tabId?: string;
}

/** Return type of createBus(), provides async iterables and callbacks */
export interface TabBus<T = any> {
  /** Publish a message to all tabs */
  publish(type: string, payload?: T): void;
  /** Subscribe to messages of a specific type */
  subscribe(type: string, handler: (message: TabBusMessage<T>) => void): () => void;
  /** Subscribe to all messages */
  subscribeAll(handler: (message: TabBusMessage<T>) => void): () => void;
  /** Get async iterable stream of messages */
  stream(options?: { signal?: AbortSignal }): AsyncIterable<TabBusMessage<T>>;
  /** Get the current tab ID */
  getTabId(): string;
  /** Close the bus and cleanup */
  close(): void;
}

/** Leader election event types */
export type LeaderEventType = 'acquire' | 'lose' | 'change';

/** Leader election event structure */
export interface LeaderEvent {
  type: LeaderEventType;
  ts: number;
  meta?: Record<string, any>;
}

/** Options for createLeaderElector() */
export interface LeaderElectorOptions {
  key: string;
  tabId: string;
  leaseMs?: number;
  heartbeatMs?: number;
  jitterMs?: number;
}

/** Return type of createLeaderElector() */
export interface LeaderElector {
  /** Start leader election */
  start(): void;
  /** Stop leader election and release leadership if held */
  stop(): void;
  /** Check if this tab is the leader */
  isLeader(): boolean;
  /** Subscribe to leader events */
  on(event: LeaderEventType, handler: (event: LeaderEvent) => void): () => void;
  /** Subscribe to all leader events */
  onAll(handler: (event: LeaderEvent) => void): () => void;
  /** Get async iterable stream of leader events */
  stream(options?: { signal?: AbortSignal }): AsyncIterable<LeaderEvent>;
  /** Get the current tab ID */
  getTabId(): string;
}

/** Internal state for TabBus */
export interface InternalBusState<T = any> {
  channel: BroadcastChannel | null;
  tabId: string;
  messageCallbacks: Map<string, Set<(message: TabBusMessage<T>) => void>>;
  allCallbacks: Set<(message: TabBusMessage<T>) => void>;
  messageResolvers: Set<() => void>;
  activeIterators: number;
}

/** Internal state for LeaderElector */
export interface InternalLeaderState {
  key: string;
  tabId: string;
  leaseMs: number;
  heartbeatMs: number;
  jitterMs: number;
  isLeader: boolean;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  checkTimer: ReturnType<typeof setInterval> | null;
  eventCallbacks: Map<LeaderEventType, Set<(event: LeaderEvent) => void>>;
  allCallbacks: Set<(event: LeaderEvent) => void>;
  eventResolvers: Set<() => void>;
  activeIterators: number;
  stopped: boolean;
}

/** RPC request message */
export interface RPCRequest<T = any> {
  type: 'rpc-request';
  method: string;
  params?: T;
  requestId: string;
  tabId: string;
  ts: number;
}

/** RPC response message */
export interface RPCResponse<T = any> {
  type: 'rpc-response';
  requestId: string;
  result?: T;
  error?: string;
  tabId: string;
  ts: number;
}

/** Options for createRPC() */
export interface RPCOptions {
  bus: TabBus;
  timeout?: number; // Default: 5000ms
}

/** Return type of createRPC() */
export interface RPC {
  /** Call a method on the leader (or any tab) */
  call<TParams = any, TResult = any>(method: string, params?: TParams, options?: { timeout?: number }): Promise<TResult>;
  /** Handle incoming RPC requests */
  handle<TParams = any, TResult = any>(method: string, handler: (params?: TParams) => Promise<TResult> | TResult): () => void;
  /** Close the RPC instance and cleanup */
  close(): void;
}

/** Internal state for RPC */
export interface InternalRPCState {
  bus: TabBus;
  timeout: number;
  pendingRequests: Map<string, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>;
  handlers: Map<string, (params?: any) => Promise<any> | any>;
}
