const COLLECTOR_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/u;
const UUID_V4_SOURCE =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const QUARANTINE_FILE_PATTERN = new RegExp(
  `^batch_(${UUID_V4_SOURCE})__collector_([A-Za-z0-9_-]+)__claim_(${UUID_V4_SOURCE})__([a-z0-9_]+)__(${UUID_V4_SOURCE})\\.json$`,
  "u",
);

export interface QuarantineFileIdentity {
  readonly collectorId: string;
  readonly batchId: string;
  readonly claimId: string;
  readonly reason: string;
}

export function parseQuarantineFileName(
  fileName: string,
): QuarantineFileIdentity | undefined {
  const match = QUARANTINE_FILE_PATTERN.exec(fileName);

  if (match === null) {
    return undefined;
  }

  const collectorId = decodeCollectorId(match[2]);

  if (collectorId === undefined) {
    return undefined;
  }

  return {
    batchId: match[1],
    collectorId,
    claimId: match[3],
    reason: match[4].toUpperCase(),
  };
}

function decodeCollectorId(encoded: string): string | undefined {
  try {
    const decoded = Buffer.from(encoded, "base64url").toString("utf8");
    const canonical = Buffer.from(decoded, "utf8").toString("base64url");

    return canonical === encoded && COLLECTOR_ID_PATTERN.test(decoded)
      ? decoded
      : undefined;
  } catch {
    return undefined;
  }
}
