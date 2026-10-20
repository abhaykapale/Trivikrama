import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import type {
  DeduplicateUnifiedAlertsResult,
  UnifiedAlert,
} from "../domain/unified-alert.contracts.js";

export class UnifiedAlertDeduplicator {
  public deduplicate(
    alerts: readonly UnifiedAlert[],
  ): DeduplicateUnifiedAlertsResult {
    const unique = new Map<string, UnifiedAlert>();
    let duplicatesRemoved = 0;

    for (const alert of alerts) {
      const key = createUnifiedAlertDedupKey(alert);
      const existing = unique.get(key);
      if (existing === undefined) {
        unique.set(key, alert);
        continue;
      }

      if (!sameLogicalAlert(existing, alert)) {
        throw new Error(`Unified alert identity collision detected for ${alert.id}.`);
      }
      duplicatesRemoved += 1;
    }

    return Object.freeze({
      alerts: Object.freeze([...unique.values()]),
      inputCount: alerts.length,
      duplicatesRemoved,
    });
  }
}

function sameLogicalAlert(left: UnifiedAlert, right: UnifiedAlert): boolean {
  const { id: _leftId, timestamp: _leftTimestamp, ...leftContent } = left;
  const { id: _rightId, timestamp: _rightTimestamp, ...rightContent } = right;
  return isDeepStrictEqual(leftContent, rightContent);
}

export function createUnifiedAlertDedupKey(alert: UnifiedAlert): string {
  const hash = createHash("sha256");
  const identity =
    alert.type === "rule"
      ? [alert.type, alert.ruleId]
      : [alert.type, alert.modelName, alert.modelVersion];

  for (const part of [...identity, ...[...alert.matchedEventIds].sort()]) {
    const bytes = Buffer.from(part, "utf8");
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(bytes.length);
    hash.update(length);
    hash.update(bytes);
  }

  return hash.digest("hex");
}
