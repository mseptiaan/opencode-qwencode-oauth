export * from "./rotation/adaptive";
export * from "./rotation/health";
export * from "./rotation/hybrid";
export * from "./rotation/token-bucket";
export * from "./rotation/types";

import { resetAdaptiveTracker as _resetAdaptiveTracker } from "./rotation/adaptive";
import {
  getHealthTracker as _getHealthTracker,
  initHealthTracker as _initHealthTracker,
  resetHealthTracker as _resetHealthTracker,
} from "./rotation/health";
import {
  getTokenTracker as _getTokenTracker,
  initTokenTracker as _initTokenTracker,
  resetTokenTracker as _resetTokenTracker,
} from "./rotation/token-bucket";

export function resetTrackers(): void {
  _resetHealthTracker();
  _resetTokenTracker();
  _resetAdaptiveTracker();
}
