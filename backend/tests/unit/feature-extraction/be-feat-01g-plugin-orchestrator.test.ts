import assert from "node:assert/strict";
import test from "node:test";

import type { CreateNormalizedEventInput } from "../../../src/database/repositories/mongodb/normalized-event.repository.js";
import {
    DeterministicFeatureExtractor,
    PassthroughFeatureExtractor,
    PluginFeatureExtractor,
    type FeatureEnrichedEvent,
    type FeatureExtractionResult,
    type IFeaturePlugin,
} from "../../../src/modules/feature-extraction/index.js";

test("runs plugins in registration order and filters by OCSF class", async () => {
    const calls: string[] = [];
    const orchestrator = new PluginFeatureExtractor({
        base: new DeterministicFeatureExtractor(),
        plugins: [
            new TestPlugin("all-events", [], calls, (event) => ({
                ...event.features,
                time_deviation_score: 2,
            })),
            new TestPlugin("network-only", [4001], calls, (event) => ({
                ...event.features,
                dst_port_rarity: 0.75,
            })),
        ],
    });

    const result = await orchestrator.extract([
        event("network", 4001),
        event("authentication", 3002),
    ]);

    assert.deepEqual(calls, ["all-events:network,authentication", "network-only:network"]);
    assert.deepEqual(result.pluginsExecuted, ["all-events", "network-only"]);
    assert.equal(result.events[0]?.features.time_deviation_score, 2);
    assert.equal(result.events[1]?.features.time_deviation_score, 2);
    assert.equal(result.events[0]?.features.dst_port_rarity, 0.75);
    assert.equal(result.events[1]?.features.dst_port_rarity, undefined);
    assert.deepEqual(result.events.map((item) => item.event_id), ["network", "authentication"]);
});

test("skips a plugin when no event has an applicable class", async () => {
    const calls: string[] = [];
    const result = await new PluginFeatureExtractor({
        base: new DeterministicFeatureExtractor(),
        plugins: [new TestPlugin("process", [1007], calls)],
    }).extract([event("authentication", 3002)]);

    assert.deepEqual(calls, []);
    assert.deepEqual(result.pluginsExecuted, []);
});

test("rejects two plugins that write different values to the same feature", async () => {
    const calls: string[] = [];
    const orchestrator = new PluginFeatureExtractor({
        base: new DeterministicFeatureExtractor(),
        plugins: [
            new TestPlugin("first", [], calls, (event) => ({
                ...event.features,
                frequency_deviation: 1,
            })),
            new TestPlugin("second", [], calls, (event) => ({
                ...event.features,
                frequency_deviation: 2,
            })),
        ],
    });

    await assert.rejects(
        orchestrator.extract([event("event-1", 4001)]),
        /written by both first and second/,
    );
});

test("rejects plugins that mutate protected event identity", async () => {
    const orchestrator = new PluginFeatureExtractor({
        base: new DeterministicFeatureExtractor(),
        plugins: [new IdentityChangingPlugin()],
    });

    await assert.rejects(
        orchestrator.extract([event("event-1", 4001)]),
        /changed protected event identity/,
    );
});

test("validates plugin names and OCSF class declarations at startup", () => {
    const base = new DeterministicFeatureExtractor();
    const calls: string[] = [];
    assert.throws(
        () => new PluginFeatureExtractor({
            base,
            plugins: [new TestPlugin("same", [], calls), new TestPlugin("same", [], calls)],
        }),
        /Duplicate feature plugin name/,
    );
    assert.throws(
        () => new PluginFeatureExtractor({
            base,
            plugins: [new TestPlugin("bad-classes", [4001, 4001], calls)],
        }),
        /duplicate OCSF classes/,
    );
    assert.throws(
        () => new PluginFeatureExtractor({
            base,
            plugins: [new TestPlugin("bad-class", [0], calls)],
        }),
        /invalid OCSF class UID/,
    );
});

test("passthrough adapter accepts only already-enriched events", async () => {
    const passthrough = new PassthroughFeatureExtractor();
    await assert.rejects(passthrough.extract([event("raw", 4001)]), /enriched by the base/);

    const base = await new DeterministicFeatureExtractor().extract([event("ready", 4001)]);
    const passed = await passthrough.extract(base.events);
    assert.strictEqual(passed.events[0], base.events[0]);
});

class TestPlugin implements IFeaturePlugin {
    public constructor(
        private readonly pluginName: string,
        private readonly classes: readonly number[],
        private readonly calls: string[],
        private readonly transform: (
            event: FeatureEnrichedEvent,
        ) => FeatureEnrichedEvent["features"] = (item) => item.features,
    ) {}

    public name(): string {
        return this.pluginName;
    }

    public applicableClasses(): readonly number[] {
        return this.classes;
    }

    public async extract(
        events: readonly FeatureEnrichedEvent[],
    ): Promise<FeatureExtractionResult> {
        this.calls.push(`${this.pluginName}:${events.map((item) => item.event_id).join(",")}`);
        return result(events.map((item) => Object.freeze({
            ...item,
            features: Object.freeze(this.transform(item)),
        })));
    }
}

class IdentityChangingPlugin implements IFeaturePlugin {
    public name(): string {
        return "identity-changing";
    }

    public applicableClasses(): readonly number[] {
        return [];
    }

    public async extract(
        events: readonly FeatureEnrichedEvent[],
    ): Promise<FeatureExtractionResult> {
        return result(events.map((item) => ({ ...item, org_id: "other-org" })));
    }
}

function result(events: readonly FeatureEnrichedEvent[]): FeatureExtractionResult {
    return {
        events,
        totalEvents: events.length,
        historyAppliedEvents: 0,
        historyFallbackEvents: 0,
        historyReplayHits: 0,
        authenticationHistoryAppliedEvents: 0,
        authenticationHistoryFallbackEvents: 0,
        authenticationHistoryReplayHits: 0,
        processHistoryAppliedEvents: 0,
        processHistoryFallbackEvents: 0,
        processHistoryReplayHits: 0,
        networkHistoryAppliedEvents: 0,
        networkHistoryFallbackEvents: 0,
        networkHistoryReplayHits: 0,
        pluginsExecuted: [],
    };
}

function event(eventId: string, classUid: number): CreateNormalizedEventInput {
    return {
        event_id: eventId,
        class_uid: classUid,
        category_uid: classUid === 1007 ? 1 : classUid === 3002 ? 3 : 4,
        severity_id: 3,
        time: new Date("2026-09-19T10:00:00.000Z"),
        message: "Plugin orchestration test",
        metadata: { version: "1.4.0" },
        ingestion: {
            batch_id: "batch-be-feat-01g",
            collector_id: "collector-dev-01",
            ingested_at: new Date("2026-09-19T10:00:01.000Z"),
        },
        org_id: "org-001",
    };
}
