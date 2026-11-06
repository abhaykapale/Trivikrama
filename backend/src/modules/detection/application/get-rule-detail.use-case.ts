import type {
  GetRuleDetailQuery,
  IRuleQueryRepository,
  RuleDetailView,
  RuleQueryRecord,
} from "../domain/rule-query.contracts.js";

export class GetRuleDetailUseCase {
  public constructor(
    private readonly rules: Pick<IRuleQueryRepository, "findById">,
  ) {}

  public async execute(input: GetRuleDetailQuery): Promise<RuleDetailView | null> {
    const rule = await this.rules.findById(input);
    return rule === null ? null : toDetail(rule);
  }
}

function toDetail(rule: RuleQueryRecord): RuleDetailView {
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
    falsePositives: rule.falsePositives,
    references: rule.references,
    yamlContent: rule.yamlContent,
    compiledHash: rule.compiledHash,
    isBuiltin: rule.isBuiltin,
    version: rule.version,
    createdBy: rule.createdBy,
    updatedBy: rule.updatedBy,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}
