export * from "./rotation/adaptive";
export * from "./rotation/health";
export * from "./rotation/hybrid";
export * from "./rotation/token-bucket";
export * from "./rotation/types";

import { resetAdaptiveTracker as _resetAdaptiveTracker } from "./rotation/adaptive";
import { resetHealthTracker as _resetHealthTracker } from "./rotation/health";
import { resetTokenTracker as _resetTokenTracker } from "./rotation/token-bucket";

export function resetTrackers(): void {
  _resetHealthTracker();
  _resetTokenTracker();
  _resetAdaptiveTracker();
}
