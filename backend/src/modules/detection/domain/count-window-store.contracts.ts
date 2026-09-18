export interface RecordCountWindowMatchInput {
  readonly organizationId: string;
  readonly ruleId: string;
  readonly ruleStateVersion: string;
  readonly entityKey: string;
  readonly eventId: string;
  readonly occurredAtEpochMs: number;
  readonly windowSeconds: number;
}

export interface CountWindowSnapshot {
  readonly inserted: boolean;
  readonly count: number;
  readonly eventIds: readonly string[];
}

/** Atomic rolling-window state used by count-rule evaluation. */
export interface ICountWindowStore {
  recordMatch(
    input: RecordCountWindowMatchInput,
  ): Promise<CountWindowSnapshot>;
}
