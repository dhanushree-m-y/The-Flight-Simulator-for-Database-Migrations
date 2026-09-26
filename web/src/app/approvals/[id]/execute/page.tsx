"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { toast } from "sonner";
import { TopBar } from "@/components/shell/AppShell";
import { useShell, useVariant } from "@/components/shell/ShellContext";
import { api, useApi, useEventStream } from "@/lib/api";
import { fmtDateTime, fmtDuration, fmtTime } from "@/lib/format";
import type { ApplyEvent, ApplyRun, Approval, AuditVerify, LogLine, StageStatus } from "@/lib/types";
import { EmptyState, FailState, LoadState, Modal, ProdStrip, canApprove, errMsg, useNow } from "@/components/admin/kit";

const DONE: StageStatus[] = ["passed", "failed", "skipped", "warning"];
const progress = (r: ApplyRun | null | undefined) => (!r ? -1 : r.steps.filter((s) => DONE.includes(s.status)).length + (r.status === "running" ? 0 : 10) + (r.status === "restored" ? 10 : 0));

function stepLook(s: StageStatus, i: number): { glyph: string; style: CSSProperties; cls?: string; word: string } {
  switch (s) {
    case "passed":
      return { glyph: "✓", style: { background: "#47705A", color: "#FFFFFF" }, word: "done" };
    case "running":
      return { glyph: "●", style: { background: "#FFFFFF", color: "#2A1620", border: "2px solid #2A1620" }, cls: "run", word: "in progress" };
    case "failed":
      return { glyph: "✕", style: { background: "#A8234F", color: "#FFFFFF" }, word: "failed" };
    case "warning":
      return { glyph: "△", style: { background: "#FFE4CC", color: "#A3552F", border: "1px dashed #C56F45" }, word: "warning" };
    case "skipped":
      return { glyph: "–", style: { background: "#FFFFFF", color: "#756A78", border: "1px dashed rgba(38,31,41,.25)" }, word: "skipped" };
    default:
      return { glyph: String(i + 1), style: { background: "#FFFFFF", color: "#756A78", border: "1px solid rgba(38,31,41,.2)" }, word: "waiting" };
  }
}

export default function ExecutePage() {
  useVariant("calm");
  const { id } = useParams<{ id: string }>();
  const { me } = useShell();
  const now = useNow(1000);
  const [pollMs, setPollMs] = useState<number | undefined>(5000);
  const { data: a, error, loading, reload, setData } = useApi<Approval>(`/api/approvals/${id}`, { pollMs });
  const verify = useApi<AuditVerify>("/api/audit/verify");

  const [live, setLive] = useState<ApplyRun | null>(null);
  const [liveLogs, setLiveLogs] = useState<LogLine[]>([]);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const wasRunning = useRef(false);

  // Most advanced view of the run: SSE snapshot vs. last polled approval.
  const polled = a?.apply ?? null;
  const run = progress(live) >= progress(polled) ? live : polled;
  const logs = liveLogs.length >= (run?.logs.length ?? 0) ? liveLogs : run?.logs ?? [];
  const running = !!a && (a.status === "approved" || run?.status === "running");

  if (a && !running && pollMs) setPollMs(undefined);
  if (a && running && !pollMs) setPollMs(5000);

  const connected = useEventStream<ApplyEvent>(a && running ? `/api/approvals/${id}/events` : null, (e) => {
    if (e.type === "log") {
      setLiveLogs((l) => [...l, e.line].slice(-500));
      return;
    }
    setLive(e.run);
    setLiveLogs((l) => (e.run.logs.length >= l.length ? e.run.logs : l));
    if (e.type === "done") {
      reload();
      verify.reload();
    }
  });

  // Toast once when a run we watched finishes.
  useEffect(() => {
    if (!run) return;
    if (run.status === "running") wasRunning.current = true;
    else if (wasRunning.current) {
      wasRunning.current = false;
      if (run.status === "succeeded") toast.success("Applied, verified and recorded in the audit log.");
      else if (run.status === "failed") toast.error("The production apply failed — restore from backup is available.");
    }
  }, [run]);

  const env = { kind: "production" as const, name: a?.rehearsal.connection_name ?? "…" };
  const crumbs = [
    <Link key="a" href="/approvals" style={{ textDecoration: "none" }}>Approvals</Link>,
    a ? <Link key="r" href={`/approvals/${a.id}`} style={{ textDecoration: "none" }}>{a.rehearsal.name} · V{a.rehearsal.version}</Link> : "Request",
    "Execution",
  ];

  if (!a) {
    return (
      <div className="pg-execute page">
        <TopBar crumbs={crumbs} env={env} />
        <div style={{ paddingTop: 8 }}>
          {loading || !error ? (
            <LoadState title="Connecting to the production run…" steps={["Fetching the approval", "Opening the live event stream", "Loading backup details"]} />
          ) : (
            <FailState title="Couldn’t load this execution." error={error} onRetry={reload} action={<Link href="/approvals" className="btn">Back to approvals</Link>} />
          )}
        </div>
      </div>
    );
  }

  const r = a.rehearsal;
  const chain = verify.data;

  if (a.status === "pending" || a.status === "rejected") {
    return (
      <div className="pg-execute page">
        <TopBar crumbs={crumbs} env={env} />
        <ProdStrip name={r.connection_name} />
        <div style={{ paddingTop: 8 }}>
          <EmptyState
            eyebrow={a.status === "pending" ? "Not executed · awaiting approval" : "Not executed · rejected"}
            title={a.status === "pending" ? "Nothing has run on production yet." : "This change was rejected — nothing ran."}
            body={
              a.status === "pending"
                ? "Execution starts only after an approver who didn’t request the change types the database name and approves."
                : a.comment
                  ? `Reason: “${a.comment}”. Production was not modified.`
                  : "Production was not modified."
            }
            action={
              <>
                <Link href={`/approvals/${a.id}`} className="btn btn-p">{a.status === "pending" ? "Go to the approval" : "View the decision"}</Link>
                <Link href={`/rehearsals/${r.id}/report`} className="btn">Rehearsal report</Link>
              </>
            }
          />
        </div>
      </div>
    );
  }

  const status = run?.status ?? "running";
  const headline =
    status === "succeeded" ? "Applied. Verified. Recorded." : status === "failed" ? "Stopped. Restore is ready." : status === "restored" ? "Restored from backup." : "Changing production, carefully.";
  const failedStep = run?.steps.find((s) => s.status === "failed");
  const restoreUntil = run?.restore_until ? new Date(run.restore_until).getTime() : null;
  const restoreOpenWindow = !!run?.backup_ref && status !== "running" && status !== "restored" && (restoreUntil == null || restoreUntil > now);
  const mayRestore = canApprove(me);

  async function restore(): Promise<string | null> {
    try {
      const next = await api<Approval>(`/api/approvals/${id}/restore`, { method: "POST" });
      setData(next);
      setLive(next.apply);
      setLiveLogs(next.apply?.logs ?? []);
      verify.reload();
      toast.success(`${next.rehearsal.connection_name} restored from ${next.apply?.backup_ref ?? "backup"}.`);
      return null;
    } catch (e) {
      return errMsg(e);
    }
  }

  return (
    <div className="pg-execute page">
      <TopBar crumbs={crumbs} env={env} />
      <ProdStrip
        name={r.connection_name}
        right={
          chain ? (
            <Link
              href="/audit"
              className="st"
              style={{ marginLeft: "auto", marginRight: 24, textDecoration: "none", borderRadius: 13, ...(chain.ok ? { background: "#23302A", color: "#9CC99A" } : { background: "#3A1A28", color: "#FF8FAE" }) }}
            >
              {chain.ok ? "✓ history verified" : `✕ chain broken at #${chain.broken_at}`}
            </Link>
          ) : undefined
        }
      />

      <div className="adm-grid">
        <div className="col" style={{ gap: 18, minWidth: 0 }}>
          <span className="eyebrow" style={{ color: "#261F29" }}>
            Execution · {r.name} · V{r.version} · by DryRun Production Agent
          </span>
          <h1 className="serif" style={{ fontSize: 60, lineHeight: 1, margin: 0, fontWeight: 400 }} aria-live="polite">
            {headline}
          </h1>
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            {status === "running" && (
              <span className="st st-ai">
                <span className="dot breathe" /> {connected ? "live" : "reconnecting…"}
              </span>
            )}
            {status === "succeeded" && <span className="st st-safe">✓ succeeded</span>}
            {status === "failed" && <span className="st st-block">✕ failed{failedStep ? ` at ${failedStep.label.toLowerCase()}` : ""}</span>}
            {status === "restored" && <span className="st st-info">↺ restored</span>}
            {run && <span className="mono muted" style={{ fontSize: 11.5 }}>run {run.id}</span>}
          </div>

          {!run ? (
            <div className="col" style={{ gap: 10 }} role="status">
              <span style={{ font: "500 14px/1.4 'Manrope',sans-serif" }}>The production agent is picking up the approved tool call…</span>
              <div className="adm-indet" aria-hidden="true"><i /></div>
            </div>
          ) : (
            <ol style={{ listStyle: "none", margin: 0, padding: 0 }} aria-label="Execution stages" aria-live="polite">
              {run.steps.map((s, i) => {
                const lk = stepLook(s.status, i);
                const last = i === run.steps.length - 1;
                return (
                  <li key={s.key} className="sg" style={last ? { border: 0 } : undefined}>
                    <i className={lk.cls} style={lk.style} aria-hidden="true">{lk.glyph}</i>
                    <div className="col" style={{ gap: 4, minWidth: 0 }}>
                      <b style={s.status === "failed" ? { color: "#A8234F" } : undefined}>
                        {s.label}
                        <span className="adm-sr"> — {lk.word}</span>
                      </b>
                      <span className="mono muted" style={{ fontSize: 11.5, overflowWrap: "anywhere" }}>
                        {s.detail ?? (s.key === "backup" && run.backup_ref ? run.backup_ref : s.status === "pending" ? "waiting for the previous step" : "—")}
                      </span>
                    </div>
                    <code>{s.status === "running" ? "…" : s.status === "pending" ? "" : fmtDuration(s.duration_ms)}</code>
                  </li>
                );
              })}
            </ol>
          )}

          {status === "succeeded" && (
            <div className="row" style={{ gap: 10, padding: "12px 14px", borderRadius: 12, background: "#E6F2DF" }} role="status">
              <span style={{ width: 22, height: 22, borderRadius: "50%", background: "#47705A", color: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", font: "600 12px/1 'Manrope',sans-serif", flexShrink: 0 }}>✓</span>
              <span style={{ font: "600 14px/1.3 'Manrope',sans-serif", color: "#2F4B3C" }}>Migration applied to {r.connection_name} and verified against the rehearsal.</span>
            </div>
          )}
          {status === "failed" && (
            <div className="col" style={{ gap: 6, padding: "14px 16px", borderRadius: 12, background: "#FBE3EC", border: "1px solid rgba(168,35,79,.35)" }} role="alert">
              <span style={{ font: "600 14px/1.3 'Manrope',sans-serif", color: "#A8234F" }}>
                ✕ {failedStep ? `${failedStep.label} failed` : "The apply failed"} — DryRun stopped the run.
              </span>
              {failedStep?.detail && <span className="mono" style={{ fontSize: 12, color: "#261F29", overflowWrap: "anywhere" }}>{failedStep.detail}</span>}
              {run?.backup_ref && <span style={{ font: "400 13px/1.5 'Manrope',sans-serif", color: "#261F29" }}>Backup {run.backup_ref} was taken before anything changed. Restore it from the recovery panel.</span>}
            </div>
          )}

          <div className="col" style={{ gap: 8 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="eyebrow">Execution log</span>
              <span className="mono muted" style={{ fontSize: 11 }}>{logs.length} lines</span>
            </div>
            <Console logs={logs} />
          </div>
        </div>

        <div className="col" style={{ gap: 18, minWidth: 0 }}>
          <div className="panel" style={{ padding: "20px 24px" }}>
            <span className="eyebrow">Run</span>
            <div className="vk" style={{ marginTop: 8 }}><span>Status</span><span>{status}</span></div>
            <div className="vk"><span>Backup</span><span style={{ overflowWrap: "anywhere", textAlign: "right" }}>{run?.backup_ref ?? (status === "running" ? "being created…" : "—")}</span></div>
            <div className="vk"><span>Restore window</span><span>{run?.restore_until ? `until ${fmtDateTime(run.restore_until)}` : "—"}</span></div>
            <div className="vk" style={{ border: 0 }}><span>Evidence</span><Link href={`/rehearsals/${r.id}/report`} className="cite">rehearsal {r.id}</Link></div>
          </div>
          <div className="panel" style={{ padding: "20px 24px" }}>
            <span className="eyebrow">Accountability</span>
            <div className="vk" style={{ marginTop: 8 }}><span>Requested by</span><span>{a.requested_by.name} · {fmtTime(a.requested_at)}</span></div>
            <div className="vk"><span>Approved by</span><span>{a.decided_by?.name ?? "—"} · {fmtTime(a.decided_at)}</span></div>
            <div className="vk"><span>Executed by</span><span>DryRun Production Agent</span></div>
            <div className="vk" style={a.comment ? undefined : { border: 0 }}><span>Released tool call</span><span>TrueForge · apply_to_production</span></div>
            {a.comment && <div className="vk" style={{ border: 0 }}><span>Comment</span><span style={{ textAlign: "right", maxWidth: "65%" }}>“{a.comment}”</span></div>}
          </div>

          {status === "restored" ? (
            <div className="col" style={{ gap: 10, padding: "20px 24px", borderRadius: 14, border: "1px solid rgba(38,31,41,.16)", background: "#FFFFFF" }}>
              <span className="eyebrow">Recovery</span>
              <span style={{ font: "600 14.5px/1.4 'Manrope',sans-serif" }}>↺ {r.connection_name} was restored from {run?.backup_ref ?? "the backup"}.</span>
              <span style={{ font: "400 13px/1.5 'Manrope',sans-serif", color: "#756A78" }}>The restore is recorded in the audit log. Re-rehearse before requesting approval again.</span>
              <Link href={`/rehearsals/${r.id}/report`} className="btn btn-sm" style={{ alignSelf: "flex-start" }}>Back to the report</Link>
            </div>
          ) : run?.backup_ref ? (
            <div className="col" style={{ gap: 12, padding: "20px 24px", borderRadius: 14, border: "1px solid rgba(168,35,79,.35)", background: "#FFFFFF" }}>
              <div className="row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <span className="eyebrow" style={{ color: "#A8234F" }}>Recovery</span>
                <span className="mono muted" style={{ fontSize: 11.5 }}>
                  {run.backup_ref}
                  {run.restore_until ? ` · ${restoreUntil! > now ? `kept until ${fmtDateTime(run.restore_until)}` : "window closed"}` : ""}
                </span>
              </div>
              <span style={{ font: "400 13.5px/1.5 'Manrope',sans-serif" }}>
                Restore returns all of {r.connection_name} to the moment before this change. Writes pause while it runs, and data written after the backup is lost.
              </span>
              {restoreOpenWindow ? (
                <>
                  <button type="button" className="btn" style={{ alignSelf: "flex-start", color: "#A8234F", borderColor: "#A8234F" }} disabled={!mayRestore} onClick={() => setRestoreOpen(true)}>
                    ⛨ Restore from backup…
                  </button>
                  {!mayRestore && (
                    <span style={{ font: "400 12.5px/1.45 'Manrope',sans-serif", color: "#756A78" }}>
                      Only an approver or admin can restore production{me ? ` — you’re signed in as ${me.role}` : ""}.
                    </span>
                  )}
                </>
              ) : (
                <span className="mono muted" style={{ fontSize: 12 }}>{status === "running" ? "Restore becomes available when the run finishes." : "The restore window has closed."}</span>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {run?.backup_ref && (
        <RestoreDialog open={restoreOpen} onClose={() => setRestoreOpen(false)} db={r.connection_name} phrase={a.confirm_phrase} backup={run.backup_ref} onConfirm={restore} />
      )}
    </div>
  );
}

function Console({ logs }: { logs: LogLine[] }) {
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [logs.length]);
  const cls = (l: LogLine["level"]) => (l === "warn" ? "w" : l === "error" ? "e" : l === "ai" ? "a" : undefined);
  return (
    <div
      ref={box}
      className="console"
      role="log"
      aria-label="Execution log"
      tabIndex={0}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
    >
      {logs.length === 0 ? (
        <span className="t">Waiting for the first log line…</span>
      ) : (
        logs.map((l, i) => (
          <div key={i} className="ln">
            <span className="t">{fmtTime(l.ts)}</span>
            <span className={cls(l.level) ?? "t"}>{l.source}</span>
            <span className={cls(l.level)}>{l.message}</span>
          </div>
        ))
      )}
    </div>
  );
}

function RestoreDialog({ open, onClose, db, phrase, backup, onConfirm }: { open: boolean; onClose: () => void; db: string; phrase: string; backup: string; onConfirm: () => Promise<string | null> }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const uid = useId();
  const ok = typed === phrase;
  const close = () => {
    if (busy) return;
    setTyped("");
    setErr(null);
    onClose();
  };
  return (
    <Modal open={open} onClose={close} label={`Restore ${db} from backup`} danger>
      <div className="adm-dz col" style={{ gap: 16 }}>
        <span style={{ font: "500 11px/1 'DM Mono',monospace", letterSpacing: ".2em", color: "#FFB3CE" }}>⛨ PRODUCTION RESTORE</span>
        <span className="serif" style={{ fontSize: 32, lineHeight: 1.08 }}>Restore {db} from backup?</span>
        <div className="col">
          <div className="pk" style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid rgba(255,233,241,.14)", font: "400 13px/1.2 'DM Mono',monospace" }}>
            <span style={{ fontFamily: "Manrope,sans-serif", color: "#E2BFCE" }}>Backup</span>
            <span>{backup}</span>
          </div>
          <div className="pk" style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", font: "400 13px/1.2 'DM Mono',monospace" }}>
            <span style={{ fontFamily: "Manrope,sans-serif", color: "#E2BFCE" }}>Data written after the backup</span>
            <span style={{ color: "#FF8FAE" }}>is lost</span>
          </div>
        </div>
        <div className="col" style={{ gap: 8 }}>
          <label htmlFor={`${uid}-r`} style={{ font: "500 13px/1.3 'Manrope',sans-serif", color: "#E2BFCE" }}>
            Type <span className="mono" style={{ color: "#FFFFFF", background: "rgba(255,255,255,.12)", padding: "2px 6px", borderRadius: 5 }}>{phrase}</span> to restore
          </label>
          <input
            id={`${uid}-r`}
            data-autofocus
            className="inp"
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value);
              setErr(null);
            }}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={!!typed && !ok}
            style={{ height: 48, fontSize: 17, borderColor: ok ? "#9CC99A" : typed ? "#FF8FAE" : undefined }}
            disabled={busy}
          />
        </div>
        {err && (
          <span role="alert" style={{ font: "500 13px/1.45 'Manrope',sans-serif", color: "#FF8FAE" }}>
            ✕ {err}
          </span>
        )}
        <div className="row" style={{ gap: 10 }}>
          <button type="button" className="btn" style={{ height: 48, background: "transparent", color: "#FFE9F1", borderColor: "rgba(255,233,241,.35)" }} onClick={close} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-lg btn-danger"
            style={{ flex: 1 }}
            disabled={!ok || busy}
            onClick={async () => {
              setBusy(true);
              const e = await onConfirm();
              setBusy(false);
              if (e) setErr(e);
              else {
                setTyped("");
                onClose();
              }
            }}
          >
            {busy ? "Restoring…" : `⛨ Restore ${db}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
