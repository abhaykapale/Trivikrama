import { parseAllDocuments } from "yaml";

import { RuleValidationError } from "../domain/rule-validation.error.js";

const MAX_RULE_SOURCE_BYTES = 128 * 1_024;
const MAX_ALIAS_EXPANSIONS = 20;

export function parseYamlRuleDocument(source: string): unknown {
  if (Buffer.byteLength(source, "utf8") > MAX_RULE_SOURCE_BYTES) {
    throw new RuleValidationError([
      {
        path: "$",
        message: `YAML source must not exceed ${MAX_RULE_SOURCE_BYTES} UTF-8 bytes`,
      },
    ]);
  }

  let documents;


  try {
    documents = parseAllDocuments(source, {
      schema: "core",
      uniqueKeys : true,
    })
  } catch {
    return failYaml();
  }

  if (documents.length !== 1 || documents[0].errors.length > 0) {
    return failYaml();
  }

  try {
    return documents[0].toJS({ maxAliasCount: MAX_ALIAS_EXPANSIONS });
  } catch {
    return failYaml();
  }
}

function failYaml(): never {
  throw new RuleValidationError([
    {
      path: "$",
      message: "must contain exactly one valid YAML document with unique keys",
    },
  ]);
}
