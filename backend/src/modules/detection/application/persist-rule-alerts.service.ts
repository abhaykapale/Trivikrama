import { isDeepStrictEqual } from "node:util";

import type {
  AlertRecord,
  CreateAlertInput,
  CreateAlertsIfAbsentResult,
  IAlertRepository,
} from "../../../database/repositories/alerts/alert.repository.js";
import type { RuleAlert } from "../domain/rule-engine.contracts.js";

export interface PersistRuleAlertsDependencies {
  readonly alerts: Pick<IAlertRepository, "createManyIfAbsent">;
}

export interface PersistRuleAlertsResult {
  readonly insertedCount: number;
  readonly alreadyPresentCount: number;
  readonly records: readonly AlertRecord[];
}

export class PersistRuleAlertsService {
  public constructor(private readonly dependencies: PersistRuleAlertsDependencies) {}

  public async execute(
    organizationId: string,
    alerts: readonly RuleAlert[],
  ): Promise<PersistRuleAlertsResult> {
    const orgId = requireNonBlank(organizationId, "organizationId");
    const inputs = alerts.map((alert) => toCreateInput(orgId, alert));
    const result = await this.dependencies.alerts.createManyIfAbsent(inputs);
    verifyPersistedAlerts(inputs, result);

    return {
      insertedCount: result.insertedCount,
      alreadyPresentCount: result.existingCount,
      records: result.records,
    };
  }
}

function toCreateInput(orgId: string, alert: RuleAlert): CreateAlertInput {
  requireUuid(alert.alertId, "alert.alertId");
  requireUuid(alert.ruleId, "alert.ruleId");
  if (alert.matchedEvents.length === 0) {
    throw new Error("Rule alert must reference at least one matched event.");
  }

  return {
    id: alert.alertId,
    incidentId: null,
    alertType: "rule",
    ruleId: alert.ruleId,
    ruleName: alert.ruleName,
    matchedCondition: alert.matchedCondition,
    severity: alert.severity,
    weight: alert.weight,
    tags: [...alert.tags],
    metadata: { ...alert.metadata },
    matchedEventIds: [...alert.matchedEvents],
    orgId,
  };
}

function verifyPersistedAlerts(
  inputs: readonly CreateAlertInput[],
  result: CreateAlertsIfAbsentResult,
): void {
  if (
    result.insertedCount + result.existingCount !== inputs.length ||
    result.records.length !== inputs.length
  ) {
    throw new Error("Idempotent alert persistence returned inconsistent counts.");
  }

  const expectedById = new Map(inputs.map((input) => [input.id, input]));
  for (const record of result.records) {
    const expected = expectedById.get(record.id);
    if (expected === undefined || !sameAlert(record, expected)) {
      throw new Error(`Alert identity collision detected for ${record.id}.`);
    }
  }
}

function sameAlert(record: AlertRecord, expected: CreateAlertInput): boolean {
  return (
    // incidentId is deliberately not compared. The later correlator owns that
    // mutable link and may already have attached this alert before a job retry.
    record.alertType === "rule" &&
    record.ruleId === expected.ruleId &&
    record.ruleName === expected.ruleName &&
    record.matchedCondition === expected.matchedCondition &&
    record.anomalyScore === null &&
    record.confidence === null &&
    record.threatCategory === null &&
    record.modelVersion === null &&
    record.shapValues === null &&
    record.severity === expected.severity &&
    record.weight === expected.weight &&
    record.orgId === expected.orgId &&
    isDeepStrictEqual(record.tags, expected.tags) &&
    isDeepStrictEqual(record.metadata, expected.metadata) &&
    isDeepStrictEqual(record.matchedEventIds, expected.matchedEventIds)
  );
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function requireUuid(value: string, fieldName: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`${fieldName} must be a UUID.`);
  }
  return value;
}

function requireNonBlank(value: string, fieldName: string): string {
  if (value.trim().length === 0) {
    throw new Error(`${fieldName} must not be blank.`);
  }
  return value.trim();
}
