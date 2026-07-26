import type { MongoDbClient } from "../../mongodb/client.js";

import type { IAiResultRepository } from "./ai-result.repository.js";
import { MongoAiResultRepository } from "./mongo-ai-result.repository.js";
import { MongoNormalizedEventRepository } from "./mongo-normalized-event.repository.js";
import { MongoRawEventArchiveRepository } from "./mongo-raw-event-archive.repository.js";
import type { INormalizedEventRepository } from "./normalized-event.repository.js";
import type { IRawEventArchiveRepository } from "./raw-event-archive.repository.js";

export interface MongoDocumentRepositories {
  readonly normalizedEvents: INormalizedEventRepository;
  readonly aiResults: IAiResultRepository;
  readonly rawEventArchive: IRawEventArchiveRepository;
}

export type MongoRepositories = MongoDocumentRepositories;

export const MONGO_REPOSITORY_NAMES = [
  "normalizedEvents",
  "aiResults",
  "rawEventArchive",
] as const;

export type MongoRepositoryName = (typeof MONGO_REPOSITORY_NAMES)[number];

export function createMongoRepositories(
  client: MongoDbClient,
): MongoRepositories {
  return {
    normalizedEvents: new MongoNormalizedEventRepository(client),
    aiResults: new MongoAiResultRepository(client),
    rawEventArchive: new MongoRawEventArchiveRepository(client),
  };
}

export function assertMongoRepositoryCoverage(
  repositories: Partial<Record<MongoRepositoryName, unknown>>,
): asserts repositories is MongoRepositories {
  const missing = MONGO_REPOSITORY_NAMES.filter(
    (name) => repositories[name] === undefined,
  );

  if (missing.length > 0) {
    throw new Error(
      `Mongo repository factory is missing repositories: ${missing.join(", ")}`,
    );
  }
}
