import type {
  ActiveCountRuleSourceRecord,
  IActiveCountRuleSource,
  OrganizationCompiledCountRule,
} from "../domain/active-count-rule-source.contracts.js";
import type { CompiledSigmaCountRule } from "../domain/rule-engine.contracts.js";
import type { RuleReloadReport } from "../domain/active-match-rule-source.contracts.js";
import { RuleValidationError } from "../domain/rule-validation.error.js";

export interface OrganizationCountRuleLoaderDependencies {
  readonly organizationId: string;
  readonly source: IActiveCountRuleSource;
  readonly compile: (yamlContent: string) => CompiledSigmaCountRule;
  readonly now?: () => Date;
}

export interface OrganizationCountRuleLoadCandidate {
  readonly rules: readonly OrganizationCompiledCountRule[];
  readonly report: RuleReloadReport;
}

export class OrganizationCountRuleLoader {
  private readonly organizationId: string;
  private readonly now: () => Date;

  public constructor(
    private readonly dependencies: OrganizationCountRuleLoaderDependencies,
  ) {
    this.organizationId = requireOrganizationId(dependencies.organizationId);
    this.now = dependencies.now ?? (() => new Date());
  }

  public async load(
    previousRules: readonly OrganizationCompiledCountRule[],
  ): Promise<OrganizationCountRuleLoadCandidate> {
    const sourceRules = await this.dependencies.source.listActiveCountRules(
      this.organizationId,
    );
    assertSourceBoundary(sourceRules, this.organizationId);

    const previousById = new Map(previousRules.map((rule) => [rule.id, rule]));
    const sourceIds = new Set<string>();
    const candidateRules: OrganizationCompiledCountRule[] = [];
    let compiledRules = 0;
    let reusedLastKnownGoodRules = 0;
    let rejectedRules = 0;

    for (const sourceRule of sourceRules) {
      if (sourceIds.has(sourceRule.databaseId)) {
        throw new Error(
          `Active count-rule source returned duplicate ID '${sourceRule.databaseId}'.`,
        );
      }

      sourceIds.add(sourceRule.databaseId);

      try {
        const compiled = this.dependencies.compile(sourceRule.yamlContent);
        validateMetadataAgreement(sourceRule, compiled);
        candidateRules.push(
          Object.freeze({
            ...compiled,
            id: sourceRule.databaseId,
            organizationId: sourceRule.organizationId,
          }),
        );
        compiledRules += 1;
      } catch (error) {
        if (!(error instanceof RuleValidationError)) {
          throw error;
        }

        rejectedRules += 1;
        const previous = previousById.get(sourceRule.databaseId);
        if (previous !== undefined) {
          candidateRules.push(previous);
          reusedLastKnownGoodRules += 1;
        }
      }
    }

    return {
      rules: Object.freeze(candidateRules),
      report: {
        organizationId: this.organizationId,
        sourceRules: sourceRules.length,
        compiledRules,
        reusedLastKnownGoodRules,
        rejectedRules,
        removedRules: previousRules.filter((rule) => !sourceIds.has(rule.id))
          .length,
        reloadedAt: this.now(),
      },
    };
  }
}

function validateMetadataAgreement(
  source: ActiveCountRuleSourceRecord,
  compiled: CompiledSigmaCountRule,
): void {
  const issues: Array<{ path: string; message: string }> = [];

  if (source.name !== compiled.title) {
    issues.push({ path: "title", message: "does not match PostgreSQL" });
  }
  if (source.severity !== compiled.severity) {
    issues.push({ path: "level", message: "does not match PostgreSQL" });
  }
  if (source.weight !== compiled.weight) {
    issues.push({ path: "weight", message: "does not match PostgreSQL" });
  }
  if (source.classUid !== compiled.logsource.classUid) {
    issues.push({
      path: "logsource.class_uid",
      message: "does not match PostgreSQL",
    });
  }
  if ((source.categoryUid ?? undefined) !== compiled.logsource.categoryUid) {
    issues.push({
      path: "logsource.category_uid",
      message: "does not match PostgreSQL",
    });
  }

  if (issues.length > 0) {
    throw new RuleValidationError(issues);
  }
}

function assertSourceBoundary(
  rules: readonly ActiveCountRuleSourceRecord[],
  organizationId: string,
): void {
  if (rules.some((rule) => rule.organizationId !== organizationId)) {
    throw new Error("Active count-rule source crossed the requested organization boundary.");
  }
}

function requireOrganizationId(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error("Count-rule loader organizationId must not be blank.");
  }
  return normalized;
}
