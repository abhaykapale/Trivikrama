import assert from "node:assert/strict";
import test from "node:test";

import { ListQuarantinedFilesUseCase } from "../../../src/modules/collector-monitoring/application/list-quarantined-files.use-case.js";
import type {
  IQuarantineFileCatalog,
  ListQuarantinedFileRecordsInput,
} from "../../../src/modules/collector-monitoring/domain/collector-monitoring.contracts.js";

const RECORDS = [
  {
    fileName:
      "batch_77d8092b-6bd8-4acd-ab16-bd56707a1377__collector_Y29sbGVjdG9yLWRldi0wMQ__claim_f694a7a4-91da-4aa2-9bfd-86e3b6ca1a1d__empty_file__d132b4ba-760b-4ecc-8b33-f11b4d15eeca.json",
    collectorId: "collector-dev-01",
    batchId: "77d8092b-6bd8-4acd-ab16-bd56707a1377",
    reason: "EMPTY_FILE",
    quarantinedAt: new Date("2026-09-12T10:00:00.000Z"),
    fileSizeBytes: 0,
    eventCount: 0,
  },
] as const;

test("maps quarantine records to the documented paginated API contract", async () => {
  const catalog = new FakeCatalog();
  const useCase = new ListQuarantinedFilesUseCase(catalog);

  const result = await useCase.execute({ page: 2, limit: 1 });

  assert.deepEqual(catalog.inputs, [{ offset: 1, limit: 1 }]);
  assert.deepEqual(result, {
    data: [
      {
        filePath: `quarantine/${RECORDS[0].fileName}`,
        originalPath:
          "incoming/collector-dev-01/batch_77d8092b-6bd8-4acd-ab16-bd56707a1377.json",
        error: "EMPTY_FILE",
        quarantinedAt: "2026-09-12T10:00:00.000Z",
        fileSizeBytes: 0,
        eventCount: 0,
      },
    ],
    pagination: { page: 2, limit: 1, total: 3, totalPages: 3 },
  });
});

test("returns zero total pages for an empty quarantine", async () => {
  const useCase = new ListQuarantinedFilesUseCase({
    async list() {
      return { items: [], total: 0 };
    },
  });

  const result = await useCase.execute({ page: 1, limit: 25 });

  assert.deepEqual(result.pagination, {
    page: 1,
    limit: 25,
    total: 0,
    totalPages: 0,
  });
});

test("rejects invalid or excessive pagination before accessing storage", async () => {
  const catalog = new FakeCatalog();
  const useCase = new ListQuarantinedFilesUseCase(catalog);

  await assert.rejects(useCase.execute({ page: 0, limit: 25 }), /page/u);
  await assert.rejects(useCase.execute({ page: 1, limit: 101 }), /limit/u);
  assert.equal(catalog.inputs.length, 0);
});

class FakeCatalog implements IQuarantineFileCatalog {
  public readonly inputs: ListQuarantinedFileRecordsInput[] = [];

  public async list(input: ListQuarantinedFileRecordsInput) {
    this.inputs.push(input);
    return { items: RECORDS, total: 3 };
  }
}
