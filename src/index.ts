export { createBus } from './bus.js';
export { createLeaderElector } from './leader.js';
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
} from './types.js';

import { createBus } from './bus.js';
import { createLeaderElector } from './leader.js';

// Default exports for convenience
export default {
  createBus,
  createLeaderElector,
};

// Type helpers for users
export type { createBus as CreateBus };
export type { createLeaderElector as CreateLeaderElector };
