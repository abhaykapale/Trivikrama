import { createHash } from "node:crypto";

export interface CreateDeterministicRuleAlertIdInput {
  readonly organizationId: string;
  readonly ruleId: string;
  readonly ruleStateVersion: string;
  readonly matchedEventIds: readonly string[];
}

/**
 * Creates an RFC 9562-compatible UUIDv8 from one logical rule-alert identity.
 * Length-prefixed parts avoid ambiguous concatenations such as ["ab", "c"]
 * versus ["a", "bc"]. Event order is intentionally irrelevant.
 */
export function createDeterministicRuleAlertId(
  input: CreateDeterministicRuleAlertIdInput,
): string {
  validate(input);
  const hash = createHash("sha256");
  append(hash, input.organizationId);
  append(hash, input.ruleId);
  append(hash, input.ruleStateVersion);

  for (const eventId of [...input.matchedEventIds].sort()) {
    append(hash, eventId);
  }

  const bytes = hash.digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

function append(hash: ReturnType<typeof createHash>, value: string): void {
  const bytes = Buffer.from(value, "utf8");
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(bytes.length);
  hash.update(length);
  hash.update(bytes);
}

function validate(input: CreateDeterministicRuleAlertIdInput): void {
  if (
    input.organizationId.trim().length === 0 ||
    input.ruleId.trim().length === 0 ||
    input.ruleStateVersion.trim().length === 0 ||
    input.matchedEventIds.length === 0 ||
    input.matchedEventIds.some((eventId) => eventId.trim().length === 0)
  ) {
    throw new Error("Deterministic alert identity parts must not be blank.");
  }
}
