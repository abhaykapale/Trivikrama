"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, FilePlus2, ShieldCheck, UserRoundCheck, X } from "lucide-react";
import toast from "react-hot-toast";
import { useAuth } from "@/hooks/use-auth";
import { useIncidentResource } from "@/hooks/use-incident-resource";
import { usePermission } from "@/hooks/use-permission";
import { addIncidentNote, assignIncident, resolveIncident, transitionIncidentStatus } from "@/services/api/incidents";
import { getActiveUsers } from "@/services/api/users";
import { ApiError } from "@/types/api";
import type { ManagedUserPage } from "@/types/auth";
import { INCIDENT_RESOLUTIONS, type IncidentDetail, type IncidentResolution, type IncidentStatus } from "@/types/incidents";
import { formatRole } from "@/utils/permissions";

type Dialog = "assign" | "note" | "resolve" | "close" | null;
const RESOLUTION_LABELS: Readonly<Record<IncidentResolution, { readonly label: string; readonly detail: string }>> = {
  tp_mitigated: { label: "True positive — mitigated", detail: "Confirmed threat; containment or remediation completed." },
  tp_accepted: { label: "True positive — accepted", detail: "Confirmed risk formally accepted without mitigation." },
  fp_rule_tuning: { label: "False positive — rule tuning", detail: "Detection rule requires adjustment." },
  fp_ai_noise: { label: "False positive — AI noise", detail: "Model signal was not operationally relevant." },
  fp_known: { label: "False positive — known activity", detail: "Expected or approved behavior." },
  duplicate: { label: "Duplicate incident", detail: "Evidence is already handled by another incident." },
  informational: { label: "Informational", detail: "No response action is required." },
};

export function IncidentResponseActions({ incident, onChanged }: { readonly incident: IncidentDetail; readonly onChanged: () => void }) {
  const { user } = useAuth();
  const canAssign = usePermission("incidents.assign");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [resolution, setResolution] = useState<IncidentResolution>("tp_mitigated");
  const [assignment, setAssignment] = useState<string | null>(incident.assignedTo);
  const [userSearch, setUserSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [userPage, setUserPage] = useState(1);
  const directory = useIncidentResource(dialog === "assign" && user?.role === "admin", `${debouncedSearch}:${userPage}`, (signal) => getActiveUsers(debouncedSearch, userPage, signal));

  useEffect(() => { const timer = window.setTimeout(() => { setDebouncedSearch(userSearch.trim()); setUserPage(1); }, 300); return () => window.clearTimeout(timer); }, [userSearch]);

  const open = (next: Exclude<Dialog, null>) => {
    setError(null); setNote(""); setResolution("tp_mitigated"); setAssignment(incident.assignedTo); setUserSearch(""); setUserPage(1); setDialog(next);
  };
  const close = () => { if (!pending) { setError(null); setDialog(null); } };
  const execute = async (operation: () => Promise<unknown>, message: string) => {
    if (pending) return;
    setPending(true); setError(null);
    try { await operation(); toast.success(message); setDialog(null); onChanged(); }
    catch (caught: unknown) { const messageText = caught instanceof ApiError ? caught.message : "The incident action could not be completed."; setError(messageText); toast.error(messageText); }
    finally { setPending(false); }
  };
  const changeStatus = (status: IncidentStatus, message: string) => void execute(() => transitionIncidentStatus(incident.id, status), message);

  return (
    <>
      <div className="incident-response-actions">
        {incident.status === "open" ? <button className="primary-button compact" type="button" disabled={pending} onClick={() => changeStatus("investigating", "Investigation started.")}><ShieldCheck size={14} />Start investigation</button> : null}
        {incident.status === "investigating" ? <><button className="primary-button compact" type="button" disabled={pending} onClick={() => open("resolve")}><CheckCircle2 size={14} />Resolve</button><button className="secondary-button" type="button" disabled={pending} onClick={() => changeStatus("open", "Incident returned to open.")}>Return to open</button></> : null}
        {incident.status === "resolved" ? <button className="secondary-button" type="button" disabled={pending} onClick={() => changeStatus("investigating", "Incident reopened for investigation.")}>Reopen investigation</button> : null}
        {(incident.status === "open" || incident.status === "resolved") ? <button className="secondary-button" type="button" disabled={pending} onClick={() => open("close")}>Close</button> : null}
        {canAssign ? <button className="secondary-button" type="button" disabled={pending} onClick={() => open("assign")}><UserRoundCheck size={14} />Assign</button> : null}
        <button className="secondary-button" type="button" disabled={pending} onClick={() => open("note")}><FilePlus2 size={14} />Add note</button>
      </div>

      {dialog === "note" ? <Modal title="Add investigation note" description="The note and immutable audit record are committed together." onClose={close}>
        <form onSubmit={(event) => { event.preventDefault(); const content = note.trim(); if (content) void execute(() => addIncidentNote(incident.id, content), "Investigation note added."); }}>
          <label className="response-field"><span>Note</span><textarea autoFocus value={note} maxLength={10_000} rows={7} onChange={(event) => setNote(event.target.value)} placeholder="Record evidence, decisions, or next steps…" required /></label>
          <CharacterCount value={note} maximum={10_000} />{error ? <MutationError message={error} /> : null}<ModalActions pending={pending} valid={note.trim().length > 0} onCancel={close} submitLabel="Add note" />
        </form>
      </Modal> : null}

      {dialog === "resolve" ? <Modal title="Resolve incident" description="Classify the outcome before completing the investigation." onClose={close}>
        <form onSubmit={(event) => { event.preventDefault(); const content = note.trim(); void execute(() => resolveIncident(incident.id, resolution, content || undefined), "Incident resolved."); }}>
          <label className="response-field"><span>Resolution</span><select value={resolution} onChange={(event) => setResolution(event.target.value as IncidentResolution)}>{INCIDENT_RESOLUTIONS.map((value) => <option value={value} key={value}>{RESOLUTION_LABELS[value].label}</option>)}</select><small>{RESOLUTION_LABELS[resolution].detail}</small></label>
          <label className="response-field"><span>Resolution note <em>Optional</em></span><textarea value={note} maxLength={10_000} rows={5} onChange={(event) => setNote(event.target.value)} placeholder="Summarize the investigation and response…" /></label>
          <CharacterCount value={note} maximum={10_000} />{error ? <MutationError message={error} /> : null}<ModalActions pending={pending} valid onCancel={close} submitLabel="Resolve incident" danger />
        </form>
      </Modal> : null}

      {dialog === "close" ? <Modal title="Close incident" description="Closing is terminal and cannot be reversed by the current workflow." onClose={close}>
        <div className="response-confirmation"><strong>Close “{incident.title}”?</strong><p>Use resolution when an investigated incident needs an outcome classification. Direct close is intended for open or already resolved records.</p></div>
        {error ? <MutationError message={error} /> : null}<div className="modal-actions"><button className="secondary-button" type="button" disabled={pending} onClick={close}>Cancel</button><button className="danger-button" type="button" disabled={pending} onClick={() => changeStatus("closed", "Incident closed.")}>{pending ? "Closing…" : "Close incident"}</button></div>
      </Modal> : null}

      {dialog === "assign" ? <Modal title="Assign incident" description={user?.role === "admin" ? "Select an active analyst in this organization." : "Assignment directory access is administrator-only. You can assign the incident to yourself or remove its assignment."} onClose={close}>
        <form onSubmit={(event) => { event.preventDefault(); void execute(() => assignIncident(incident.id, assignment), assignment ? "Incident assigned." : "Incident unassigned."); }}>
          <div className="assignment-quick-actions"><button type="button" className={assignment === null ? "active" : ""} onClick={() => setAssignment(null)}>Unassigned</button>{user ? <button type="button" className={assignment === user.id ? "active" : ""} onClick={() => setAssignment(user.id)}>Assign to me</button> : null}</div>
          {user?.role === "admin" ? <AdminDirectory resource={directory} search={userSearch} onSearch={setUserSearch} page={userPage} onPage={setUserPage} selected={assignment} onSelect={setAssignment} /> : null}
          {incident.assignedTo && assignment === incident.assignedTo ? <p className="current-assignment">Current assignment: <code>{incident.assignedTo}</code></p> : null}
          {error ? <MutationError message={error} /> : null}<ModalActions pending={pending} valid onCancel={close} submitLabel="Save assignment" />
        </form>
      </Modal> : null}
    </>
  );
}

type DirectoryResource = { readonly data: ManagedUserPage | null; readonly loading: boolean; readonly refreshing: boolean; readonly error: string | null; readonly refresh: () => void };
function AdminDirectory({ resource, search, onSearch, page, onPage, selected, onSelect }: { readonly resource: DirectoryResource; readonly search: string; readonly onSearch: (value: string) => void; readonly page: number; readonly onPage: (page: number) => void; readonly selected: string | null; readonly onSelect: (value: string) => void }) {
  return <div className="assignment-directory"><label className="response-field"><span>Search active users</span><input type="search" value={search} maxLength={255} onChange={(event) => onSearch(event.target.value)} placeholder="Name, username, or email" /></label>{resource.loading && !resource.data ? <p className="directory-message">Loading active users…</p> : resource.error && !resource.data ? <div className="directory-message error"><span>{resource.error}</span><button type="button" onClick={resource.refresh}>Retry</button></div> : <div className="assignment-user-list">{resource.data?.data.length ? resource.data.data.map((candidate) => <label className={selected === candidate.id ? "selected" : ""} key={candidate.id}><input type="radio" name="assignee" checked={selected === candidate.id} onChange={() => onSelect(candidate.id)} /><span><strong>{candidate.displayName ?? candidate.username}</strong><small>@{candidate.username} · {formatRole(candidate.role)}</small></span></label>) : <p className="directory-message">No active users match this search.</p>}</div>}{resource.data && resource.data.pagination.totalPages > 1 ? <div className="directory-pagination"><button type="button" disabled={!resource.data.pagination.hasPrev} onClick={() => onPage(page - 1)}><ChevronLeft size={13} /></button><span>Page {resource.data.pagination.page} of {resource.data.pagination.totalPages}</span><button type="button" disabled={!resource.data.pagination.hasNext} onClick={() => onPage(page + 1)}><ChevronRight size={13} /></button></div> : null}</div>;
}

function Modal({ title, description, onClose, children }: { readonly title: string; readonly description: string; readonly onClose: () => void; readonly children: ReactNode }) {
  useEffect(() => { const listener = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; document.addEventListener("keydown", listener); return () => document.removeEventListener("keydown", listener); }, [onClose]);
  return <div className="response-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section className="response-modal" role="dialog" aria-modal="true" aria-labelledby="response-modal-title"><header><div><h2 id="response-modal-title">{title}</h2><p>{description}</p></div><button type="button" onClick={onClose} aria-label="Close dialog"><X size={15} /></button></header><div className="response-modal-content">{children}</div></section></div>;
}

function ModalActions({ pending, valid, onCancel, submitLabel, danger = false }: { readonly pending: boolean; readonly valid: boolean; readonly onCancel: () => void; readonly submitLabel: string; readonly danger?: boolean }) { return <div className="modal-actions"><button className="secondary-button" type="button" disabled={pending} onClick={onCancel}>Cancel</button><button className={danger ? "danger-button" : "primary-button compact"} type="submit" disabled={pending || !valid}>{pending ? "Saving…" : submitLabel}</button></div>; }
function CharacterCount({ value, maximum }: { readonly value: string; readonly maximum: number }) { return <div className="character-count">{value.length.toLocaleString()} / {maximum.toLocaleString()}</div>; }
function MutationError({ message }: { readonly message: string }) { return <div className="mutation-error" role="alert">{message}</div>; }
