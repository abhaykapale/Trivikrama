import type { SystemProofReport } from "../domain/system-proof.contracts.js";

export function formatSystemProof(report: SystemProofReport): string {
  const lines = [
    "TRIVIKRAMA END-TO-END SIEM PROOF",
    "================================",
    `Generated: ${report.generatedAt}`,
    `Event ID:  ${report.eventId ?? "not available"}`,
    `Selection: ${report.eventSelection}`,
    "",
  ];

  for (const stage of report.stages) {
    lines.push(`${stage.status.padEnd(4)}  ${stage.label}`);
    lines.push(`      ${stage.summary}`);
  }

  const incident = asObject(report.evidence.incident);
  const ai = asObject(report.evidence.aiResult);
  const timing = asObject(report.evidence.timing);
  lines.push("");
  lines.push("RESULT SUMMARY");
  lines.push("--------------");
  if (incident !== null) {
    lines.push(`Incident ID:        ${stringValue(incident.id)}`);
    lines.push(`Severity:           ${stringValue(incident.severity)}`);
    lines.push(`Risk score:         ${stringValue(incident.riskScore)}`);
    lines.push(`Detection source:   ${stringValue(incident.source)}`);
  }
  if (ai !== null) {
    lines.push(`AI model:           ${stringValue(ai.modelVersion)}`);
    lines.push(`AI anomaly score:   ${stringValue(ai.anomalyScore)}`);
    lines.push(`SHAP features:      ${stringValue(ai.shapFeatureCount)}`);
  }
  if (timing !== null && timing.storedPipelineDurationMs !== null && timing.storedPipelineDurationMs !== undefined) {
    lines.push(`Pipeline duration:  ${stringValue(timing.storedPipelineDurationMs)} ms`);
  }
  lines.push("");
  lines.push(`OVERALL RESULT: ${report.passed ? "PASS" : "FAIL"}`);
  return `${lines.join("\n")}\n`;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string {
  return value === null || value === undefined ? "not available" : String(value);
}
