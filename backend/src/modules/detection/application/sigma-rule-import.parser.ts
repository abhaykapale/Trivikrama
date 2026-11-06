import { parseAllDocuments } from "yaml";

import { RuleValidationError } from "../domain/rule-validation.error.js";
import { MAX_SIGMA_IMPORT_BYTES } from "../domain/rule-command.contracts.js";

export const MAX_SIGMA_IMPORT_DOCUMENTS = 50;
const MAX_ALIAS_EXPANSIONS = 20;

interface YamlDocumentLike {
  readonly contents: unknown;
  readonly errors: readonly unknown[];
  toJS(options: { readonly maxAliasCount: number }): unknown;
  toString(): string;
}

export interface SigmaRuleImportDocument {
  readonly document: number;
  readonly yamlContent: string | null;
  readonly errors: readonly string[];
}

export function parseSigmaRuleImport(source: string): readonly SigmaRuleImportDocument[] {
  if (Buffer.byteLength(source, "utf8") > MAX_SIGMA_IMPORT_BYTES) {
    throw new RuleValidationError([{
      path: "$",
      message: `import source must not exceed ${MAX_SIGMA_IMPORT_BYTES} UTF-8 bytes`,
    }]);
  }

  let documents: readonly YamlDocumentLike[];
  try {
    documents = parseAllDocuments(source, {
      schema: "core",
      uniqueKeys: true,
    }) as unknown as readonly YamlDocumentLike[];
  } catch {
    throw invalidImport("must contain valid YAML documents with unique keys");
  }

  const nonEmpty = documents.filter((document) => document.contents !== null);
  if (nonEmpty.length === 0) {
    throw invalidImport("must contain at least one non-empty YAML document");
  }
  if (nonEmpty.length > MAX_SIGMA_IMPORT_DOCUMENTS) {
    throw invalidImport(`must contain at most ${MAX_SIGMA_IMPORT_DOCUMENTS} YAML documents`);
  }

  return nonEmpty.map((document, index) => {
    if (document.errors.length > 0) {
      return failedDocument(index, "must be valid YAML with unique keys");
    }

    try {
      document.toJS({ maxAliasCount: MAX_ALIAS_EXPANSIONS });
      const yamlContent = String(document).trim();
      if (yamlContent.length === 0) {
        return failedDocument(index, "must not be empty");
      }
      return {
        document: index + 1,
        yamlContent: `${yamlContent}\n`,
        errors: [],
      };
    } catch {
      return failedDocument(index, "contains unsafe or excessive YAML aliases");
    }
  });
}

function failedDocument(index: number, message: string): SigmaRuleImportDocument {
  return {
    document: index + 1,
    yamlContent: null,
    errors: [`$: ${message}`],
  };
}

function invalidImport(message: string): RuleValidationError {
  return new RuleValidationError([{ path: "$", message }]);
}
