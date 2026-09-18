export interface AcquireAlertCooldownInput {
  readonly organizationId: string;
  readonly ruleId: string;
  readonly ruleStateVersion: string;
  readonly entityKey: string;
  /** Deterministic identity of the logical alert attempting the lease. */
  readonly alertId: string;
  readonly cooldownSeconds: number;
}

/**
 * Atomically acquires an alert lease. A retry by the same deterministic alert
 * owner is allowed; a different alert is suppressed while the lease is live.
 */
export interface IAlertCooldownStore {
  tryAcquire(input: AcquireAlertCooldownInput): Promise<boolean>;
}
