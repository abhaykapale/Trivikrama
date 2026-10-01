import type { CreateNormalizedEventInput } from "../../../database/repositories/mongodb/normalized-event.repository.js";
import type {
    ExtractedFeatureVector,
    FeatureEnrichedEvent,
    FeatureExtractionResult,
    IFeatureExtractor,
    IFeaturePlugin,
} from "../domain/feature-extraction.contracts.js";

const COUNTER_NAMES = [
    "historyAppliedEvents",
    "historyFallbackEvents",
    "historyReplayHits",
    "authenticationHistoryAppliedEvents",
    "authenticationHistoryFallbackEvents",
    "authenticationHistoryReplayHits",
    "processHistoryAppliedEvents",
    "processHistoryFallbackEvents",
    "processHistoryReplayHits",
    "networkHistoryAppliedEvents",
    "networkHistoryFallbackEvents",
    "networkHistoryReplayHits",
] as const;

type CounterName = (typeof COUNTER_NAMES)[number];

export interface PluginFeatureExtractorDependencies {
    readonly base: IFeatureExtractor;
    readonly plugins: readonly IFeaturePlugin[];
}

/** Runs registered feature plugins in order and safely merges their output. */
export class PluginFeatureExtractor implements IFeatureExtractor {
    private readonly plugins: readonly IFeaturePlugin[];

    public constructor(private readonly dependencies: PluginFeatureExtractorDependencies) {
        this.plugins = validatePlugins(dependencies.plugins);
    }

    public async extract(
        events: readonly CreateNormalizedEventInput[],
    ): Promise<FeatureExtractionResult> {
        const base = await this.dependencies.base.extract(events);
        assertResultShape(base, events.length, "base extractor");

        const output = [...base.events];
        const counters = readCounters(base);
        const owners = new Map<string, string>();
        const executed: string[] = [];

        for (const plugin of this.plugins) {
            const allowed = new Set(plugin.applicableClasses());
            const indexes = output
                .map((event, index) => ({ event, index }))
                .filter(({ event }) => allowed.size === 0 || allowed.has(event.class_uid));
            if (indexes.length === 0) continue;

            const name = plugin.name();
            const pluginResult = await plugin.extract(indexes.map(({ event }) => event));
            assertResultShape(pluginResult, indexes.length, `plugin ${name}`);

            indexes.forEach(({ event: before, index }, resultIndex) => {
                const after = pluginResult.events[resultIndex]!;
                assertIdentityUnchanged(before, after, name);
                output[index] = mergeFeatures(before, after, name, owners);
            });
            addCounters(counters, pluginResult);
            executed.push(name);
        }

        return Object.freeze({
            events: Object.freeze(output),
            totalEvents: output.length,
            ...counters,
            pluginsExecuted: Object.freeze(executed),
        });
    }
}

function validatePlugins(plugins: readonly IFeaturePlugin[]): readonly IFeaturePlugin[] {
    const names = new Set<string>();
    for (const plugin of plugins) {
        const name = plugin.name().trim();
        if (name.length === 0) throw new Error("Feature plugin name must not be blank.");
        if (names.has(name)) throw new Error(`Duplicate feature plugin name: ${name}.`);
        names.add(name);

        const classes = plugin.applicableClasses();
        if (new Set(classes).size !== classes.length) {
            throw new Error(`Feature plugin ${name} contains duplicate OCSF classes.`);
        }
        if (classes.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
            throw new Error(`Feature plugin ${name} has an invalid OCSF class UID.`);
        }
    }
    return Object.freeze([...plugins]);
}

function assertResultShape(
    result: FeatureExtractionResult,
    expectedCount: number,
    source: string,
): void {
    if (result.events.length !== expectedCount || result.totalEvents !== expectedCount) {
        throw new Error(`${source} changed the feature batch cardinality.`);
    }
}

function assertIdentityUnchanged(
    before: FeatureEnrichedEvent,
    after: FeatureEnrichedEvent,
    plugin: string,
): void {
    if (
        before.event_id !== after.event_id ||
        before.org_id !== after.org_id ||
        before.class_uid !== after.class_uid ||
        before.category_uid !== after.category_uid ||
        before.time.getTime() !== after.time.getTime() ||
        before.ingestion.batch_id !== after.ingestion.batch_id ||
        before.ingestion.collector_id !== after.ingestion.collector_id
    ) {
        throw new Error(`Feature plugin ${plugin} changed protected event identity.`);
    }
}

function mergeFeatures(
    before: FeatureEnrichedEvent,
    after: FeatureEnrichedEvent,
    plugin: string,
    owners: Map<string, string>,
): FeatureEnrichedEvent {
    for (const name of Object.keys(before.features)) {
        if (!(name in after.features)) {
            throw new Error(`Feature plugin ${plugin} removed feature ${name}.`);
        }
    }

    for (const [name, value] of Object.entries(after.features)) {
        if (!Number.isFinite(value)) {
            throw new Error(`Feature plugin ${plugin} produced non-finite feature ${name}.`);
        }
        if (before.features[name as keyof ExtractedFeatureVector] === value) continue;

        const owner = owners.get(name);
        if (owner !== undefined && owner !== plugin) {
            throw new Error(`Feature ${name} is written by both ${owner} and ${plugin}.`);
        }
        owners.set(name, plugin);
    }

    return Object.freeze({ ...before, features: Object.freeze({ ...after.features }) });
}

function readCounters(result: FeatureExtractionResult): Record<CounterName, number> {
    return Object.fromEntries(
        COUNTER_NAMES.map((name) => [name, result[name]]),
    ) as Record<CounterName, number>;
}

function addCounters(
    counters: Record<CounterName, number>,
    result: FeatureExtractionResult,
): void {
    for (const name of COUNTER_NAMES) counters[name] += result[name];
}
