import assert from "node:assert/strict";
import test from "node:test";

import type { CreateNormalizedEventInput } from "../../../src/database/repositories/mongodb/normalized-event.repository.js";
import {
    AI_FEATURE_NAMES,
    DeterministicFeatureExtractor,
    RedisBackedProcessFeatureExtractor,
    RedisProcessFeatureStore,
    processPathDepth,
    selectAiFeatureVector,
    type IProcessFeatureStore,
    type ProcessFeatureSnapshot,
    type RecordProcessFeatureInput,
} from "../../../src/modules/feature-extraction/index.js";

test("applies process history in event-time order and preserves input order", async () => {
    const history = new RecordingProcessStore();
    const later = processEvent("event-later", "2026-09-19T10:00:30.000Z");
    const earlier = processEvent("event-earlier", "2026-09-19T10:00:00.000Z");

    const result = await createExtractor(history).extract([later, earlier]);

    assert.deepEqual(history.inputs.map((input) => input.eventId), [
        "event-earlier",
        "event-later",
    ]);
    assert.deepEqual(result.events.map((event) => event.event_id), [
        "event-later",
        "event-earlier",
    ]);
    assert.equal(result.events[0]?.features.process_rarity_score, 0.75);
    assert.equal(result.events[0]?.features.parent_child_anomaly, 1);
    assert.equal(result.events[0]?.features.process_path_depth, 3);
    assert.equal(result.events[0]?.features.command_line_length, 30);
    assert.equal(result.processHistoryAppliedEvents, 2);
    assert.equal(result.processHistoryFallbackEvents, 0);
});

test("adds deterministic context but keeps neutral history when Redis fails", async () => {
    const result = await createExtractor({
        async record() {
            throw new Error("Redis unavailable");
        },
    }).extract([processEvent("event-1", "2026-09-19T10:00:00.000Z")]);

    assert.equal(result.events[0]?.features.process_rarity_score, 0);
    assert.equal(result.events[0]?.features.parent_child_anomaly, 0);
    assert.equal(result.events[0]?.features.process_path_depth, 3);
    assert.equal(result.events[0]?.features.command_line_length, 30);
    assert.equal(result.processHistoryFallbackEvents, 1);
});

test("ignores non-process events and process events without endpoint identity", async () => {
    const history = new RecordingProcessStore();
    const authentication = { ...processEvent("auth", "2026-09-19T10:00:00.000Z"), class_uid: 3002 };
    const missingEndpoint = {
        ...processEvent("missing-device", "2026-09-19T10:00:01.000Z"),
        device: undefined,
    };

    const result = await createExtractor(history).extract([authentication, missingEndpoint]);

    assert.equal(history.inputs.length, 0);
    assert.equal(result.events[0]?.features.process_path_depth, undefined);
    assert.equal(result.events[1]?.features.process_path_depth, 3);
    assert.equal(result.events[1]?.features.process_rarity_score, 0);
});

test("reports replay snapshots and keeps the v1 AI payload at exactly 20 fields", async () => {
    const result = await createExtractor({
        async record() {
            return snapshot({ replay: true });
        },
    }).extract([processEvent("replay", "2026-09-19T10:00:00.000Z")]);

    const aiVector = selectAiFeatureVector(result.events[0]!.features);
    assert.equal(result.processHistoryReplayHits, 1);
    assert.deepEqual(Object.keys(aiVector), [...AI_FEATURE_NAMES]);
    assert.equal(Object.keys(aiVector).length, 20);
    assert.equal("process_rarity_score" in aiVector, false);
});

test("calculates portable process path depth", () => {
    assert.equal(processPathDepth("C:\\a\\b\\c.exe"), 3);
    assert.equal(processPathDepth("/usr/local/bin/bash"), 4);
    assert.equal(processPathDepth("powershell.exe"), 1);
    assert.equal(processPathDepth(undefined), 0);
});

test("hashes process identities in Redis keys", async () => {
    const redis = new FakeRedisEval();
    const store = new RedisProcessFeatureStore(redis, { keyPrefix: "features:process:test" });

    await store.record(processInput());

    const joined = redis.calls[0]?.join("|") ?? "";
    for (const secret of ["secret-org", "sensitive-event", "host-01", "powershell.exe", "explorer.exe"]) {
        assert.equal(joined.includes(secret), false);
    }
    assert.equal(redis.numberOfKeys[0], 4);
});

test("rejects malformed Redis process snapshots and invalid configuration", async () => {
    const malformed = new RedisProcessFeatureStore(new FakeRedisEval([0, "[1.5,1]"]));
    await assert.rejects(malformed.record(processInput()), /non-finite process-feature values/);
    assert.throws(
        () => new RedisProcessFeatureStore(new FakeRedisEval(), { snapshotTtlMs: 100 }),
        /1 to 30 days/,
    );
});

class RecordingProcessStore implements IProcessFeatureStore {
    public readonly inputs: RecordProcessFeatureInput[] = [];

    public async record(input: RecordProcessFeatureInput): Promise<ProcessFeatureSnapshot> {
        this.inputs.push(input);
        return snapshot();
    }
}

class FakeRedisEval {
    public readonly calls: Array<readonly (string | number)[]> = [];
    public readonly numberOfKeys: number[] = [];

    public constructor(private readonly response: unknown = [0, "[0.75,1]"]) {}

    public async eval(
        _script: string,
        numberOfKeys: number,
        ...arguments_: readonly (string | number)[]
    ): Promise<unknown> {
        this.numberOfKeys.push(numberOfKeys);
        this.calls.push(arguments_);
        return this.response;
    }
}

function createExtractor(history: IProcessFeatureStore): RedisBackedProcessFeatureExtractor {
    return new RedisBackedProcessFeatureExtractor({
        delegate: new DeterministicFeatureExtractor(),
        processHistory: history,
    });
}

function snapshot(overrides: Partial<ProcessFeatureSnapshot> = {}): ProcessFeatureSnapshot {
    return {
        replay: false,
        processRarityScore: 0.75,
        parentChildAnomaly: 1,
        ...overrides,
    };
}

function processInput(): RecordProcessFeatureInput {
    return {
        organizationId: "secret-org",
        eventId: "sensitive-event",
        occurredAtEpochMs: Date.parse("2026-09-19T10:00:00.000Z"),
        endpointIdentity: "host-01",
        processName: "powershell.exe",
        parentProcessName: "explorer.exe",
    };
}

function processEvent(eventId: string, timestamp: string): CreateNormalizedEventInput {
    return {
        event_id: eventId,
        class_uid: 1007,
        category_uid: 1,
        severity_id: 2,
        time: new Date(timestamp),
        message: "Process launched",
        actor: { process: { name: "explorer.exe" } },
        process: {
            name: "powershell.exe",
            path: "C:\\tools\\admin\\powershell.exe",
            cmd_line: "powershell.exe -EncodedCommand",
        },
        device: { hostname: "host-01" },
        metadata: { version: "1.1.0" },
        ingestion: {
            batch_id: "batch-be-feat-01e",
            collector_id: "collector-dev-01",
            ingested_at: new Date(timestamp),
        },
        org_id: "org-001",
    };
}
