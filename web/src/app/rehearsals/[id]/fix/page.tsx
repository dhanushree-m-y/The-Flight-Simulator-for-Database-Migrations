"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { EvidenceShell, VerdictChip, useReducedMotion } from "@/components/evidence/EvidenceShell";
import { diffLines, sideBySideMarks } from "@/components/evidence/diff";
import { ErrorBlock, LoadingBlock, SqlCode } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { fmtDateTime, pad2, riskColor } from "@/lib/format";
import type { AiFix, AiFixState, Rehearsal } from "@/lib/types";

export default function AiFixPage() {
  const { id } = useParams<{ id: string }>();
  const fixState = useApi<AiFixState>(`/api/rehearsals/${id}/fix`);
  const running = fixState.data?.state === "running";
  // Poll while the agent works. useApi's own poller is keyed on its options, so drive it here.
  const { reload } = fixState;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(reload, 1500);
    return () => clearInterval(t);
  }, [running, reload]);

  return (
    <EvidenceShell
      id={id}
      tab="fix"
      pg="aifix"
      right={(r) =>
        fixState.data?.state === "ready" ? (
          <span className="st st-ai">◇ AI draft · not rehearsed</span>
        ) : fixState.data?.state === "running" ? (
          <span className="st st-ai">◉ agent working</span>
        ) : r ? (
          <VerdictChip r={r} />
        ) : null
      }
    >
      {(r) => <FixBody r={r} fixState={fixState} />}
    </EvidenceShell>
  );
}

type FixApi = ReturnType<typeof useApi<AiFixState>>;

function FixBody({ r, fixState }: { r: Rehearsal; fixState: FixApi }) {
  const { data, error, loading, reload, setData } = fixState;
  const [starting, setStarting] = useState(false);

  const ask = async () => {
    setStarting(true);
    try {
      const s = await api<AiFixState>(`/api/rehearsals/${r.id}/fix`, { method: "POST" });
      setData(s);
      toast("DryRun agent is on it", { description: "It investigates in the sandbox; nothing touches production." });
    } catch (e) {
      toast.error("Couldn’t start the agent", { description: (e as Error).message });
    } finally {
      setStarting(false);
    }
  };

  if (loading && !data) return <LoadingBlock lines={6} />;
  if (error && !data) return <ErrorBlock error={error} onRetry={reload} />;
  const state = data?.state ?? "none";

  if (state === "ready" && data?.fix) return <FixReady key={data.fix.id} r={r} fix={data.fix} />;
  if (state === "running") return <Thinking r={r} />;
  if (state === "failed")
    return (
      <>
        <Header eyebrow="◇ AI fix · attempt failed" title="The agent couldn’t draft a safe fix." />
        <div className="glass state-box" role="alert">
          <span className="st st-block">✕ Agent failed</span>
          <span style={{ font: "500 15px/1.5 'Manrope',sans-serif", maxWidth: 560 }}>{data?.error || "The agent stopped without producing a fix."}</span>
          <span className="muted" style={{ fontSize: 13 }}>Nothing was applied. The sandbox and production are unchanged.</span>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn-ai" onClick={ask} disabled={starting}>
              {starting ? "Starting…" : "◇ Try again"}
            </button>
            <Link className="btn" href={`/rehearsals/${r.id}/report`}>
              Back to report
            </Link>
          </div>
        </div>
      </>
    );

  // state === "none"
  const failing = r.checks.filter((c) => c.status !== "pass");
  return (
    <>
      <Header eyebrow="◇ AI fix · grounded in this rehearsal’s evidence" title="Ask the agent for a safer migration." />
      <div className="glass col" style={{ padding: "30px 32px", gap: 16, maxWidth: 760, background: "rgba(238,231,255,.6)", borderColor: "rgba(119,88,200,.25)" }}>
        <span className="eyebrow" style={{ color: "#6A4FB8" }}>
          What the agent will do
        </span>
        <span className="serif" style={{ fontSize: 26, lineHeight: 1.2 }}>
          Read the failing checks, inspect the broken rows in the sandbox, and draft a version of <span className="mono" style={{ fontSize: 20 }}>{r.name}</span> that
          avoids them.
        </span>
        {failing.length > 0 && (
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {failing.slice(0, 8).map((c) => (
              <span key={c.id} className="cite">
                {c.key}
                {c.affected_rows ? ` · ${c.affected_rows}` : ""}
              </span>
            ))}
          </div>
        )}
        <ShieldNote />
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-ai btn-lg" onClick={ask} disabled={starting}>
            {starting ? "Starting the agent…" : "◇ Ask the agent for a fix"}
          </button>
          <Link className="btn btn-lg" href={`/rehearsals/${r.id}/report`}>
            Back to report
          </Link>
        </div>
      </div>
    </>
  );
}

function Header({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="col" style={{ gap: 10 }}>
      <span className="eyebrow" style={{ color: "#6A4FB8" }}>
        {eyebrow}
      </span>
      <h1 className="h1" style={{ margin: 0 }}>
        {title}
      </h1>
    </div>
  );
}

function ShieldNote() {
  return (
    <div className="row" style={{ gap: 10, padding: "10px 12px", borderRadius: 12, background: "rgba(255,255,255,.7)", border: "1px solid rgba(71,112,90,.2)" }}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#47705A" strokeWidth="1.4" aria-hidden="true">
        <path d="M8 1.5l5 2.5v4c0 3.2-2.4 5.3-5 6.5-2.6-1.2-5-3.3-5-6.5V4z" />
        <path d="M5.8 8.2l1.6 1.6 3-3.2" />
      </svg>
      <span style={{ font: "500 12.5px/1.4 'Manrope',sans-serif", color: "#2F5B45" }}>Generated SQL runs only in the sandbox until a human approves.</span>
    </div>
  );
}

const THINK_STEPS = ["Reading failing checks", "Sampling broken rows in the sandbox", "Tracing foreign keys and locks", "Drafting a safer migration", "Writing the down migration"];

function Thinking({ r }: { r: Rehearsal }) {
  const reduce = useReducedMotion();
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => setStep((s) => (s + 1) % THINK_STEPS.length), 2200);
    return () => clearInterval(t);
  }, [reduce]);
  return (
    <>
      <Header eyebrow="◇ AI fix · in progress" title="DryRun agent is investigating in the sandbox…" />
      <div className="ev-fix3">
        <div className="col" style={{ gap: 10 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="eyebrow">Original · V{r.version}</span>
            {r.risk != null && <span className="st st-block">✕ {pad2(r.risk)}</span>}
          </div>
          <SqlCode sql={r.up_sql} />
        </div>
        <div className="glass col ev-fix-card" style={{ padding: 22, gap: 14, background: "rgba(238,231,255,.6)", borderColor: "rgba(119,88,200,.25)" }} aria-live="polite" aria-busy="true">
          <span className="eyebrow" style={{ color: "#6A4FB8" }}>
            Agent is thinking
          </span>
          <span className="ev-think" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="serif" style={{ fontSize: 25, lineHeight: 1.2 }}>
            {THINK_STEPS[step]}…
          </span>
          <div className="col" style={{ gap: 6 }}>
            {THINK_STEPS.map((s, i) => (
              <span key={s} className="mono" style={{ fontSize: 11.5, color: i === step ? "#6A4FB8" : "var(--text2)", opacity: i <= step ? 1 : 0.5 }}>
                {i < step ? "✓" : i === step ? "◉" : "○"} {s}
              </span>
            ))}
          </div>
          <ShieldNote />
        </div>
        <div className="col" style={{ gap: 10 }}>
          <span className="eyebrow" style={{ color: "#47705A" }}>
            Safer version · V{r.version + 1}
          </span>
          <div className="code ev-stream" style={{ display: "block", padding: 18 }}>
            {[82, 64, 90, 48, 72].map((w, i) => (
              <div key={i} className="skel" style={{ height: 12, width: `${w}%`, margin: "10px 0" }} />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function FixReady({ r, fix }: { r: Rehearsal; fix: AiFix }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [fixed, setFixed] = useState(fix.fixed_sql);
  const [down, setDown] = useState(fix.down_sql ?? "");
  const [busy, setBusy] = useState(false);
  const edited = fixed !== fix.fixed_sql || down !== (fix.down_sql ?? "");

  const ops = useMemo(() => diffLines(fix.original_sql, fixed), [fix.original_sql, fixed]);
  const marks = useMemo(() => sideBySideMarks(ops), [ops]);
  const added = Object.keys(marks.right).length;
  const removed = Object.keys(marks.left).length;

  // Evidence strings usually name a check key ("ai_dup_email · 38"); link them to the rows.
  const cite = (e: string) => {
    const c = r.checks.find((k) => e.includes(k.key) || e.includes(k.id));
    return c?.has_rows ? `/rehearsals/${r.id}/rows?check=${encodeURIComponent(c.id)}` : null;
  };

  const rehearse = async () => {
    if (!fixed.trim()) {
      toast.error("The fixed migration is empty.");
      return;
    }
    setBusy(true);
    try {
      const next = await api<Rehearsal>(`/api/rehearsals/${r.id}/rehearse-fix`, { method: "POST", json: { fixed_sql: fixed, down_sql: down.trim() ? down : null } });
      toast.success(`Rehearsing V${next.version} in a fresh sandbox`);
      router.push(`/rehearsals/${next.id}`);
    } catch (e) {
      toast.error("Couldn’t start the rehearsal", { description: (e as Error).message });
      setBusy(false);
    }
  };

  const failing = r.checks.filter((c) => c.status === "fail");

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end", gap: 20, flexWrap: "wrap" }}>
        <div className="col" style={{ gap: 10, minWidth: 0 }}>
          <span className="eyebrow" style={{ color: "#6A4FB8" }}>
            ◇ AI fix{fix.evidence.length ? ` · grounded in ${fix.evidence.join(", ")}` : ""}
          </span>
          <h1 className="h1" style={{ margin: 0 }}>
            A safer {r.name}, drafted from sandbox evidence.
          </h1>
        </div>
        <span className="mono muted" style={{ fontSize: 11.5 }}>
          {fix.model ?? "agent"} · {fmtDateTime(fix.created_at)}
        </span>
      </div>

      <div className="ev-fix3">
        <div className="col" style={{ gap: 10, minWidth: 0 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="eyebrow">Original · V{r.version}</span>
            {r.risk != null && <span className={r.risk > 60 ? "st st-block" : r.risk > 30 ? "st st-review" : "st st-safe"}>{r.risk > 60 ? "✕" : r.risk > 30 ? "△" : "✓"} {pad2(r.risk)}</span>}
          </div>
          <SqlCode sql={fix.original_sql} marks={marks.left} />
          {(r.error || failing.length > 0) && (
            <div className="panel" style={{ padding: "14px 16px", font: "400 13px/1.55 'Manrope',sans-serif", color: "var(--text2)" }}>
              {r.error ? (
                <>
                  Fails with <span className="mono" style={{ color: "var(--text)" }}>{r.error}</span>
                </>
              ) : (
                <>
                  {failing.length} failing {failing.length === 1 ? "check" : "checks"}: {failing.slice(0, 3).map((c) => c.title).join(" · ")}
                  {failing.length > 3 ? " …" : ""}
                </>
              )}
            </div>
          )}
        </div>

        <div className="glass col ev-fix-card" style={{ padding: 22, gap: 14, background: "rgba(238,231,255,.6)", borderColor: "rgba(119,88,200,.25)" }}>
          <span className="eyebrow" style={{ color: "#6A4FB8" }}>
            Why this changed
          </span>
          <span className="serif" style={{ fontSize: 25, lineHeight: 1.2 }}>
            {fix.root_cause}
          </span>
          {fix.evidence.length > 0 && (
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              {fix.evidence.map((e) => {
                const href = cite(e);
                return href ? (
                  <Link key={e} href={href} className="cite">
                    {e}
                  </Link>
                ) : (
                  <span key={e} className="cite">
                    {e}
                  </span>
                );
              })}
            </div>
          )}
          <div className="rule" />
          <span className="eyebrow">Expected risk</span>
          <div className="row" style={{ alignItems: "flex-end", gap: 12 }}>
            <span className="serif" style={{ fontSize: 44, lineHeight: 0.9, color: riskColor(r.risk) }}>
              {r.risk == null ? "—" : pad2(r.risk)}
            </span>
            <svg width="50" height="16" viewBox="0 0 50 16" aria-hidden="true">
              <path className="draw" d="M0 8 H44 M38 2 L46 8 L38 14" fill="none" stroke="#7758C8" strokeWidth="1.5" />
            </svg>
            <span className="serif tab" style={{ fontSize: 72, lineHeight: 0.8, color: "#7758C8" }} aria-label="unknown until rehearsed">
              ?
            </span>
          </div>
          <span style={{ font: "400 12px/1.45 'Manrope',sans-serif", color: "var(--text2)" }}>The real score comes only from rehearsing it.</span>
          <ShieldNote />
          <div className="col" style={{ gap: 8, marginTop: "auto" }}>
            <button type="button" className="btn btn-ai btn-lg" onClick={rehearse} disabled={busy}>
              {busy ? "Starting sandbox…" : edited ? "◇ Rehearse edited fix" : "◇ Rehearse this fix"}
            </button>
            <span className="mono" style={{ fontSize: 11, textAlign: "center", color: "var(--text2)" }}>
              new sandbox · V{r.version + 1} · AI fixes are never applied directly
            </span>
            <Link href={`/rehearsals/${r.id}/report`} className="btn btn-sm" style={{ alignSelf: "center" }}>
              Discard
            </Link>
          </div>
        </div>

        <div className="col" style={{ gap: 10, minWidth: 0 }}>
          <div className="row" style={{ justifyContent: "space-between", gap: 10 }}>
            <span className="eyebrow" style={{ color: "#47705A" }}>
              Safer version · V{r.version + 1}{" "}
              <span className="mono" style={{ letterSpacing: 0 }}>
                <span style={{ color: "#47705A" }}>+{added}</span> <span style={{ color: "#B8386E" }}>−{removed}</span>
              </span>
            </span>
            <div className="row" style={{ gap: 6 }}>
              {editing && edited && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    setFixed(fix.fixed_sql);
                    setDown(fix.down_sql ?? "");
                  }}
                >
                  Reset
                </button>
              )}
              <button type="button" className="btn btn-sm" aria-pressed={editing} onClick={() => setEditing((v) => !v)}>
                {editing ? "Done editing" : "Edit before rehearsing"}
              </button>
            </div>
          </div>
          {editing ? (
            <textarea className="inp" value={fixed} onChange={(e) => setFixed(e.target.value)} spellCheck={false} aria-label="Fixed migration SQL" rows={Math.max(12, fixed.split("\n").length + 1)} />
          ) : (
            <SqlCode sql={fixed} marks={marks.right} />
          )}
          <span className="eyebrow" style={{ marginTop: 8 }}>
            Down migration {fix.down_sql ? "· ◇ AI-generated" : ""}
          </span>
          {editing ? (
            <textarea className="inp" value={down} onChange={(e) => setDown(e.target.value)} spellCheck={false} aria-label="Down migration SQL" rows={Math.max(5, down.split("\n").length + 1)} placeholder="-- how to undo the fixed migration" />
          ) : down.trim() ? (
            <SqlCode sql={down} />
          ) : (
            <div className="panel" style={{ padding: "14px 16px", font: "400 13px/1.5 'Manrope',sans-serif", color: "var(--text2)" }}>
              No down migration drafted. Rollback will be marked unproven unless you add one.
            </div>
          )}
        </div>
      </div>

      {fix.why_safer.length > 0 && (
        <div className="panel ev-steps" style={{ padding: "8px 22px" }} aria-label="Why this is safer">
          {fix.why_safer.map((w, i) => (
            <div key={i} className="ps">
              <b>{i + 1}</b>
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
