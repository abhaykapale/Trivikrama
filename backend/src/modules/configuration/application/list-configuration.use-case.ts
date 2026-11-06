import type { ConfigurationQueryRepository, ConfigurationView, ListConfigurationResult } from "../domain/configuration.contracts.js";

export class ListConfigurationUseCase {
  public constructor(private readonly configuration: ConfigurationQueryRepository) {}
  public async execute(): Promise<ListConfigurationResult> {
    const page = await this.configuration.list({ includeSensitive: false, limit: 100, offset: 0 });
    return {
      data: page.items.map((record): ConfigurationView => ({
        key: record.key,
        value: record.value,
        description: record.description,
        isSensitive: false,
        updatedAt: record.updatedAt,
      })),
    };
  }
}
