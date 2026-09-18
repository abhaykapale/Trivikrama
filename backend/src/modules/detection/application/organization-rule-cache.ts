import type { OrganizationCompiledMatchRule } from "../domain/active-match-rule-source.contracts.js";
import type { OrganizationCompiledCountRule } from "../domain/active-count-rule-source.contracts.js";

type OrganizationCompiledRule =
  | OrganizationCompiledMatchRule
  | OrganizationCompiledCountRule;

interface RuleCacheSnapshot<TRule extends OrganizationCompiledRule> {
  readonly all: readonly TRule[];
  readonly byClass: ReadonlyMap<number, readonly TRule[]>;
  readonly byDatabaseId: ReadonlyMap<string, TRule>;
}

function emptySnapshot<TRule extends OrganizationCompiledRule>(): RuleCacheSnapshot<TRule> {
  return {
    all: Object.freeze([]) as readonly TRule[],
    byClass: new Map(),
    byDatabaseId: new Map(),
  };
}

/**
 * One cache belongs to one organization. replace() builds every index before
 * publishing the new snapshot, so evaluators never observe a half-built cache.
 */
export class OrganizationRuleCache<
  TRule extends OrganizationCompiledRule = OrganizationCompiledMatchRule,
> {
  private snapshot: RuleCacheSnapshot<TRule> = emptySnapshot<TRule>();
  public readonly organizationId: string;

  public constructor(organizationId: string) {
    const normalizedOrganizationId = organizationId.trim();

    if (normalizedOrganizationId.length === 0) {
      throw new Error("Rule cache organizationId must not be blank.");
    }

    this.organizationId = normalizedOrganizationId;
  }

  public replace(rules: readonly TRule[]): void {
    const sorted = [...rules].sort(
      (left, right) => right.priority - left.priority || left.id.localeCompare(right.id),
    );
    const byClass = new Map<number, TRule[]>();
    const byDatabaseId = new Map<string, TRule>();

    for (const rule of sorted) {
      if (rule.organizationId !== this.organizationId) {
        throw new Error("Cannot place another organization's rule in this cache.");
      }

      if (byDatabaseId.has(rule.id)) {
        throw new Error(`Duplicate database rule ID '${rule.id}' in cache snapshot.`);
      }

      byDatabaseId.set(rule.id, rule);
      const classRules = byClass.get(rule.logsource.classUid) ?? [];
      classRules.push(rule);
      byClass.set(rule.logsource.classUid, classRules);
    }

    this.snapshot = Object.freeze({
      all: Object.freeze(sorted),
      byClass: new Map(
        [...byClass].map(([classUid, classRules]) => [
          classUid,
          Object.freeze(classRules),
        ]),
      ),
      byDatabaseId,
    });
  }

  public getAll(): readonly TRule[] {
    return this.snapshot.all;
  }

  public getByClass(classUid: number): readonly TRule[] {
    return this.snapshot.byClass.get(classUid) ?? [];
  }

  public getByDatabaseId(
    databaseId: string,
  ): TRule | undefined {
    return this.snapshot.byDatabaseId.get(databaseId);
  }
}
