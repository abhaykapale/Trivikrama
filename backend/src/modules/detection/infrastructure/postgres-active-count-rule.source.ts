import type { IRuleRepository } from "../../../database/repositories/rules/rule.repository.js";
import type {
  ActiveCountRuleSourceRecord,
  IActiveCountRuleSource,
} from "../domain/active-count-rule-source.contracts.js";

const DEFAULT_PAGE_SIZE = 100;

export class PostgresActiveCountRuleSource implements IActiveCountRuleSource {
  public constructor(
    private readonly repository: Pick<IRuleRepository, "list">,
    private readonly pageSize = DEFAULT_PAGE_SIZE,
  ) {
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw new Error("Count-rule source pageSize must be an integer between 1 and 100.");
    }
  }

  public async listActiveCountRules(
    organizationId: string,
  ): Promise<readonly ActiveCountRuleSourceRecord[]> {
    const normalizedOrganizationId = organizationId.trim();

    if (normalizedOrganizationId.length === 0) {
      throw new Error("Count-rule source organizationId must not be blank.");
    }

    const records: ActiveCountRuleSourceRecord[] = [];
    let offset = 0;

    while (true) {
      const page = await this.repository.list({
        orgId: normalizedOrganizationId,
        status: "active",
        type: "count",
        limit: this.pageSize,
        offset,
      });

      for (const record of page.items) {
        if (
          record.orgId !== normalizedOrganizationId ||
          record.status !== "active" ||
          record.type !== "count"
        ) {
          throw new Error("Rule repository violated the active organization-scoped count query.");
        }

        records.push({
          databaseId: record.id,
          organizationId: record.orgId,
          name: record.name,
          severity: record.severity,
          weight: record.weight,
          classUid: record.classUid,
          categoryUid: record.categoryUid,
          yamlContent: record.yamlContent,
        });
      }

      if (!page.hasMore) {
        break;
      }

      if (page.items.length === 0) {
        throw new Error("Rule repository returned an empty count-rule page while hasMore was true.");
      }

      offset += page.items.length;
    }

    return Object.freeze(records);
  }
}
