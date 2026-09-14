export interface RuleValidationIssue {
  readonly path: string;
  readonly message: string;
}

export class RuleValidationError extends Error {
  public readonly code = "RULE_VALIDATION_FAILED";

  public constructor(public readonly issues: readonly RuleValidationIssue[]) {
    super(
      issues.length === 1
        ? `Rule validation failed: ${issues[0].path}: ${issues[0].message}`
        : `Rule validation failed with ${issues.length} issues.`,
    );
    this.name = "RuleValidationError";
  }
}
