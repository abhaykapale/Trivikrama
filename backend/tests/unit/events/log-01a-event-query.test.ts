import assert from "node:assert/strict";
import test from "node:test";

import { ExportEventsUseCase } from "../../../src/modules/events/application/export-events.use-case.js";
import { GetEventDetailUseCase } from "../../../src/modules/events/application/get-event-detail.use-case.js";
import { SearchEventsUseCase } from "../../../src/modules/events/application/search-events.use-case.js";
import {
  InvalidEventTimeRangeError,
  type EventDetailView,
  type EventInvestigationView,
  type EventRepositoryPage,
  type EventRepositorySearchQuery,
  type IEventInvestigationRepository,
} from "../../../src/modules/events/domain/event-query.contracts.js";

const NOW = new Date("2026-10-22T06:00:00.000Z");

test("search applies a deterministic 24-hour window and API pagination", async () => {
  const repository = new FakeEventRepository();
  repository.searchResults.push({ items: [eventView("event-1")], total: 51 });
  const useCase = new SearchEventsUseCase(repository, { now: () => NOW });

  const result = await useCase.execute({
    orgId: "org-alpha",
    query: "failed password",
    severityId: 4,
    page: 2,
    limit: 25,
    sort: "severityId",
    order: "desc",
  });

  assert.deepEqual(repository.searchInputs[0], {
    orgId: "org-alpha",
    query: "failed password",
    severityId: 4,
    from: new Date("2026-10-21T06:00:00.000Z"),
    to: NOW,
    offset: 25,
    limit: 25,
    sort: "severityId",
    order: "desc",
  });
  assert.deepEqual(result.pagination, {
    page: 2,
    limit: 25,
    total: 51,
    totalPages: 3,
    hasNext: true,
    hasPrev: true,
  });
  assert.deepEqual(result.window, {
    from: new Date("2026-10-21T06:00:00.000Z"),
    to: NOW,
  });
});

test("an explicit historical to date receives its own preceding 24-hour default", async () => {
  const repository = new FakeEventRepository();
  const useCase = new SearchEventsUseCase(repository, { now: () => NOW });
  const to = new Date("2025-01-02T12:00:00.000Z");

  await useCase.execute({
    orgId: "org-alpha",
    to,
    page: 1,
    limit: 50,
    sort: "time",
    order: "desc",
  });

  assert.equal(
    repository.searchInputs[0]?.from.toISOString(),
    "2025-01-01T12:00:00.000Z",
  );
});

test("search rejects an inverted time window before repository access", async () => {
  const repository = new FakeEventRepository();
  const useCase = new SearchEventsUseCase(repository, { now: () => NOW });

  await assert.rejects(
    useCase.execute({
      orgId: "org-alpha",
      from: new Date("2026-10-22T07:00:00.000Z"),
      to: NOW,
      page: 1,
      limit: 50,
      sort: "time",
      order: "desc",
    }),
    InvalidEventTimeRangeError,
  );
  assert.equal(repository.searchInputs.length, 0);
});

test("detail lookup remains tenant scoped and returns AI/SHAP evidence", async () => {
  const repository = new FakeEventRepository();
  repository.detailResult = {
    ...eventView("event-1"),
    aiAnalysis: {
      modelName: "isolation_forest",
      modelVersion: "1.0.0",
      anomalyScore: 0.94,
      isAnomaly: true,
      usedFallback: false,
      createdAt: NOW,
      shapExplanation: {
        baseValue: 0.2,
        features: [{ name: "failed_login_count_10min", value: 38, shapValue: 0.4 }],
      },
    },
  };
  const useCase = new GetEventDetailUseCase(repository);

  const result = await useCase.execute({
    orgId: "org-alpha",
    eventId: "event-1",
  });

  assert.deepEqual(repository.detailInputs, [
    { orgId: "org-alpha", eventId: "event-1" },
  ]);
  assert.equal(result?.aiAnalysis?.shapExplanation?.features.length, 1);
});

test("CSV export pages safely, caps output, and neutralizes spreadsheet formulas", async () => {
  const repository = new FakeEventRepository();
  repository.searchResults.push(
    { items: [eventView("event-1", "=HYPERLINK(\"bad\")")], total: 3 },
    { items: [eventView("event-2", "+cmd"), eventView("event-3")], total: 3 },
  );
  const useCase = new ExportEventsUseCase(repository, { now: () => NOW });

  const result = await useCase.execute({
    orgId: "org-alpha",
    format: "csv",
    maxResults: 3,
    sort: "time",
    order: "desc",
  });

  assert.equal(repository.searchInputs.length, 2);
  assert.equal(repository.searchInputs[1]?.offset, 1);
  assert.equal(result.exportedCount, 3);
  assert.equal(result.truncated, false);
  assert.match(result.body, /"'=HYPERLINK\(""bad""\)"/u);
  assert.match(result.body, /"'\+cmd"/u);
  assert.doesNotMatch(result.body, /org-alpha|raw_event/u);
});

test("JSON export reports when the bounded result is truncated", async () => {
  const repository = new FakeEventRepository();
  repository.searchResults.push({ items: [eventView("event-1")], total: 20 });
  const useCase = new ExportEventsUseCase(repository, { now: () => NOW });

  const result = await useCase.execute({
    orgId: "org-alpha",
    format: "json",
    maxResults: 1,
    sort: "time",
    order: "desc",
  });
  const body = JSON.parse(result.body) as {
    data: Array<{ eventId: string; time: string }>;
    export: { count: number; totalMatched: number; truncated: boolean };
  };

  assert.equal(result.contentType, "application/json; charset=utf-8");
  assert.equal(result.truncated, true);
  assert.deepEqual(body.export, {
    count: 1,
    totalMatched: 20,
    truncated: true,
  });
  assert.equal(body.data[0]?.time, "2026-10-22T05:50:00.000Z");
});

class FakeEventRepository implements IEventInvestigationRepository {
  public readonly searchInputs: EventRepositorySearchQuery[] = [];
  public readonly detailInputs: Array<{ orgId: string; eventId: string }> = [];
  public readonly searchResults: EventRepositoryPage[] = [];
  public detailResult: EventDetailView | null = null;

  public async search(
    input: EventRepositorySearchQuery,
  ): Promise<EventRepositoryPage> {
    this.searchInputs.push(input);
    return this.searchResults.shift() ?? { items: [], total: 0 };
  }

  public async findById(input: {
    orgId: string;
    eventId: string;
  }): Promise<EventDetailView | null> {
    this.detailInputs.push(input);
    return this.detailResult;
  }
}

function eventView(
  eventId: string,
  message = "Failed password for root",
): EventInvestigationView {
  return {
    eventId,
    classUid: 3002,
    categoryUid: 3,
    severityId: 4,
    time: new Date("2026-10-22T05:50:00.000Z"),
    message,
    srcEndpoint: { ip: "192.0.2.10", port: 54321 },
    dstEndpoint: { ip: "10.0.0.5", port: 22 },
    actor: { user: { name: "root" } },
    device: { hostname: "web-01" },
    metadata: { version: "1.1.0" },
    ingestion: {
      batchId: "batch-1",
      collectorId: "collector-1",
      ingestedAt: new Date("2026-10-22T05:50:01.000Z"),
    },
  };
}
