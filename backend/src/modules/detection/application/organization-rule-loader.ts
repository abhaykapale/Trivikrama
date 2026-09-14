import type {
  ActiveMatchRuleSourceRecord,
  IActiveMatchRuleSource,
  OrganizationCompiledMatchRule,
  RuleReloadReport,
} from "../domain/active-match-rule-source.contracts.js";
import type { CompiledSigmaMatchRule } from "../domain/rule-engine.contracts.js";
import { RuleValidationError } from "../domain/rule-validation.error.js";

export interface OrganizationRuleLoaderDependencies {
  readonly organizationId: string;
  readonly source: IActiveMatchRuleSource;
  readonly compile: (yamlContent: string) => CompiledSigmaMatchRule;
  readonly now?: () => Date;
}

export interface OrganizationRuleLoadCandidate {
  readonly rules: readonly OrganizationCompiledMatchRule[];
  readonly report: RuleReloadReport;
}

export class OrganizationRuleLoader {
  private readonly organizationId: string;
  private readonly now: () => Date;

  public constructor(private readonly dependencies: OrganizationRuleLoaderDependencies) {
    this.organizationId = requireOrganizationId(dependencies.organizationId);
    this.now = dependencies.now ?? (() => new Date());
  }

  public async load(
    previousRules: readonly OrganizationCompiledMatchRule[],
  ): Promise<OrganizationRuleLoadCandidate> {
    const sourceRules = await this.dependencies.source.listActiveMatchRules(
      this.organizationId,
    );
    assertSourceBoundary(sourceRules, this.organizationId);

    const previousById = new Map(previousRules.map((rule) => [rule.id, rule]));
    const sourceIds = new Set<string>();
    const candidateRules: OrganizationCompiledMatchRule[] = [];
    let compiledRules = 0;
    let reusedLastKnownGoodRules = 0;
    let rejectedRules = 0;

    for (const sourceRule of sourceRules) {
      if (sourceIds.has(sourceRule.databaseId)) {
        throw new Error(`Active rule source returned duplicate ID '${sourceRule.databaseId}'.`);
      }

      sourceIds.add(sourceRule.databaseId);

      try {
        const compiled = this.dependencies.compile(sourceRule.yamlContent);
        validateMetadataAgreement(sourceRule, compiled);
        candidateRules.push(toOrganizationRule(sourceRule, compiled));
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

    const removedRules = previousRules.filter(
      (rule) => !sourceIds.has(rule.id),
    ).length;

    return {
      rules: Object.freeze(candidateRules),
      report: {
        organizationId: this.organizationId,
        sourceRules: sourceRules.length,
        compiledRules,
        reusedLastKnownGoodRules,
        rejectedRules,
        removedRules,
        reloadedAt: this.now(),
      },
    };
  }
}

function toOrganizationRule(
  source: ActiveMatchRuleSourceRecord,
  compiled: CompiledSigmaMatchRule,
): OrganizationCompiledMatchRule {
  return Object.freeze({
    ...compiled,
    id: source.databaseId,
    organizationId: source.organizationId,
  });
}

function validateMetadataAgreement(
  source: ActiveMatchRuleSourceRecord,
  compiled: CompiledSigmaMatchRule,
): void {
  const issues: Array<{ path: string; message: string }> = [];

  if (source.name !== compiled.title) {
    issues.push({ path: "title", message: "does not match the PostgreSQL rule name" });
  }
  if (source.severity !== compiled.severity) {
    issues.push({ path: "level", message: "does not match the PostgreSQL severity" });
  }
  if (source.weight !== compiled.weight) {
    issues.push({ path: "weight", message: "does not match the PostgreSQL weight" });
  }
  if (source.classUid !== compiled.logsource.classUid) {
    issues.push({ path: "logsource.class_uid", message: "does not match PostgreSQL" });
  }
  if ((source.categoryUid ?? undefined) !== compiled.logsource.categoryUid) {
    issues.push({ path: "logsource.category_uid", message: "does not match PostgreSQL" });
  }

  if (issues.length > 0) {
    throw new RuleValidationError(issues);
  }
}

function assertSourceBoundary(
  rules: readonly ActiveMatchRuleSourceRecord[],
  organizationId: string,
): void {
  const crossing = rules.find((rule) => rule.organizationId !== organizationId);

  if (crossing !== undefined) {
    throw new Error("Active rule source crossed the requested organization boundary.");
  }
}

function requireOrganizationId(value: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error("Rule loader organizationId must not be blank.");
  }

  return normalized;
}
