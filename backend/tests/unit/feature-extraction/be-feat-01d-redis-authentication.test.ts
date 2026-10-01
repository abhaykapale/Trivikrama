import assert from "node:assert/strict";
import test from "node:test";

import type { CreateNormalizedEventInput } from "../../../src/database/repositories/mongodb/normalized-event.repository.js";
import {
    DeterministicFeatureExtractor,
    RedisAuthenticationFeatureStore,
    RedisBackedAuthenticationFeatureExtractor,
    type AuthenticationFeatureSnapshot,
    type IAuthenticationFeatureStore,
    type RecordAuthenticationFeatureInput,
} from "../../../src/modules/feature-extraction/index.js";

test("applies authentication history in event-time order and preserves input order", async () => {
    const history = new RecordingAuthenticationStore();
    const extractor = createExtractor(history);
    const laterFailure = authenticationEvent(
        "event-later",
        "2026-09-19T10:00:30.000Z",
        2,
    );
    const earlierSuccess = authenticationEvent(
        "event-earlier",
        "2026-09-19T10:00:00.000Z",
        1,
    );

    const result = await extractor.extract([laterFailure, earlierSuccess]);

    assert.deepEqual(history.inputs.map((input) => input.eventId), [
        "event-earlier",
        "event-later",
    ]);
    assert.deepEqual(history.inputs.map((input) => input.outcome), [
        "success",
        "failure",
    ]);
    assert.deepEqual(result.events.map((event) => event.event_id), [
        "event-later",
        "event-earlier",
    ]);
    assert.equal(result.events[0]?.features.failed_login_count_10min, 2);
    assert.equal(result.events[0]?.features.failed_to_success_ratio, 2 / 3);
    assert.equal(result.events[0]?.features.new_source_ip, 1);
    assert.equal(result.authenticationHistoryAppliedEvents, 2);
    assert.equal(result.authenticationHistoryFallbackEvents, 0);
});

test("leaves non-authentication and unknown-outcome events neutral", async () => {
    const history = new RecordingAuthenticationStore();
    const nonAuthentication = {
        ...authenticationEvent("network-event", "2026-09-19T10:00:00.000Z", 2),
        class_uid: 4001,
    };
    const unknownOutcome = authenticationEvent(
        "unknown-outcome",
        "2026-09-19T10:00:01.000Z",
        undefined,
    );

    const result = await createExtractor(history).extract([
        nonAuthentication,
        unknownOutcome,
    ]);

    assert.equal(history.inputs.length, 0);
    assert.equal(result.events[0]?.features.failed_login_count_10min, 0);
    assert.equal(result.events[1]?.features.new_source_ip, 0);
});

test("keeps neutral authentication values when Redis fails", async () => {
    const result = await createExtractor({
        async record() {
            throw new Error("Redis unavailable");
        },
    }).extract([
        authenticationEvent("event-1", "2026-09-19T10:00:00.000Z", 2),
    ]);

    assert.equal(result.events[0]?.features.failed_login_count_10min, 0);
    assert.equal(result.events[0]?.features.failed_to_success_ratio, 0);
    assert.equal(result.events[0]?.features.new_source_ip, 0);
    assert.equal(result.authenticationHistoryFallbackEvents, 1);
});

test("reports exact authentication replay snapshots", async () => {
    const result = await createExtractor({
        async record() {
            return snapshot({ replay: true });
        },
    }).extract([
        authenticationEvent("event-replay", "2026-09-19T10:00:00.000Z", 1),
    ]);

    assert.equal(result.authenticationHistoryReplayHits, 1);
    assert.equal(result.events[0]?.features.failed_login_count_10min, 2);
});

test("hashes tenant, user, source and event identities in Redis keys", async () => {
    const redis = new FakeRedisEval();
    const store = new RedisAuthenticationFeatureStore(redis, {
        keyPrefix: "features:auth:test",
    });

    await store.record({
        organizationId: "secret-organization",
        eventId: "sensitive-event-id",
        occurredAtEpochMs: Date.parse("2026-09-19T10:00:00.000Z"),
        username: "alice",
        sourceIp: "192.0.2.10",
        outcome: "failure",
    });

    const joined = redis.calls[0]?.join("|") ?? "";
    assert.equal(joined.includes("secret-organization"), false);
    assert.equal(joined.includes("sensitive-event-id"), false);
    assert.equal(joined.includes("alice"), false);
    assert.equal(joined.includes("192.0.2.10"), false);
    assert.equal(redis.numberOfKeys[0], 4);
});

test("rejects malformed Redis snapshots and invalid authentication inputs", async () => {
    const malformed = new RedisAuthenticationFeatureStore(
        new FakeRedisEval([0, "[2,1.5,1]"]),
    );

    await assert.rejects(
        malformed.record({
            organizationId: "org-1",
            eventId: "event-1",
            occurredAtEpochMs: 1,
            username: "alice",
            outcome: "failure",
        }),
        /non-finite authentication-feature values/,
    );
    assert.throws(
        () =>
            new RedisAuthenticationFeatureStore(new FakeRedisEval(), {
                snapshotTtlMs: 100,
            }),
        /1 to 30 days/,
    );
});

class RecordingAuthenticationStore implements IAuthenticationFeatureStore {
    public readonly inputs: RecordAuthenticationFeatureInput[] = [];

    public async record(
        input: RecordAuthenticationFeatureInput,
    ): Promise<AuthenticationFeatureSnapshot> {
        this.inputs.push(input);
        return snapshot();
    }
}

class FakeRedisEval {
    public readonly calls: Array<readonly (string | number)[]> = [];
    public readonly numberOfKeys: number[] = [];

    public constructor(
        private readonly response: unknown = [0, "[2,0.6666666666666666,1]"],
    ) {}

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

function createExtractor(
    history: IAuthenticationFeatureStore,
): RedisBackedAuthenticationFeatureExtractor {
    return new RedisBackedAuthenticationFeatureExtractor({
        delegate: new DeterministicFeatureExtractor(),
        authenticationHistory: history,
    });
}

function snapshot(
    overrides: Partial<AuthenticationFeatureSnapshot> = {},
): AuthenticationFeatureSnapshot {
    return {
        replay: false,
        failedLoginCount10Minutes: 2,
        failedToSuccessRatio: 2 / 3,
        newSourceIp: 1,
        ...overrides,
    };
}

function authenticationEvent(
    eventId: string,
    timestamp: string,
    statusId: number | undefined,
): CreateNormalizedEventInput {
    return {
        event_id: eventId,
        class_uid: 3002,
        category_uid: 3,
        severity_id: statusId === 2 ? 3 : 1,
        ...(statusId === undefined ? {} : { status_id: statusId }),
        time: new Date(timestamp),
        message: statusId === 2 ? "Failed login" : "Successful login",
        src_endpoint: { ip: "192.0.2.10" },
        actor: { user: { name: "alice" } },
        metadata: { version: "1.1.0" },
        ingestion: {
            batch_id: "batch-be-feat-01d",
            collector_id: "collector-dev-01",
            ingested_at: new Date(timestamp),
        },
        org_id: "org-001",
    };
}
