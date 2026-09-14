import type { OrganizationCompiledMatchRule } from "../domain/active-match-rule-source.contracts.js";

interface RuleCacheSnapshot {
  readonly all: readonly OrganizationCompiledMatchRule[];
  readonly byClass: ReadonlyMap<number, readonly OrganizationCompiledMatchRule[]>;
  readonly byDatabaseId: ReadonlyMap<string, OrganizationCompiledMatchRule>;
}

const EMPTY_SNAPSHOT: RuleCacheSnapshot = {
  all: Object.freeze([]),
  byClass: new Map(),
  byDatabaseId: new Map(),
};

/**
 * One cache belongs to one organization. replace() builds every index before
 * publishing the new snapshot, so evaluators never observe a half-built cache.
 */
export class OrganizationRuleCache {
  private snapshot: RuleCacheSnapshot = EMPTY_SNAPSHOT;
  public readonly organizationId: string;

  public constructor(organizationId: string) {
    const normalizedOrganizationId = organizationId.trim();

    if (normalizedOrganizationId.length === 0) {
      throw new Error("Rule cache organizationId must not be blank.");
    }

    this.organizationId = normalizedOrganizationId;
  }

  public replace(rules: readonly OrganizationCompiledMatchRule[]): void {
    const sorted = [...rules].sort(
      (left, right) => right.priority - left.priority || left.id.localeCompare(right.id),
    );
    const byClass = new Map<number, OrganizationCompiledMatchRule[]>();
    const byDatabaseId = new Map<string, OrganizationCompiledMatchRule>();

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

  public getAll(): readonly OrganizationCompiledMatchRule[] {
    return this.snapshot.all;
  }

  public getByClass(classUid: number): readonly OrganizationCompiledMatchRule[] {
    return this.snapshot.byClass.get(classUid) ?? [];
  }

  public getByDatabaseId(
    databaseId: string,
  ): OrganizationCompiledMatchRule | undefined {
    return this.snapshot.byDatabaseId.get(databaseId);
  }
}
