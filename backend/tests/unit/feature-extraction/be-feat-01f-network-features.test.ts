import assert from "node:assert/strict";
import test from "node:test";

import type { CreateNormalizedEventInput } from "../../../src/database/repositories/mongodb/normalized-event.repository.js";
import {
    AI_FEATURE_NAMES,
    DeterministicFeatureExtractor,
    RedisBackedNetworkFeatureExtractor,
    RedisNetworkFeatureStore,
    isInternalToExternal,
    isRfc1918Ipv4,
    selectAiFeatureVector,
    type INetworkFeatureStore,
    type NetworkFeatureSnapshot,
    type RecordNetworkFeatureInput,
} from "../../../src/modules/feature-extraction/index.js";

test("applies network history in event-time order and preserves input order", async () => {
    const history = new RecordingNetworkStore();
    const later = networkEvent("later", "2026-09-19T10:00:30.000Z");
    const earlier = networkEvent("earlier", "2026-09-19T10:00:00.000Z");

    const result = await createExtractor(history).extract([later, earlier]);

    assert.deepEqual(history.inputs.map((input) => input.eventId), ["earlier", "later"]);
    assert.deepEqual(result.events.map((event) => event.event_id), ["later", "earlier"]);
    assert.equal(result.events[0]?.features.dst_port_rarity, 0.75);
    assert.equal(result.networkHistoryAppliedEvents, 2);
    assert.equal(result.networkHistoryFallbackEvents, 0);
});

test("extracts deterministic network and DNS context", async () => {
    const network = networkEvent("network", "2026-09-19T10:00:00.000Z");
    const dns = {
        ...networkEvent("dns", "2026-09-19T10:00:01.000Z"),
        class_uid: 4003,
        duration: undefined,
        query: { hostname: "évil.example" },
    };
    const result = await createExtractor(new RecordingNetworkStore()).extract([network, dns]);

    assert.equal(result.events[0]?.features.is_internal_to_external, 1);
    assert.equal(result.events[0]?.features.connection_duration, 1_250);
    assert.equal(result.events[0]?.features.is_known_bad_port, 1);
    assert.equal(result.events[0]?.features.dns_query_length, 0);
    assert.equal(result.events[1]?.features.dns_query_length, 12);
    assert.equal(result.events[1]?.features.connection_duration, 0);
});

test("classifies only RFC1918-to-public IPv4 as internal-to-external", () => {
    assert.equal(isRfc1918Ipv4("10.2.3.4"), true);
    assert.equal(isRfc1918Ipv4("172.31.0.1"), true);
    assert.equal(isRfc1918Ipv4("192.168.1.1"), true);
    assert.equal(isRfc1918Ipv4("172.32.0.1"), false);
    assert.equal(isInternalToExternal("10.0.0.1", "8.8.8.8"), true);
    assert.equal(isInternalToExternal("10.0.0.1", "127.0.0.1"), false);
    assert.equal(isInternalToExternal("2001:db8::1", "2606:4700:4700::1111"), false);
});

test("keeps deterministic context and neutral rarity when Redis fails", async () => {
    const result = await createExtractor({
        async record() {
            throw new Error("Redis unavailable");
        },
    }).extract([networkEvent("failed", "2026-09-19T10:00:00.000Z")]);

    assert.equal(result.events[0]?.features.dst_port_rarity, 0);
    assert.equal(result.events[0]?.features.connection_duration, 1_250);
    assert.equal(result.networkHistoryFallbackEvents, 1);
});

test("skips history for non-network events and missing destination ports", async () => {
    const history = new RecordingNetworkStore();
    const process = { ...networkEvent("process", "2026-09-19T10:00:00.000Z"), class_uid: 1007 };
    const missingPort = {
        ...networkEvent("missing-port", "2026-09-19T10:00:01.000Z"),
        dst_endpoint: { ip: "8.8.8.8" },
    };

    const result = await createExtractor(history).extract([process, missingPort]);

    assert.equal(history.inputs.length, 0);
    assert.equal(result.events[0]?.features.dst_port_rarity, undefined);
    assert.equal(result.events[1]?.features.dst_port_rarity, 0);
});

test("reports replay snapshots and keeps the AI payload at exactly 20 fields", async () => {
    const result = await createExtractor({
        async record() {
            return { replay: true, destinationPortRarity: 0.25 };
        },
    }).extract([networkEvent("replay", "2026-09-19T10:00:00.000Z")]);

    const aiVector = selectAiFeatureVector(result.events[0]!.features);
    assert.equal(result.networkHistoryReplayHits, 1);
    assert.deepEqual(Object.keys(aiVector), [...AI_FEATURE_NAMES]);
    assert.equal(Object.keys(aiVector).length, 20);
    assert.equal("dst_port_rarity" in aiVector, false);
});

test("hashes network identities in Redis keys", async () => {
    const redis = new FakeRedisEval();
    const store = new RedisNetworkFeatureStore(redis, { keyPrefix: "features:network:test" });

    await store.record(networkInput());

    const joined = redis.calls[0]?.join("|") ?? "";
    for (const secret of ["secret-org", "sensitive-event", "workstation-01"]) {
        assert.equal(joined.includes(secret), false);
    }
    assert.equal(redis.numberOfKeys[0], 3);
});

test("rejects malformed Redis snapshots, bad ports, and invalid configuration", async () => {
    const malformed = new RedisNetworkFeatureStore(new FakeRedisEval([0, "1.5"]));
    await assert.rejects(malformed.record(networkInput()), /non-finite network-feature value/);
    await assert.rejects(
        malformed.record({ ...networkInput(), destinationPort: 0 }),
        /integer from 1 through 65535/,
    );
    assert.throws(
        () => new RedisNetworkFeatureStore(new FakeRedisEval(), { snapshotTtlMs: 100 }),
        /1 to 30 days/,
    );
    assert.throws(
        () => createExtractor(new RecordingNetworkStore(), [0]),
        /Known-bad ports/,
    );
});

class RecordingNetworkStore implements INetworkFeatureStore {
    public readonly inputs: RecordNetworkFeatureInput[] = [];

    public async record(input: RecordNetworkFeatureInput): Promise<NetworkFeatureSnapshot> {
        this.inputs.push(input);
        return { replay: false, destinationPortRarity: 0.75 };
    }
}

class FakeRedisEval {
    public readonly calls: Array<readonly (string | number)[]> = [];
    public readonly numberOfKeys: number[] = [];

    public constructor(private readonly response: unknown = [0, "0.75"]) {}

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
    history: INetworkFeatureStore,
    knownBadPorts?: readonly number[],
): RedisBackedNetworkFeatureExtractor {
    return new RedisBackedNetworkFeatureExtractor({
        delegate: new DeterministicFeatureExtractor(),
        networkHistory: history,
        ...(knownBadPorts === undefined ? {} : { knownBadPorts }),
    });
}

function networkInput(): RecordNetworkFeatureInput {
    return {
        organizationId: "secret-org",
        eventId: "sensitive-event",
        occurredAtEpochMs: Date.parse("2026-09-19T10:00:00.000Z"),
        sourceIdentity: "workstation-01",
        destinationPort: 4444,
    };
}

function networkEvent(eventId: string, timestamp: string): CreateNormalizedEventInput {
    return {
        event_id: eventId,
        class_uid: 4001,
        category_uid: 4,
        severity_id: 3,
        time: new Date(timestamp),
        message: "Outbound connection",
        duration: 1_250,
        src_endpoint: { ip: "10.0.0.7", hostname: "workstation-01" },
        dst_endpoint: { ip: "8.8.8.8", port: 4444 },
        metadata: { version: "1.4.0" },
        ingestion: {
            batch_id: "batch-be-feat-01f",
            collector_id: "collector-dev-01",
            ingested_at: new Date(timestamp),
        },
        org_id: "org-001",
    };
}
