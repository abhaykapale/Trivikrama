import type { IRuleQueryRepository } from "../domain/rule-query.contracts.js";
import {
  RULE_EXPORT_MAX_RULES,
  RuleExportLimitExceededError,
  ruleOperationalSystemClock,
  type ExportRulesInput,
  type ExportRulesResult,
  type RuleOperationalClock,
} from "../domain/rule-operational.contracts.js";

const EXPORT_PAGE_SIZE = 200;

export class ExportRulesUseCase {
  public constructor(
    private readonly rules: Pick<IRuleQueryRepository, "list">,
    private readonly clock: RuleOperationalClock = ruleOperationalSystemClock,
  ) {}

  public async execute(input: ExportRulesInput): Promise<ExportRulesResult> {
    const yamlDocuments: string[] = [];
    let page = 1;
    let total = 0;

    do {
      const result = await this.rules.list({
        orgId: input.orgId,
        status: input.status,
        page,
        limit: EXPORT_PAGE_SIZE,
        sort: "name",
        order: "asc",
      });
      total = result.total;
      if (total > RULE_EXPORT_MAX_RULES) {
        throw new RuleExportLimitExceededError(total);
      }
      yamlDocuments.push(...result.items.map((rule) => rule.yamlContent.trim()));
      // Concurrent rule changes can make a previously reported total stale.
      // Stop on an empty page so an export can never spin indefinitely.
      if (result.items.length === 0) {
        break;
      }
      page += 1;
    } while (yamlDocuments.length < total);

    const date = this.clock.now().toISOString().slice(0, 10).replaceAll("-", "");
    return {
      content: yamlDocuments.length === 0 ? "" : `${yamlDocuments.join("\n---\n")}\n`,
      filename: `rules_export_${date}.yaml`,
      count: yamlDocuments.length,
    };
  }
}
