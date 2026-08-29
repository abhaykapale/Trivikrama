"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { TextDecoder } = require("node:util");

const ROOT = path.resolve(__dirname, "..");
const PREFIX = Buffer.from("TRIVIKRAMA-COLLECTOR-CONTRACT-V1\n", "utf8");
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

class ContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ContractError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new ContractError(code, message);
}

function readBuffer(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath));
}

function decodeUtf8Strict(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    fail("json_bom", "UTF-8 BOM is forbidden");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    fail("invalid_utf8", "Input is not valid UTF-8");
  }
}

function assertNoLoneSurrogates(value) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        fail("invalid_unicode", "Lone high surrogate is forbidden");
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      fail("invalid_unicode", "Lone low surrogate is forbidden");
    }
  }
}

function strictParseBuffer(buffer) {
  const text = decodeUtf8Strict(buffer);
  let index = 0;

  function whitespace() {
    while (index < text.length && /[\u0009\u000a\u000d\u0020]/.test(text[index])) index += 1;
  }

  function parseString() {
    const start = index;
    index += 1;
    let escaped = false;
    while (index < text.length) {
      const code = text.charCodeAt(index);
      if (!escaped && code === 0x22) {
        index += 1;
        const value = JSON.parse(text.slice(start, index));
        assertNoLoneSurrogates(value);
        return value;
      }
      if (!escaped && code < 0x20) fail("invalid_json", "Unescaped control character in string");
      if (!escaped && code === 0x5c) escaped = true;
      else escaped = false;
      index += 1;
    }
    fail("invalid_json", "Unterminated JSON string");
  }

  function parseNumber() {
    const remaining = text.slice(index);
    const match = remaining.match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
    if (!match) fail("invalid_json", "Invalid JSON number");
    index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) fail("invalid_number", "Non-finite number is forbidden");
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      fail("unsafe_integer", "Integer is outside the interoperable safe range");
    }
    return value;
  }

  function literal(token, value) {
    if (text.slice(index, index + token.length) !== token) fail("invalid_json", `Expected ${token}`);
    index += token.length;
    return value;
  }

  function parseArray() {
    const result = [];
    index += 1;
    whitespace();
    if (text[index] === "]") {
      index += 1;
      return result;
    }
    while (true) {
      result.push(parseValue());
      whitespace();
      if (text[index] === "]") {
        index += 1;
        return result;
      }
      if (text[index] !== ",") fail("invalid_json", "Expected comma in array");
      index += 1;
      whitespace();
    }
  }

  function parseObject() {
    const result = {};
    const keys = new Set();
    index += 1;
    whitespace();
    if (text[index] === "}") {
      index += 1;
      return result;
    }
    while (true) {
      if (text[index] !== "\"") fail("invalid_json", "Object key must be a string");
      const key = parseString();
      if (keys.has(key)) fail("duplicate_json_key", `Duplicate object key: ${key}`);
      keys.add(key);
      whitespace();
      if (text[index] !== ":") fail("invalid_json", "Expected colon after object key");
      index += 1;
      result[key] = parseValue();
      whitespace();
      if (text[index] === "}") {
        index += 1;
        return result;
      }
      if (text[index] !== ",") fail("invalid_json", "Expected comma in object");
      index += 1;
      whitespace();
    }
  }

  function parseValue() {
    whitespace();
    const char = text[index];
    if (char === "{") return parseObject();
    if (char === "[") return parseArray();
    if (char === "\"") return parseString();
    if (char === "t") return literal("true", true);
    if (char === "f") return literal("false", false);
    if (char === "n") return literal("null", null);
    if (char === "-" || /[0-9]/.test(char || "")) return parseNumber();
    fail("invalid_json", `Unexpected JSON token at offset ${index}`);
  }

  const result = parseValue();
  whitespace();
  if (index !== text.length) fail("invalid_json", "Trailing content after JSON document");
  return result;
}

function parseFile(relativePath) {
  return strictParseBuffer(readBuffer(relativePath));
}

function canonicalize(value) {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") {
    assertNoLoneSurrogates(value);
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("invalid_number", "JCS forbids non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${canonicalize(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  fail("unsupported_json_type", `Unsupported value type: ${typeof value}`);
}

function unsignedDocument(document) {
  const copy = structuredClone(document);
  if (!copy.integrity || typeof copy.integrity !== "object") fail("missing_integrity", "integrity is required");
  delete copy.integrity.value;
  return copy;
}

function decodeSecret(secret) {
  if (!/^[A-Za-z0-9_-]{64}$/.test(secret)) fail("invalid_secret", "Test secret shape is invalid");
  const key = Buffer.from(secret, "base64url");
  if (key.length !== 48 || key.toString("base64url") !== secret) fail("invalid_secret", "Secret must decode canonically to 48 bytes");
  return key;
}

function calculateMac(document, secret) {
  const canonical = Buffer.from(canonicalize(unsignedDocument(document)), "utf8");
  return crypto.createHmac("sha256", decodeSecret(secret)).update(PREFIX).update(canonical).digest();
}

function verifyIntegrity(document, keyFixture) {
  if (document.integrity?.algorithm !== "HMAC-SHA256") fail("unsupported_integrity_algorithm", "Unsupported integrity algorithm");
  if (document.integrity?.key_id !== keyFixture.key_id) fail("unknown_key_id", "Unknown key_id");
  if (!/^[A-Za-z0-9_-]{43}$/.test(document.integrity?.value || "")) fail("malformed_hmac", "Malformed HMAC");
  const actual = Buffer.from(document.integrity.value, "base64url");
  const expected = calculateMac(document, keyFixture.secret_base64url);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) fail("invalid_hmac", "HMAC verification failed");
}

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function eventIdentity(sourceId, fileIdentity, startOffset) {
  return sha256(Buffer.from(`${sourceId}\n${fileIdentity}\n${startOffset}`, "utf8"));
}

function requireCondition(condition, code, message) {
  if (!condition) fail(code, message);
}

let schemaStore = null;

function schemaTypeMatches(value, expected) {
  if (expected === "null") return value === null;
  if (expected === "array") return Array.isArray(value);
  if (expected === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (expected === "integer") return Number.isSafeInteger(value);
  if (expected === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === expected;
}

function resolvePointer(root, pointer) {
  if (!pointer || pointer === "#") return root;
  requireCondition(pointer.startsWith("#/"), "schema_error", `Unsupported JSON pointer: ${pointer}`);
  return pointer.slice(2).split("/").reduce((value, token) => value[token.replace(/~1/g, "/").replace(/~0/g, "~")], root);
}

function validateSchemaValue(value, schema, currentRoot, location = "$") {
  if (schema.$ref) {
    const [file, fragment = ""] = schema.$ref.split("#");
    const targetRoot = file ? schemaStore[file] : currentRoot;
    requireCondition(targetRoot, "schema_error", `Unknown schema reference ${schema.$ref}`);
    return validateSchemaValue(value, resolvePointer(targetRoot, fragment ? `#${fragment}` : "#"), targetRoot, location);
  }
  if (Object.hasOwn(schema, "const")) requireCondition(Object.is(value, schema.const), "schema_validation", `${location} must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum) requireCondition(schema.enum.some((item) => Object.is(item, value)), "schema_validation", `${location} is not in enum`);
  if (schema.type) {
    const expected = Array.isArray(schema.type) ? schema.type : [schema.type];
    requireCondition(expected.some((type) => schemaTypeMatches(value, type)), "schema_validation", `${location} has invalid type`);
  }
  if (schema.oneOf) {
    let matches = 0;
    for (const choice of schema.oneOf) {
      try {
        validateSchemaValue(value, choice, currentRoot, location);
        matches += 1;
      } catch (error) {
        if (!(error instanceof ContractError) || error.code === "schema_error") throw error;
      }
    }
    requireCondition(matches === 1, "schema_validation", `${location} must match exactly one schema`);
  }
  if (schema.allOf) for (const constraint of schema.allOf) validateSchemaValue(value, constraint, currentRoot, location);
  if (schema.if) {
    let conditionMatches = true;
    try {
      validateSchemaValue(value, schema.if, currentRoot, location);
    } catch (error) {
      if (!(error instanceof ContractError) || error.code === "schema_error") throw error;
      conditionMatches = false;
    }
    if (conditionMatches && schema.then) validateSchemaValue(value, schema.then, currentRoot, location);
    if (!conditionMatches && schema.else) validateSchemaValue(value, schema.else, currentRoot, location);
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined) requireCondition([...value].length >= schema.minLength, "schema_validation", `${location} is too short`);
    if (schema.maxLength !== undefined) requireCondition([...value].length <= schema.maxLength, "schema_validation", `${location} is too long`);
    if (schema.pattern) requireCondition(new RegExp(schema.pattern, "u").test(value), "schema_validation", `${location} does not match pattern`);
    if (schema.format === "date-time") requireCondition(Number.isFinite(Date.parse(value)), "schema_validation", `${location} is not date-time`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined) requireCondition(value >= schema.minimum, "schema_validation", `${location} is below minimum`);
    if (schema.maximum !== undefined) requireCondition(value <= schema.maximum, "schema_validation", `${location} is above maximum`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined) requireCondition(value.length >= schema.minItems, "schema_validation", `${location} has too few items`);
    if (schema.maxItems !== undefined) requireCondition(value.length <= schema.maxItems, "schema_validation", `${location} has too many items`);
    if (schema.items) value.forEach((item, index) => validateSchemaValue(item, schema.items, currentRoot, `${location}[${index}]`));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    if (schema.required) for (const key of schema.required) requireCondition(Object.hasOwn(value, key), "schema_validation", `${location}.${key} is required`);
    if (schema.properties) {
      for (const [key, child] of Object.entries(schema.properties)) {
        if (Object.hasOwn(value, key)) validateSchemaValue(value[key], child, currentRoot, `${location}.${key}`);
      }
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties || {}));
      for (const key of Object.keys(value)) requireCondition(allowed.has(key), "schema_validation", `${location}.${key} is not allowed`);
    }
  }
}

function assertMatchesSchema(document, schemaFile) {
  validateSchemaValue(document, schemaStore[schemaFile], schemaStore[schemaFile]);
}

function validateBatch(document, keyFixture, rawFileBytes) {
  verifyIntegrity(document, keyFixture);
  requireCondition(document.contract_version === "1.0.0", "unsupported_contract_version", "Unsupported contract version");
  requireCondition(document.message_type === "event_batch", "invalid_message_type", "Expected event_batch");
  requireCondition(Array.isArray(document.events) && document.events.length > 0 && document.events.length <= 1000, "invalid_events", "Invalid events array");
  requireCondition(document.event_count === document.events.length, "event_count_mismatch", "event_count must equal events.length");
  requireCondition(rawFileBytes.length <= 8 * 1024 * 1024, "batch_too_large", "Signed batch exceeds 8 MiB");
  const ids = new Set();
  for (const event of document.events) {
    requireCondition(!ids.has(event.event_id), "duplicate_event_id", "Duplicate event_id within batch");
    ids.add(event.event_id);
    const position = event.source?.position;
    requireCondition(position && Number.isSafeInteger(position.record_start_offset) && position.record_end_offset > position.record_start_offset, "invalid_source_position", "Invalid file position");
    requireCondition(Buffer.byteLength(event.raw_payload || "", "utf8") <= 512 * 1024, "record_too_large", "raw_payload exceeds 512 KiB");
    const expectedId = eventIdentity(event.source.source_id, position.file_identity, position.record_start_offset);
    requireCondition(event.event_id === expectedId, "event_identity_mismatch", "event_id is not stable identity for source position");
    const source = strictParseBuffer(Buffer.from(event.raw_payload, "utf8"));
    requireCondition(["login_success", "login_failed"].includes(source.event_type), "unsupported_event_type", "Unsupported event type");
    requireCondition(net.isIP(source.source_ip) !== 0, "invalid_ip_address", "Invalid source IP");
    requireCondition(typeof source.endpoint_id === "string" && source.endpoint_id.length > 0 && source.endpoint_id.length <= 253, "invalid_field", "Invalid endpoint_id");
    requireCondition(typeof source.username === "string" && source.username.length > 0 && source.username.length <= 256, "invalid_field", "Invalid username");
    const eventMillis = Date.parse(source.timestamp);
    requireCondition(Number.isFinite(eventMillis) && new Date(eventMillis).toISOString() === source.timestamp, "invalid_timestamp", "Timestamp must be UTC with milliseconds");
    requireCondition(Date.parse(event.event_time) === eventMillis && Number.isFinite(Date.parse(event.received_time)), "timestamp_mismatch", "Envelope time mismatch");
    const expectedStatus = source.event_type === "login_success" ? 1 : 2;
    const expectedSeverity = source.event_type === "login_success" ? 1 : 3;
    const ocsf = event.ocsf || {};
    requireCondition(ocsf.category_uid === 3 && ocsf.class_uid === 3002 && ocsf.activity_id === 1 && ocsf.type_uid === 300201, "ocsf_mapping_mismatch", "OCSF identity mismatch");
    requireCondition(ocsf.status_id === expectedStatus && ocsf.severity_id === expectedSeverity, "ocsf_mapping_mismatch", "OCSF outcome mismatch");
    requireCondition(ocsf.time === eventMillis, "ocsf_mapping_mismatch", "OCSF time mismatch");
    requireCondition(ocsf.user?.name === source.username && ocsf.src_endpoint?.ip === source.source_ip && ocsf.dst_endpoint?.hostname === source.endpoint_id, "ocsf_mapping_mismatch", "OCSF source-field mismatch");
    requireCondition(event.source.original_endpoint_id === source.endpoint_id, "source_identity_mismatch", "Original endpoint mismatch");
    requireCondition(event.mapping?.name === "trivikrama.simulated-auth" && event.mapping?.version === "1.0.0", "mapping_version_mismatch", "Unsupported mapping");
    requireCondition(ocsf.metadata?.version === "1.1.0", "ocsf_version_mismatch", "Unsupported OCSF version");
  }
}

function validateHeartbeat(document, keyFixture) {
  verifyIntegrity(document, keyFixture);
  requireCondition(document.contract_version === "1.0.0" && document.message_type === "heartbeat", "invalid_heartbeat", "Invalid heartbeat envelope");
  requireCondition(["online", "degraded", "shutting_down"].includes(document.status), "invalid_heartbeat_status", "Invalid heartbeat status");
  requireCondition(Number.isSafeInteger(document.sequence) && document.sequence >= 0, "invalid_heartbeat_sequence", "Invalid heartbeat sequence");
  requireCondition(Date.parse(document.started_at) <= Date.parse(document.timestamp), "invalid_heartbeat_time", "Heartbeat started_at is after timestamp");
  for (const [name, value] of Object.entries(document.metrics || {})) {
    if (name === "last_batch_id") continue;
    requireCondition(typeof value === "number" && Number.isFinite(value) && value >= 0, "invalid_heartbeat_metric", `Invalid metric ${name}`);
  }
}

function validateRejectedEvent(document, keyFixture) {
  verifyIntegrity(document, keyFixture);
  requireCondition(document.contract_version === "1.0.0" && document.message_type === "rejected_event", "invalid_rejection", "Invalid rejection envelope");
  requireCondition(document.source.record_end_offset > document.source.record_start_offset, "invalid_source_position", "Invalid rejected-event position");
  const capture = Buffer.from(document.payload.capture, "base64");
  requireCondition(capture.length <= 65536, "capture_too_large", "Rejected capture exceeds 64 KiB");
  requireCondition(document.payload.capture === capture.toString("base64"), "invalid_capture_encoding", "Capture is not canonical base64");
  if (!document.payload.capture_truncated) {
    requireCondition(capture.length === document.payload.byte_length, "capture_length_mismatch", "Complete capture length mismatch");
    requireCondition(sha256(capture) === document.payload.sha256, "capture_digest_mismatch", "Capture digest mismatch");
  } else {
    requireCondition(capture.length === 65536 && document.payload.byte_length > capture.length, "capture_truncation_mismatch", "Invalid truncated capture");
  }
}

function classification(existingId, existingDigest, incomingId, incomingDigest) {
  if (existingId !== incomingId) return "new";
  return existingDigest === incomingDigest ? "idempotent_success" : "terminal_integrity_failure";
}

function capacityState({ pendingBytesRatio, pendingBatchRatio, freeBytes, reserveBytes, wasPaused }) {
  const utilization = Math.max(pendingBytesRatio, pendingBatchRatio);
  const hardLimit = utilization >= 1 || freeBytes <= reserveBytes;
  if (hardLimit) return "paused";
  if (wasPaused && utilization >= 0.8) return "paused";
  if (utilization >= 0.95) return "paused";
  if (utilization >= 0.8) return "degraded";
  return "normal";
}

function expectContractError(code, operation) {
  try {
    operation();
  } catch (error) {
    assert.equal(error instanceof ContractError, true, `Expected ContractError, received ${error.stack || error}`);
    assert.equal(error.code, code);
    return;
  }
  assert.fail(`Expected contract error ${code}`);
}

function verifySchemas() {
  const schemaFiles = ["common.schema.json", "event-batch.schema.json", "heartbeat.schema.json", "rejected-event.schema.json"];
  schemaStore = {};
  for (const file of schemaFiles) {
    const schema = parseFile(`schemas/${file}`);
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
    assert.match(schema.$id, /^urn:trivikrama:collector-ingress:1\.0\.0:/);
    schemaStore[file] = schema;
  }
}

function verifyJcsReferenceVector() {
  const input = {
    numbers: [333333333.33333329, 1e30, 4.50, 2e-3, 1e-27],
    string: "€$\u000f\nA'B\"\\\\\"/",
    literals: [null, true, false]
  };
  const expected = "{\"literals\":[null,true,false],\"numbers\":[333333333.3333333,1e+30,4.5,0.002,1e-27],\"string\":\"€$\\u000f\\nA'B\\\"\\\\\\\\\\\"/\"}";
  assert.equal(canonicalize(input), expected);
  const sortInput = { "€": "Euro", "\r": "CR", "דּ": "Hebrew", "1": "One", "😀": "Emoji", "\u0080": "Control", "ö": "Latin" };
  const sorted = canonicalize(sortInput);
  const expectedOrder = ["\\r", "1", "\u0080", "ö", "€", "😀", "דּ"];
  let previous = -1;
  for (const key of expectedOrder) {
    const current = sorted.indexOf(`\"${key}\"`);
    assert.ok(current > previous, `JCS property order failed for ${JSON.stringify(key)}`);
    previous = current;
  }
}

function main() {
  verifySchemas();
  verifyJcsReferenceVector();

  const keyFixture = parseFile("fixtures/test-key.json");
  const batchPath = "fixtures/positive/event-batch.json";
  const heartbeatPath = "fixtures/positive/heartbeat.json";
  const rejectionPath = "fixtures/positive/rejected-event.json";
  const batch = parseFile(batchPath);
  const heartbeat = parseFile(heartbeatPath);
  const rejection = parseFile(rejectionPath);

  assertMatchesSchema(batch, "event-batch.schema.json");
  assertMatchesSchema(heartbeat, "heartbeat.schema.json");
  assertMatchesSchema(rejection, "rejected-event.schema.json");
  validateBatch(batch, keyFixture, readBuffer(batchPath));
  validateHeartbeat(heartbeat, keyFixture);
  validateRejectedEvent(rejection, keyFixture);

  const vectors = parseFile("fixtures/signing-vectors.json");
  for (const vector of vectors.vectors) {
    const document = parseFile(vector.fixture);
    const canonical = Buffer.from(canonicalize(unsignedDocument(document)), "utf8");
    assert.equal(canonical.toString("base64"), vector.canonical_unsigned_base64, `${vector.name}: canonical bytes`);
    assert.equal(sha256(canonical), vector.canonical_unsigned_sha256, `${vector.name}: canonical digest`);
    assert.equal(calculateMac(document, keyFixture.secret_base64url).toString("base64url"), vector.expected_hmac_base64url, `${vector.name}: HMAC`);
  }

  const mappingVectors = parseFile("fixtures/mapping-vectors.json");
  for (const vector of mappingVectors.vectors) {
    const source = strictParseBuffer(Buffer.from(vector.raw_payload, "utf8"));
    assert.equal(eventIdentity(vector.source_id, vector.file_identity, vector.record_start_offset), vector.expected_event_id, `${vector.name}: event identity`);
    assert.equal(Date.parse(source.timestamp), vector.expected_ocsf.time, `${vector.name}: OCSF time`);
    assert.equal(source.endpoint_id, vector.expected_ocsf.dst_endpoint.hostname, `${vector.name}: endpoint mapping`);
    assert.equal(source.username, vector.expected_ocsf.user.name, `${vector.name}: user mapping`);
    assert.equal(source.source_ip, vector.expected_ocsf.src_endpoint.ip, `${vector.name}: IP mapping`);
    const mappedKeys = new Set(["endpoint_id", "timestamp", "event_type", "username", "source_ip"]);
    const expectedUnmapped = Object.fromEntries(Object.entries(source).filter(([key]) => !mappedKeys.has(key)));
    assert.deepEqual(vector.expected_ocsf.unmapped, expectedUnmapped, `${vector.name}: unmapped preservation`);
  }

  const negative = parseFile("fixtures/negative/manifest.json");
  const validators = { event_batch: validateBatch, heartbeat: validateHeartbeat, rejected_event: validateRejectedEvent };
  for (const testCase of negative.cases) {
    expectContractError(testCase.expected_code, () => {
      const bytes = readBuffer(testCase.fixture);
      const document = strictParseBuffer(bytes);
      validators[testCase.validator](document, keyFixture, bytes);
    });
  }

  const digestA = sha256(Buffer.from("content-a"));
  const digestB = sha256(Buffer.from("content-b"));
  assert.equal(classification("same", digestA, "same", digestA), "idempotent_success");
  assert.equal(classification("same", digestA, "same", digestB), "terminal_integrity_failure");
  assert.equal(classification("first", digestA, "second", digestB), "new");

  const reserveBytes = 256 * 1024 * 1024;
  assert.equal(capacityState({ pendingBytesRatio: 0.79, pendingBatchRatio: 0.2, freeBytes: reserveBytes + 1, reserveBytes, wasPaused: false }), "normal");
  assert.equal(capacityState({ pendingBytesRatio: 0.8, pendingBatchRatio: 0.2, freeBytes: reserveBytes + 1, reserveBytes, wasPaused: false }), "degraded");
  assert.equal(capacityState({ pendingBytesRatio: 0.2, pendingBatchRatio: 0.95, freeBytes: reserveBytes + 1, reserveBytes, wasPaused: false }), "paused");
  assert.equal(capacityState({ pendingBytesRatio: 0.85, pendingBatchRatio: 0.2, freeBytes: reserveBytes + 1, reserveBytes, wasPaused: true }), "paused");
  assert.equal(capacityState({ pendingBytesRatio: 0.79, pendingBatchRatio: 0.2, freeBytes: reserveBytes + 1, reserveBytes, wasPaused: true }), "normal");
  assert.equal(capacityState({ pendingBytesRatio: 0.1, pendingBatchRatio: 0.1, freeBytes: reserveBytes, reserveBytes, wasPaused: false }), "paused");

  console.log("ARCH-01 contract verification passed");
}

main();
