import assert from "node:assert/strict";
import test from "node:test";

import { RetryQuarantinedFileUseCase } from "../../../src/modules/collector-monitoring/application/retry-quarantined-file.use-case.js";
import type { IQuarantineFileRequeuer } from "../../../src/modules/collector-monitoring/domain/collector-monitoring.contracts.js";

const FILENAME =
  "batch_77d8092b-6bd8-4acd-ab16-bd56707a1377__collector_Y29sbGVjdG9yLWRldi0wMQ__claim_f694a7a4-91da-4aa2-9bfd-86e3b6ca1a1d__empty_file__d132b4ba-760b-4ecc-8b33-f11b4d15eeca.json";

test("requeues the exact quarantine filename and returns the API contract", async () => {
  const requeuer = new FakeRequeuer();
  const useCase = new RetryQuarantinedFileUseCase(requeuer);

  const result = await useCase.execute({ filename: FILENAME });

  assert.deepEqual(requeuer.filenames, [FILENAME]);
  assert.deepEqual(result, {
    filename: FILENAME,
    status: "requeued",
    message: "File moved from quarantine back to processing queue",
  });
});

test("rejects a blank filename before touching the filesystem", async () => {
  const requeuer = new FakeRequeuer();
  const useCase = new RetryQuarantinedFileUseCase(requeuer);

  await assert.rejects(useCase.execute({ filename: "   " }), /filename/u);
  assert.equal(requeuer.filenames.length, 0);
});

class FakeRequeuer implements IQuarantineFileRequeuer {
  public readonly filenames: string[] = [];

  public async requeue(filename: string) {
    this.filenames.push(filename);
    return {
      filename,
      incomingRelativePath:
        "incoming/collector-dev-01/batch_77d8092b-6bd8-4acd-ab16-bd56707a1377.json",
    };
  }
}
