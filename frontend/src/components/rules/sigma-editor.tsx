"use client";
import { useEffect, useState } from "react";
import Editor, { loader } from "@monaco-editor/react";
export default function SigmaEditor({ value, onChange, readOnly }: { readonly value: string; readonly onChange: (value: string) => void; readonly readOnly: boolean }) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => { let active = true; void import("monaco-editor").then((monaco) => { loader.config({ monaco }); if (active) setReady(true); }).catch(() => { if (active) setFailed(true); }); return () => { active = false; }; }, []);
  if (failed) return <p role="alert">The local YAML editor could not load. Reload this page.</p>;
  if (!ready) return <p aria-busy="true">Loading YAML editor…</p>;
  return <Editor height="540px" language="yaml" theme="vs-dark" value={value} onChange={(next) => onChange(next ?? "")} options={{ readOnly, minimap: { enabled: false }, fontSize: 12, lineNumbers: "on", tabSize: 2, automaticLayout: true, scrollBeyondLastLine: false }} />;
}
