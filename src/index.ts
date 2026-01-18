export { createBus } from './bus.js';
export { createLeaderElector } from './leader.js';
export { createRPC } from './rpc.js';
export type {
  TabBus,
  BusOptions,
  TabBusMessage,
  TabBusEvent,
  TabBusEventType,
  LeaderElector,
  LeaderElectorOptions,
  LeaderEvent,
  LeaderEventType,
  RPC,
  RPCOptions,
  RPCRequest,
  RPCResponse,
} from './types.js';

import { createBus } from './bus.js';
import { createLeaderElector } from './leader.js';
import { createRPC } from './rpc.js';

// Default exports for convenience
export default {
  createBus,
  createLeaderElector,
  createRPC,
};

// Type helpers for users
export type { createBus as CreateBus };
export type { createLeaderElector as CreateLeaderElector };
export type { createRPC as CreateRPC };