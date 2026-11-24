"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRef, useState } from "react";
import { ApiError } from "@/types/api";
import { createRule, testRule, validateRule } from "@/services/api/rule-commands";
import { yamlByteLength } from "@/services/api/rule-command-schemas";
import { usePermission } from "@/hooks/use-permission";
const SigmaEditor = dynamic(() => import("./sigma-editor"), { ssr: false, loading: () => <p>Loading YAML editor…</p> });
export function RuleAuthoring() {
  const [source, setSource] = useState("");
  const [validatedSource, setValidatedSource] = useState<string | null>(null);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof validateRule>> | null>(null);
  const [created, setCreated] = useState<Awaited<ReturnType<typeof createRule>> | null>(null);
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const bytes = yamlByteLength(source);
  async function submit(activate: boolean) {
    if (lock.current || !source.trim() || bytes > 51200) return;
    if (activate && !window.confirm("Create and activate this rule? It can immediately generate live alerts.")) return;
    lock.current = true; setPending(true); setError(null);
    try { if (activate) setCreated(await createRule(source)); else { setPreview(await validateRule(source)); setValidatedSource(source); } }
    catch (error: unknown) { setError(commandError(error)); }
    finally { lock.current = false; setPending(false); }
  }
  if (created) return <section className="investigation-page"><header className="incident-queue-heading"><div><h1>Rule created and active</h1><p>{created.name} · version {created.version}</p></div><Link className="secondary-button" href={`/rules/${created.id}`}>Open rule</Link></header>{!created.reloadSignaled ? <p className="mutation-error">The rule was saved, but the live reload signal failed. Verify worker rule reload before relying on this detection. Do not submit it again.</p> : null}<RuleTest id={created.id} /></section>;
  return <section className="investigation-page"><Link className="detail-back-link" href="/rules">← Detection rules</Link><header className="incident-queue-heading"><div><span className="eyebrow">Detection engineering</span><h1>Create Sigma rule</h1><p>Validate with the server compiler before creating an active detection.</p></div></header><section className="enterprise-panel"><div className="panel-header"><h2>YAML source</h2><span className="panel-meta">{bytes.toLocaleString()} / 51,200 UTF-8 bytes</span></div><SigmaEditor value={source} onChange={(value) => { setSource(value); setPreview(null); setValidatedSource(null); }} readOnly={pending} /><div className="rule-info"><p>Supports the current match and count compiler. Sequence rules are not supported. Validation does not save or activate a rule.</p>{bytes > 51200 ? <p role="alert">Source exceeds the 50 KiB limit.</p> : null}{error ? <pre className="mutation-error" role="alert">{error}</pre> : null}{preview ? <div role="status"><strong>Compiler validation passed</strong><p>{preview.name} · {preview.type} · {preview.severity}</p><code>{preview.compiledHash}</code></div> : null}<div className="modal-actions"><button className="secondary-button" type="button" disabled={pending || !source.trim() || bytes > 51200} onClick={() => void submit(false)}>Validate YAML</button><button className="primary-button compact" type="button" disabled={pending || validatedSource !== source || !preview} onClick={() => void submit(true)}>{pending ? "Processing…" : "Create and activate"}</button></div></div></section></section>;
}
export function RuleTest({ id }: { readonly id: string }) {
  const allowed = usePermission("rules.test");
  const [range, setRange] = useState("24h"); const [limit, setLimit] = useState(1000);
  const [result, setResult] = useState<Awaited<ReturnType<typeof testRule>> | null>(null);
  const [pending, setPending] = useState(false); const lock = useRef(false); const [error, setError] = useState<string | null>(null);
  if (!allowed) return null;
  async function run() { if (lock.current) return; lock.current = true; setPending(true); setError(null); setResult(null); try { setResult(await testRule(id, range, limit)); } catch (error: unknown) { setError(commandError(error)); } finally { setPending(false); lock.current = false; } }
  return <section className="enterprise-panel"><div className="panel-header"><div><h2>Test persisted rule</h2><p>Isolated dry run · no alerts, incidents, cooldowns, or rule-state writes</p></div></div><div className="rule-info"><div className="event-filter-actions"><label className="response-field"><span>Time range</span><select disabled={pending} value={range} onChange={(e) => { setRange(e.target.value); setResult(null); }}>{["1h", "4h", "24h", "7d", "30d"].map((value) => <option key={value}>{value}</option>)}</select></label><label className="response-field"><span>Maximum events</span><select value={limit} disabled={pending} onChange={(e) => { setLimit(Number(e.target.value)); setResult(null); }}>{[100, 500, 1000].map((value) => <option key={value}>{value}</option>)}</select></label><button type="button" className="secondary-button" disabled={pending} onClick={() => void run()}>{pending ? "Testing…" : "Run test"}</button></div>{error ? <pre className="mutation-error" role="alert">{error}</pre> : null}{result ? <div role="status"><p><strong>{result.matches}</strong> matches · {result.totalEvaluated} evaluated · {result.executionTimeMs.toFixed(2)} ms</p><p>Bounded sample, not a complete historical scan. Up to 10 matching events shown.</p><div className="table-scroll"><table className="data-table"><thead><tr><th>Event</th><th>Message</th><th>Condition</th></tr></thead><tbody>{result.sampleMatches.map((sample) => <tr key={sample.eventId}><td><Link href={`/investigate?eventId=${encodeURIComponent(sample.eventId)}`}>{sample.eventId}</Link></td><td>{sample.message}</td><td>{sample.matchedCondition}</td></tr>)}</tbody></table></div></div> : null}</div></section>;
}
function commandError(error: unknown): string { if (!(error instanceof ApiError)) return "The rule request could not be completed."; const issues = error.details?.issues; return `${error.message}${Array.isArray(issues) ? "\n" + issues.map((issue: unknown) => { if (!issue || typeof issue !== "object") return ""; const value = issue as Record<string, unknown>; return `${String(value.path ?? "source")}: ${String(value.message ?? "Invalid value")}`; }).join("\n") : ""}`; }
