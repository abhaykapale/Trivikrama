import { createHash, type Hash } from "node:crypto";

export interface CreateDeterministicAiAlertIdInput {
  readonly orgId: string;
  readonly eventId: string;
  readonly modelName: string;
  readonly modelVersion: string;
}

export function createDeterministicAiAlertId(
  input: CreateDeterministicAiAlertIdInput,
): string {
  const hash = createHash("sha256");
  append(hash, requireNonBlank(input.orgId, "orgId"));
  append(hash, "ai");
  append(hash, requireNonBlank(input.eventId, "eventId"));
  append(hash, requireNonBlank(input.modelName, "modelName"));
  append(hash, requireNonBlank(input.modelVersion, "modelVersion"));

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

function append(hash: Hash, value: string): void {
  const bytes = Buffer.from(value, "utf8");
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(bytes.length);
  hash.update(length);
  hash.update(bytes);
}

function requireNonBlank(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${fieldName} must not be blank.`);
  }
  return normalized;
}
