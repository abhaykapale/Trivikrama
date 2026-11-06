import type {
  ImportRuleItemResult,
  ImportRulesCommand,
  ImportRulesResult,
  RuleCreationUnitOfWork,
  RuleReloadSignalPublisher,
  ValidatedSigmaRule,
} from "../domain/rule-command.contracts.js";
import {
  DuplicateSigmaRuleError,
  RuleRepositoryUniqueConflictError,
} from "../domain/rule-command.contracts.js";
import { RuleValidationError } from "../domain/rule-validation.error.js";
import { parseSigmaRuleImport } from "./sigma-rule-import.parser.js";
import { validateSigmaRuleYaml } from "./validate-sigma-rule.js";

export interface ImportRulesUseCaseDependencies {
  readonly unitOfWork: RuleCreationUnitOfWork;
  readonly reloadSignals: RuleReloadSignalPublisher;
}

export class ImportRulesUseCase {
  public constructor(private readonly dependencies: ImportRulesUseCaseDependencies) {}

  public async execute(command: ImportRulesCommand): Promise<ImportRulesResult> {
    const documents = parseSigmaRuleImport(command.yamlContent);
    const results: ImportRuleItemResult[] = [];
    let lastImportedDatabaseId: string | null = null;

    for (const document of documents) {
      if (document.yamlContent === null) {
        results.push({
          document: document.document,
          id: null,
          name: null,
          status: "failed",
          code: "RULE_VALIDATION_FAILED",
          errors: document.errors,
        });
        continue;
      }

      let validated: ValidatedSigmaRule;
      try {
        validated = validateSigmaRuleYaml(document.yamlContent);
      } catch (error: unknown) {
        if (!(error instanceof RuleValidationError)) throw error;
        results.push({
          document: document.document,
          id: null,
          name: null,
          status: "failed",
          code: error.code,
          errors: error.issues.map((issue) => `${issue.path}: ${issue.message}`),
        });
        continue;
      }

      try {
        const created = await this.dependencies.unitOfWork.execute(async (transaction) => {
          const duplicateId = await transaction.rules.findBySigmaId(
            validated.sigmaId,
            command.orgId,
          );
          if (duplicateId !== null) {
            throw new DuplicateSigmaRuleError("sigmaId", validated.sigmaId);
          }
          const duplicateName = await transaction.rules.findByName(
            validated.name,
            command.orgId,
          );
          if (duplicateName !== null) {
            throw new DuplicateSigmaRuleError("name", validated.name);
          }

          const rule = await transaction.rules.create({
            sigmaId: validated.sigmaId,
            name: validated.name,
            description: validated.description,
            status: "active",
            type: validated.type,
            severity: validated.severity,
            weight: validated.weight,
            yamlContent: validated.yamlContent,
            compiledHash: validated.compiledHash,
            classUid: validated.classUid,
            categoryUid: validated.categoryUid,
            tags: validated.tags,
            falsePositives: validated.falsePositives,
            ruleReferences: validated.references,
            version: 1,
            isBuiltin: false,
            createdBy: command.actor.id,
            updatedBy: command.actor.id,
            orgId: command.orgId,
          });

          await transaction.audit.create({
            action: "rule_import",
            actorId: command.actor.id,
            actorUsername: command.actor.username,
            actorRole: command.actor.role,
            ipAddress: command.actor.ipAddress,
            targetType: "rule",
            targetId: rule.id,
            targetName: rule.name,
            details: {
              document: document.document,
              sigmaId: validated.sigmaId,
              compiledHash: validated.compiledHash,
            },
            newState: importAuditState(validated, rule.id),
            orgId: command.orgId,
          });
          return rule;
        });

        lastImportedDatabaseId = created.id;
        results.push({
          document: document.document,
          id: validated.sigmaId,
          name: validated.name,
          status: "imported",
        });
      } catch (error: unknown) {
        const duplicate = normalizeDuplicate(error, validated);
        if (duplicate === null) throw error;
        results.push({
          document: document.document,
          id: validated.sigmaId,
          name: validated.name,
          status: "skipped",
          code: duplicate.code,
          errors: [duplicate.message],
        });
      }
    }

    const reloadSignaled = lastImportedDatabaseId === null
      ? false
      : await this.dependencies.reloadSignals.publish({
          organizationId: command.orgId,
          ruleId: lastImportedDatabaseId,
          operation: "imported",
        });

    return {
      imported: results.filter((item) => item.status === "imported").length,
      skipped: results.filter((item) => item.status === "skipped").length,
      failed: results.filter((item) => item.status === "failed").length,
      results,
      reloadSignaled,
    };
  }
}

function normalizeDuplicate(
  error: unknown,
  validated: ValidatedSigmaRule,
): DuplicateSigmaRuleError | null {
  if (error instanceof DuplicateSigmaRuleError) return error;
  if (!(error instanceof RuleRepositoryUniqueConflictError)) return null;
  if (error.constraint === "uq_rules_org_name_ci") {
    return new DuplicateSigmaRuleError("name", validated.name);
  }
  if (error.constraint === "uq_rules_org_sigma_id") {
    return new DuplicateSigmaRuleError("sigmaId", validated.sigmaId);
  }
  return null;
}

function importAuditState(rule: ValidatedSigmaRule, id: string): Record<string, unknown> {
  return {
    id,
    sigmaId: rule.sigmaId,
    name: rule.name,
    status: "active",
    type: rule.type,
    severity: rule.severity,
    weight: rule.weight,
    priority: rule.priority,
    classUid: rule.classUid,
    categoryUid: rule.categoryUid,
    tags: [...rule.tags],
    version: 1,
    isBuiltin: false,
  };
}
