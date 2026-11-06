import type {
  IRuleQueryRepository,
  ListRulesQuery,
  ListRulesResult,
  RuleListItemView,
  RuleQueryRecord,
} from "../domain/rule-query.contracts.js";

export class ListRulesUseCase {
  public constructor(
    private readonly rules: Pick<IRuleQueryRepository, "list">,
  ) {}

  public async execute(input: ListRulesQuery): Promise<ListRulesResult> {
    const result = await this.rules.list(input);
    const totalPages = Math.ceil(result.total / input.limit);

    return {
      data: result.items.map(toListItem),
      pagination: {
        page: input.page,
        limit: input.limit,
        total: result.total,
        totalPages,
        hasNext: input.page < totalPages,
        hasPrev: input.page > 1,
      },
    };
  }
}

function toListItem(rule: RuleQueryRecord): RuleListItemView {
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description,
    status: rule.status,
    type: rule.type,
    severity: rule.severity,
    weight: rule.weight,
    priority: rule.priority,
    classUid: rule.classUid,
    categoryUid: rule.categoryUid,
    tags: rule.tags,
    isBuiltin: rule.isBuiltin,
    version: rule.version,
    alertsGenerated: rule.alertsGenerated,
    lastTriggeredAt: rule.lastTriggeredAt,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}
