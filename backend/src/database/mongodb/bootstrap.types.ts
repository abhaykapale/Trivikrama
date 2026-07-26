export type MongoBootstrapCommand = "apply" | "status";

export interface MongoIndexDefinition {
  readonly name: string;
  readonly keys: Readonly<Record<string, 1 | -1 | "text">>;
  readonly unique?: boolean;
  readonly sparse?: boolean;
  readonly expireAfterSeconds?: number;
}

export interface MongoCollectionDefinition {
  readonly name: string;
  readonly validator: Readonly<Record<string, unknown>>;
  readonly indexes: readonly MongoIndexDefinition[];
}

export interface MongoBootstrapCollectionStatus {
  readonly name: string;
  readonly exists: boolean;
  readonly validatorConfigured: boolean;
  readonly expectedIndexes: number;
  readonly presentIndexes: readonly string[];
  readonly missingIndexes: readonly string[];
  readonly mismatchedIndexes: readonly string[];
}

export interface MongoBootstrapResult {
  readonly command: MongoBootstrapCommand;
  readonly success: boolean;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly databaseName: string;
  readonly collectionsCreated: number;
  readonly validatorsApplied: number;
  readonly indexesCreated: number;
  readonly collections: readonly MongoBootstrapCollectionStatus[];
}
