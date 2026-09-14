import { RuleValidationError } from "../domain/rule-validation.error.js";

export type ConditionExpression =
  | { readonly type: "identifier"; readonly name: string }
  | { readonly type: "not"; readonly operand: ConditionExpression }
  | {
      readonly type: "and" | "or";
      readonly left: ConditionExpression;
      readonly right: ConditionExpression;
    };

type Token =
  | { readonly type: "identifier"; readonly value: string }
  | { readonly type: "and" | "or" | "not" | "leftParen" | "rightParen" };

const MAX_CONDITION_LENGTH = 1_024;
const MAX_TOKENS = 256;
const MAX_NESTING_DEPTH = 32;

export function parseConditionExpression(
  source: string,
  availableSelections: ReadonlySet<string>,
): ConditionExpression {
  const tokens = tokenize(source);
  const parser = new ConditionParser(tokens, availableSelections);
  return parser.parse();
}

export function evaluateConditionExpression(
  expression: ConditionExpression,
  selections: ReadonlyMap<string, boolean>,
): boolean {
  switch (expression.type) {
    case "identifier":
      return selections.get(expression.name) === true;
    case "not":
      return !evaluateConditionExpression(expression.operand, selections);
    case "and":
      return (
        evaluateConditionExpression(expression.left, selections) &&
        evaluateConditionExpression(expression.right, selections)
      );
    case "or":
      return (
        evaluateConditionExpression(expression.left, selections) ||
        evaluateConditionExpression(expression.right, selections)
      );
  }
}

function tokenize(source: string): readonly Token[] {
  if (source.length === 0 || source.length > MAX_CONDITION_LENGTH) {
    fail("detection.condition", `must contain 1-${MAX_CONDITION_LENGTH} characters`);
  }

  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const character = source[index];

    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }

    if (character === "(") {
      tokens.push({ type: "leftParen" });
      index += 1;
      continue;
    }

    if (character === ")") {
      tokens.push({ type: "rightParen" });
      index += 1;
      continue;
    }

    const match = /^[A-Za-z_][A-Za-z0-9_-]*/u.exec(source.slice(index));

    if (match === null) {
      fail("detection.condition", `contains an invalid token at character ${index + 1}`);
    }

    const value = match[0];
    const keyword = value.toLowerCase();

    if (keyword === "and" || keyword === "or" || keyword === "not") {
      tokens.push({ type: keyword });
    } else {
      tokens.push({ type: "identifier", value });
    }

    index += value.length;

    if (tokens.length > MAX_TOKENS) {
      fail("detection.condition", `must contain at most ${MAX_TOKENS} tokens`);
    }
  }

  if (tokens.length === 0) {
    fail("detection.condition", "must not be blank");
  }

  return tokens;
}

class ConditionParser {
  private index = 0;
  private depth = 0;

  public constructor(
    private readonly tokens: readonly Token[],
    private readonly availableSelections: ReadonlySet<string>,
  ) {}

  public parse(): ConditionExpression {
    const expression = this.parseOr();

    if (this.peek() !== undefined) {
      fail("detection.condition", "contains unexpected trailing input");
    }

    return expression;
  }

  private parseOr(): ConditionExpression {
    let expression = this.parseAnd();

    while (this.consume("or")) {
      expression = {
        type: "or",
        left: expression,
        right: this.parseAnd(),
      };
    }

    return expression;
  }

  private parseAnd(): ConditionExpression {
    let expression = this.parseUnary();

    while (this.consume("and")) {
      expression = {
        type: "and",
        left: expression,
        right: this.parseUnary(),
      };
    }

    return expression;
  }

  private parseUnary(): ConditionExpression {
    if (this.consume("not")) {
      return { type: "not", operand: this.parseUnary() };
    }

    return this.parsePrimary();
  }

  private parsePrimary(): ConditionExpression {
    const token = this.peek();

    if (token?.type === "identifier") {
      this.index += 1;

      if (!this.availableSelections.has(token.value)) {
        fail("detection.condition", `references unknown selection '${token.value}'`);
      }

      return { type: "identifier", name: token.value };
    }

    if (this.consume("leftParen")) {
      this.depth += 1;

      if (this.depth > MAX_NESTING_DEPTH) {
        fail("detection.condition", `must not exceed ${MAX_NESTING_DEPTH} nested groups`);
      }

      const expression = this.parseOr();

      if (!this.consume("rightParen")) {
        fail("detection.condition", "contains an unmatched opening parenthesis");
      }

      this.depth -= 1;
      return expression;
    }

    fail("detection.condition", "expected a selection name or opening parenthesis");
  }

  private consume(type: Token["type"]): boolean {
    if (this.peek()?.type !== type) {
      return false;
    }

    this.index += 1;
    return true;
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }
}

function fail(path: string, message: string): never {
  throw new RuleValidationError([{ path, message }]);
}
