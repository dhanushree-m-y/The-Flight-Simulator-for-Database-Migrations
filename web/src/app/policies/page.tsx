"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { TopBar } from "@/components/shell/AppShell";
import { useShell } from "@/components/shell/ShellContext";
import { api, useApi } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import type { Policy, PolicyViolation, RehearsalSummary } from "@/lib/types";
import { EmptyState, FailState, LoadState, PageHead, PermissionNote, errMsg, isAdmin } from "@/components/admin/kit";

type Params = Policy["params"];

const SevChip = ({ s }: { s: Policy["severity"] }) =>
  s === "block" ? <span className="st st-block">✕ block</span> : s === "review" ? <span className="st st-review">△ review</span> : <span className="st st-info">◇ info</span>;

const label = (k: string) => {
  const s = k.replace(/_/g, " ").replace(/\bms\b/, "(ms)").replace(/\bpct\b/, "(%)");
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const same = (a: Params, b: Params) => Object.keys({ ...a, ...b }).every((k) => a[k] === b[k]);

export default function PoliciesPage() {
  const { me } = useShell();
  const { data, error, loading, reload, setData } = useApi<Policy[]>("/api/policies");
  const [selId, setSelId] = useState<string | null>(null);
  const [fired, setFired] = useState<PolicyViolation[] | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const admin = isAdmin(me);

  const list = useMemo(() => {
    const rank = { block: 0, review: 1, info: 2 };
    return [...(data ?? [])].sort((a, b) => Number(b.enabled) - Number(a.enabled) || rank[a.severity] - rank[b.severity] || a.title.localeCompare(b.title));
  }, [data]);
  const sel = list.find((p) => p.id === selId) ?? list[0] ?? null;
  const active = list.filter((p) => p.enabled).length;
  const firedIds = new Set((fired ?? []).map((v) => v.policy_id));
  const replace = (p: Policy) => setData((l) => (l ? l.map((x) => (x.id === p.id ? p : x)) : l));

  async function quickToggle(p: Policy) {
    if (!admin) return;
    setToggling(p.id);
    replace({ ...p, enabled: !p.enabled }); // optimistic
    try {
      const saved = await api<Policy>(`/api/policies/${p.id}`, { method: "PUT", json: { enabled: !p.enabled, params: p.params } });
      replace(saved);
      toast(`${saved.title} · ${saved.enabled ? "enabled" : "disabled"}`);
    } catch (e) {
      replace(p);
      toast.error(`Couldn’t update “${p.title}”: ${errMsg(e)}`);
    } finally {
      setToggling(null);
    }
  }

  return (
    <div className="pg-policies page">
      <TopBar crumbs={["Policies"]} />
      <PageHead
        eyebrow={data ? `Safety policies · ${active} active of ${list.length} · checked at rehearsal and again at approval` : "Safety policies · checked at rehearsal and again at approval"}
        title="The rules your team agreed on, enforced every time."
      />
      {me && !admin && <PermissionNote>You’re signed in as {me.role}. Everyone can read and simulate policies; only an admin can change them. Changes are audited.</PermissionNote>}

      {loading && !data ? (
        <LoadState title="Loading safety policies…" steps={["Fetching team policies", "Loading parameters", "Preparing simulation"]} />
      ) : error && !data ? (
        <FailState title="Couldn’t load policies." error={error} onRetry={reload} />
      ) : list.length === 0 ? (
        <EmptyState eyebrow="Empty · no policies" title="No safety policies configured." body="Policies are seeded by the DryRun API. Check that the backend has been initialised." />
      ) : (
        <div className="adm-grid">
          <div className="panel col" style={{ overflow: "hidden" }}>
            <div className="po hd" style={{ font: "500 10.5px/1 'DM Mono',monospace", letterSpacing: ".14em", color: "var(--text2)" }} aria-hidden="true">
              <span>POLICY</span>
              <span className="c-sev">EFFECT</span>
              <span>ON</span>
            </div>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }} aria-label="Policies">
              {list.map((p, i) => {
                const isSel = sel?.id === p.id;
                return (
                  <li key={p.id} className={`po${isSel ? " sel" : ""}${p.enabled ? "" : " off"}`} style={i === list.length - 1 ? { border: 0 } : undefined} onClick={() => setSelId(p.id)}>
                    <button type="button" className="adm-btnreset col" style={{ gap: 3, minWidth: 0 }} aria-pressed={isSel} onClick={() => setSelId(p.id)}>
                      <span className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                        <span className="h3" style={{ fontSize: 14 }}>{p.title}</span>
                        {firedIds.has(p.id) && <span className="fire">would fire</span>}
                      </span>
                      <span className="mono muted" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
                        {p.key} · {p.description}
                      </span>
                    </button>
                    <span className="c-sev"><SevChip s={p.severity} /></span>
                    <button
                      type="button"
                      role="switch"
                      className="tg"
                      aria-checked={p.enabled}
                      aria-label={`${p.enabled ? "Disable" : "Enable"} ${p.title}`}
                      disabled={!admin || toggling === p.id}
                      title={admin ? undefined : "Only an admin can change policies"}
                      onClick={(e) => {
                        e.stopPropagation();
                        quickToggle(p);
                      }}
                    />
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="col" style={{ gap: 18, minWidth: 0 }}>
            {sel && <Editor key={sel.id + String(sel.enabled) + JSON.stringify(sel.params)} p={sel} admin={admin} onSaved={replace} fires={firedIds.has(sel.id)} />}
            <Simulation policies={list} onResult={setFired} />
          </div>
        </div>
      )}
    </div>
  );
}

function Editor({ p, admin, onSaved, fires }: { p: Policy; admin: boolean; onSaved: (p: Policy) => void; fires: boolean }) {
  const uid = useId();
  const [params, setParams] = useState<Params>(p.params);
  const [enabled, setEnabled] = useState(p.enabled);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dirty = enabled !== p.enabled || !same(params, p.params);
  const invalid = Object.entries(params).some(([k, v]) => typeof p.params[k] === "number" && (typeof v !== "number" || Number.isNaN(v)));

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const saved = await api<Policy>(`/api/policies/${p.id}`, { method: "PUT", json: { enabled, params } });
      onSaved(saved);
      toast.success(`Saved “${saved.title}”`, { description: "Recorded in the audit log." });
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  const keys = Object.keys(p.params);
  return (
    <section className="glass" style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 12 }} aria-labelledby={`${uid}-t`}>
      <div className="row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <span id={`${uid}-t`} className="h2" style={{ fontSize: 24 }}>{p.title}</span>
        <span className="row" style={{ gap: 8 }}>
          {dirty && <span className="st st-info">draft</span>}
          {fires && <span className="fire">would fire</span>}
        </span>
      </div>
      <div className="cond">
        <span className="kw">WHEN</span>
        {keys.length === 0 ? <span>always</span> : keys.map((k, i) => (
          <span key={k} style={{ display: "contents" }}>
            {i > 0 && <span className="kw">AND</span>}
            <span>{k} = {String(params[k])}</span>
          </span>
        ))}
        <span className="kw">→</span>
        <span style={p.severity === "block" ? { color: "#A8234F", borderColor: "#A8234F" } : p.severity === "review" ? { color: "#A3552F", borderColor: "#C56F45" } : undefined}>
          {p.severity === "block" ? "✕ block" : p.severity === "review" ? "△ review" : "◇ info"}
        </span>
      </div>
      <span style={{ font: "400 13px/1.5 'Manrope',sans-serif", color: "var(--text2)" }}>
        <b style={{ color: "var(--text)" }}>Why it exists:</b> {p.description} <b style={{ color: "var(--text)" }}>{p.severity === "block" ? "Blocks:" : p.severity === "review" ? "Requires:" : "Adds:"}</b>{" "}
        {p.severity === "block" ? "approval, not rehearsal." : p.severity === "review" ? "a human review before approval." : "a note on the report."}
      </span>

      <div className="col">
        <div className="prm">
          <label htmlFor={`${uid}-en`}>Enabled</label>
          <button id={`${uid}-en`} type="button" role="switch" className="tg" aria-checked={enabled} onClick={() => setEnabled((v) => !v)} disabled={!admin || saving} style={{ justifySelf: "end" }} />
        </div>
        {keys.map((k) => {
          const orig = p.params[k];
          const v = params[k];
          const id = `${uid}-${k}`;
          return (
            <div key={k} className="prm">
              <label htmlFor={id}>{label(k)}</label>
              {typeof orig === "boolean" ? (
                <button id={id} type="button" role="switch" className="tg" aria-checked={!!v} onClick={() => setParams((s) => ({ ...s, [k]: !s[k] }))} disabled={!admin || saving} style={{ justifySelf: "end" }} />
              ) : typeof orig === "number" ? (
                <input
                  id={id}
                  type="number"
                  className="inp mono"
                  inputMode="decimal"
                  step="any"
                  value={typeof v === "number" && !Number.isNaN(v) ? v : ""}
                  onChange={(e) => setParams((s) => ({ ...s, [k]: e.target.value === "" ? Number.NaN : Number(e.target.value) }))}
                  disabled={!admin || saving}
                  aria-invalid={typeof v !== "number" || Number.isNaN(v)}
                />
              ) : (
                <input id={id} className="inp mono" value={String(v ?? "")} onChange={(e) => setParams((s) => ({ ...s, [k]: e.target.value }))} disabled={!admin || saving} />
              )}
            </div>
          );
        })}
      </div>
      {err && <div className="adm-err" role="alert">✕ {err}</div>}
      <div className="row" style={{ gap: 8 }}>
        <button
          type="button"
          className="btn btn-sm"
          disabled={!dirty || saving}
          onClick={() => {
            setParams(p.params);
            setEnabled(p.enabled);
            setErr(null);
          }}
        >
          Reset
        </button>
        <span className="mono muted" style={{ fontSize: 11, marginLeft: "auto" }}>{invalid ? "Fill in every number" : dirty ? "Unsaved changes" : "Saved"}</span>
        <button type="button" className="btn btn-sm btn-p" disabled={!admin || !dirty || invalid || saving} onClick={save}>
          {saving ? "Saving…" : "Save policy"}
        </button>
      </div>
    </section>
  );
}

function Simulation({ policies, onResult }: { policies: Policy[]; onResult: (v: PolicyViolation[] | null) => void }) {
  const uid = useId();
  const { data: recent, error, loading } = useApi<RehearsalSummary[]>("/api/rehearsals?limit=20");
  const [rid, setRid] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ rid: string; v: PolicyViolation[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const done = useMemo(() => (recent ?? []).filter((r) => r.status !== "queued" && r.status !== "running"), [recent]);
  useEffect(() => {
    if (!rid && done.length) setRid(done[0].id);
  }, [rid, done]);

  async function run() {
    if (!rid) return;
    setBusy(true);
    setErr(null);
    try {
      const v = await api<PolicyViolation[]>("/api/policies/simulate", { method: "POST", json: { rehearsal_id: rid } });
      setRes({ rid, v });
      onResult(v);
    } catch (e) {
      setErr(errMsg(e));
      onResult(null);
    } finally {
      setBusy(false);
    }
  }

  const target = (recent ?? []).find((r) => r.id === res?.rid);
  const ids = (sev: Policy["severity"]) => new Set((res?.v ?? []).filter((x) => x.severity === sev).map((x) => x.policy_id)).size;
  const block = ids("block");
  const review = ids("review");
  const info = ids("info");
  const enabled = policies.filter((p) => p.enabled).length;
  const pass = Math.max(0, enabled - block - review - info);

  return (
    <section className="glass" style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 14 }} aria-labelledby={`${uid}-t`}>
      <div className="row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <span className="eyebrow" id={`${uid}-t`}>Simulation · test policies against a real rehearsal</span>
        <span className="mono muted" style={{ fontSize: 11 }}>{done.length} recent rehearsals</span>
      </div>
      <span className="serif" style={{ fontSize: 28, lineHeight: 1.15 }}>
        {target ? <>If this had gone to approval, {target.name} · V{target.version} would…</> : "Which policies would fire?"}
      </span>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <label className="adm-sr" htmlFor={`${uid}-r`}>Rehearsal to simulate</label>
        <select id={`${uid}-r`} className="inp" style={{ flex: "1 1 240px", width: "auto", height: 38, fontSize: 13 }} value={rid} onChange={(e) => setRid(e.target.value)} disabled={loading || !done.length || busy}>
          {loading && <option value="">Loading rehearsals…</option>}
          {!loading && !done.length && <option value="">No finished rehearsals yet</option>}
          {done.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} · V{r.version} · {r.connection_name} · {r.status}{r.risk != null ? ` · risk ${r.risk}` : ""} · {fmtDateTime(r.created_at)}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-sm btn-p" style={{ height: 38 }} onClick={run} disabled={!rid || busy}>
          {busy ? "Simulating…" : "Simulate"}
        </button>
      </div>
      {error && <div className="adm-err" role="alert">✕ Couldn’t load rehearsals: {error.message}</div>}
      {err && <div className="adm-err" role="alert">✕ {err}</div>}

      {res && (
        <div className="col" style={{ gap: 14 }} aria-live="polite">
          <div className="row" style={{ gap: 24, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div className="col" style={{ gap: 4 }}><span className="num" style={{ fontSize: 48, color: "#47705A" }}>{pass}</span><span className="eyebrow">policies pass</span></div>
            <div className="col" style={{ gap: 4 }}><span className="num" style={{ fontSize: 48, color: "#A3552F" }}>{review}</span><span className="eyebrow">need review</span></div>
            <div className="col" style={{ gap: 4 }}><span className="num" style={{ fontSize: 48, color: "#A8234F" }}>{block}</span><span className="eyebrow">would block</span></div>
            {info > 0 && <div className="col" style={{ gap: 4 }}><span className="num" style={{ fontSize: 48, color: "#6A4FB8" }}>{info}</span><span className="eyebrow">notes</span></div>}
          </div>
          <div className="row" style={{ gap: 3, height: 12 }} aria-hidden="true">
            {pass > 0 && <div className="grow-x" style={{ flex: pass, height: "100%", borderRadius: 6, background: "#BFD9B5" }} />}
            {review > 0 && <div className="grow-x" style={{ flex: review, height: "100%", borderRadius: 6, background: "#F7C59F", animationDelay: ".2s" }} />}
            {block > 0 && <div className="grow-x" style={{ flex: block, height: "100%", borderRadius: 6, background: "#F4B8CC", animationDelay: ".4s" }} />}
            {info > 0 && <div className="grow-x" style={{ flex: info, height: "100%", borderRadius: 6, background: "#CBB8F6", animationDelay: ".6s" }} />}
          </div>
          {res.v.length === 0 ? (
            <div className="row" style={{ gap: 10, padding: "12px 14px", borderRadius: 12, background: "#E6F2DF" }}>
              <span className="st st-safe">✓ clear</span>
              <span style={{ font: "600 14px/1.3 'Manrope',sans-serif", color: "#2F4B3C" }}>No enabled policy would fire.</span>
            </div>
          ) : (
            <ul className="col" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {res.v.map((v, i) => (
                <li key={`${v.policy_id}-${i}`} className="vl">
                  <SevChip s={v.severity} />
                  <span><b>{v.title}</b> — {v.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <span style={{ font: "400 12.5px/1.5 'Manrope',sans-serif", color: "var(--text2)" }}>
        Simulation uses the saved policy settings and never touches a database. Save a change first to see its effect.
      </span>
    </section>
  );
}
