import type { ICollectorStatusRepository } from "../../../database/index.js";
import type {
  ICollectorMonitoringRepository,
  MonitoredCollectorRecord,
} from "../domain/collector-monitoring.contracts.js";

const PAGE_SIZE = 100;

export class CollectorMonitoringRepositoryAdapter
  implements ICollectorMonitoringRepository
{
  public constructor(
    private readonly repository: Pick<ICollectorStatusRepository, "list">,
  ) {}

  public async listByOrgId(
    orgId: string,
  ): Promise<readonly MonitoredCollectorRecord[]> {
    const records: MonitoredCollectorRecord[] = [];
    let offset = 0;

    while (true) {
      const page = await this.repository.list({
        orgId,
        limit: PAGE_SIZE,
        offset,
      });

      records.push(...page.items);

      if (!page.hasMore) {
        return records;
      }

      if (page.items.length === 0) {
        throw new Error("Collector status pagination did not advance.");
      }

      offset += page.items.length;
    }
  }
}

