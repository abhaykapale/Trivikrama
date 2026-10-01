import type {
    FeatureEnrichedEvent,
    FeatureExtractionResult,
    IFeatureExtractor,
    IFeaturePlugin,
} from "../domain/feature-extraction.contracts.js";

export interface FeatureExtractorPluginAdapterOptions {
    readonly name: string;
    readonly applicableClasses?: readonly number[];
    readonly extractor: IFeatureExtractor;
}

/** Gives an existing extractor decorator plugin metadata. */
export class FeatureExtractorPluginAdapter implements IFeaturePlugin {
    private readonly pluginName: string;
    private readonly classUids: readonly number[];

    public constructor(private readonly options: FeatureExtractorPluginAdapterOptions) {
        this.pluginName = options.name.trim();
        this.classUids = Object.freeze([...(options.applicableClasses ?? [])]);
    }

    public name(): string {
        return this.pluginName;
    }

    public applicableClasses(): readonly number[] {
        return this.classUids;
    }

    public extract(
        events: readonly FeatureEnrichedEvent[],
    ): Promise<FeatureExtractionResult> {
        return this.options.extractor.extract(events);
    }
}
