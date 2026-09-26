"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useId, useRef, useState, type RefObject } from "react";
import { toast } from "sonner";
import { TopBar } from "@/components/shell/AppShell";
import { useShell, useVariant } from "@/components/shell/ShellContext";
import { api, useApi } from "@/lib/api";
import { fmtDateTime, fmtTime, riskBand, riskColor } from "@/lib/format";
import type { Approval, User } from "@/lib/types";
import { ApprovalChip, FailState, LoadState, ProdStrip, canApprove, errMsg, useMediaQuery } from "@/components/admin/kit";

const EXECUTED: Approval["status"][] = ["approved", "applied", "apply_failed", "restored"];

const riskWord = (r: number | null) => ({ safe: "safe", review: "review", block: "blocked" })[riskBand(r)];
function RiskChip({ risk }: { risk: number | null }) {
  const b = riskBand(risk);
  const cls = b === "safe" ? "st st-safe" : b === "review" ? "st st-review" : "st st-block";
  return <span className={cls}>{b === "safe" ? "✓" : b === "review" ? "△" : "✕"} {riskWord(risk)}</span>;
}
const pad = (r: number | null) => (r == null ? "—" : String(r).padStart(2, "0"));

/** Why the approve button is disabled — every reason is shown, never a silently greyed button. */
function blockers(a: Approval, me: User | null, phrase: string): { text: string; sod?: boolean }[] {
  const out: { text: string; sod?: boolean }[] = [];
  if (!me) out.push({ text: "We couldn’t confirm who you are yet — reload if this persists." });
  else if (!canApprove(me)) out.push({ text: `You’re signed in as ${me.role}. Only an approver or admin can approve production.` });
  if (me && me.id === a.requested_by.id) out.push({ text: "Policy SOD-1: you requested this change — a different approver has to decide it.", sod: true });
  if (phrase !== a.confirm_phrase) out.push({ text: `Type ${a.confirm_phrase} exactly as shown (case-sensitive).` });
  return out;
}

export default function ApprovePage() {
  useVariant("calm");
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { me } = useShell();
  const mobile = useMediaQuery("(max-width: 720px)");
  const [pollMs, setPollMs] = useState<number | undefined>(10000);
  const { data: a, error, loading, reload, setData } = useApi<Approval>(`/api/approvals/${id}`, { pollMs });

  const [phrase, setPhrase] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [decErr, setDecErr] = useState<string | null>(null);
  const [needReason, setNeedReason] = useState(false);
  const commentRef = useRef<HTMLTextAreaElement>(null);

  if (a && a.status !== "pending" && pollMs) setPollMs(undefined);

  const env = a ? { kind: "production" as const, name: a.rehearsal.connection_name } : { kind: "production" as const, name: "…" };
  const crumbs = [
    <Link key="a" href="/approvals" style={{ textDecoration: "none" }}>Approvals</Link>,
    a ? `${a.rehearsal.name} · V${a.rehearsal.version}` : "Request",
  ];

  if (!a) {
    return (
      <div className="pg-approve page">
        <TopBar crumbs={crumbs} env={env} />
        <div style={{ paddingTop: 8 }}>
          {loading || !error ? (
            <LoadState title="Loading the change request…" steps={["Fetching the approval", "Loading rehearsal evidence", "Checking separation of duties"]} />
          ) : (
            <FailState title="Couldn’t load this change request." error={error} onRetry={reload} action={<Link href="/approvals" className="btn">Back to approvals</Link>} />
          )}
        </div>
      </div>
    );
  }

  const r = a.rehearsal;
  const pending = a.status === "pending";
  const blocks = blockers(a, me, phrase);
  const roleOk = !!me && canApprove(me) && me.id !== a.requested_by.id;
  const matches = phrase === a.confirm_phrase;
  const reportHref = `/rehearsals/${r.id}/report`;

  async function decide(decision: "approve" | "reject") {
    if (!a) return;
    setDecErr(null);
    if (decision === "reject" && !comment.trim()) {
      setNeedReason(true);
      commentRef.current?.focus();
      return;
    }
    setBusy(decision);
    try {
      const next = await api<Approval>(`/api/approvals/${a.id}/decide`, {
        method: "POST",
        // Rejecting is non-destructive, so it doesn't make the user type the database name; approving always sends what they typed.
        json: { decision, confirm_phrase: decision === "approve" ? phrase : a.confirm_phrase, comment: comment.trim() },
      });
      setData(next);
      if (decision === "approve") {
        toast.success(`Approved — applying ${r.name} to ${r.connection_name}`, { description: "The paused apply_to_production tool call was released." });
        router.push(`/approvals/${a.id}/execute`);
      } else {
        toast(`Rejected ${r.name} · V${r.version}`, { description: "The requester and the TrueForge session were notified." });
      }
    } catch (e) {
      setDecErr(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const decision = (
    <Decision
      a={a}
      compact={mobile}
      phrase={phrase}
      setPhrase={(v) => {
        setPhrase(v);
        setDecErr(null);
      }}
      comment={comment}
      setComment={(v) => {
        setComment(v);
        if (v.trim()) setNeedReason(false);
      }}
      commentRef={commentRef}
      needReason={needReason}
      blocks={blocks}
      roleOk={roleOk}
      matches={matches}
      busy={busy}
      err={decErr}
      onDecide={decide}
    />
  );

  /* ------------------------------------------------------------ mobile (23) */
  if (mobile) {
    return (
      <div className="pg-approve m page">
        <TopBar crumbs={crumbs} env={env} />
        <ProdStrip
          name={r.connection_name}
          compact
          back={
            <Link href="/approvals" aria-label="Back to approvals" style={{ width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", color: "#FFE9F1", textDecoration: "none", fontSize: 22 }}>
              ‹
            </Link>
          }
        />
        <div className="col" style={{ gap: 16 }}>
          <div className="col" style={{ gap: 6 }}>
            <span className="eyebrow" style={{ color: "#261F29" }}>{pending ? "Approve production change" : "Production change request"}</span>
            <span className="mono" style={{ fontSize: 17, overflowWrap: "anywhere" }}>{r.name} · V{r.version}</span>
          </div>
          <div className="row" style={{ gap: 12, alignItems: "flex-end" }}>
            <span className="serif tab" style={{ fontSize: 64, lineHeight: 0.85, color: riskColor(r.risk) }}>{pad(r.risk)}</span>
            <div className="col" style={{ gap: 6, paddingBottom: 4 }}>
              <RiskChip risk={r.risk} />
              {!pending && <ApprovalChip status={a.status} />}
            </div>
          </div>
          {r.headline && <span style={{ font: "400 13.5px/1.5 'Manrope',sans-serif", color: "var(--text2)" }}>{r.headline}</span>}
          <Checklist a={a} compact me={me} />
          <Link href={reportHref} className="btn" style={{ height: 44 }}>Open full evidence</Link>
          {decision}
        </div>
      </div>
    );
  }

  /* ----------------------------------------------------------- desktop (13) */
  return (
    <div className="pg-approve page">
      <TopBar crumbs={crumbs} env={env} />
      <ProdStrip
        name={r.connection_name}
        right={<span className="meta">Approvals / {r.name} · V{r.version} · request #{a.id}</span>}
      />
      <div className="adm-grid">
        <div className="col" style={{ gap: 22, minWidth: 0 }}>
          <div className="col" style={{ gap: 10 }}>
            <span className="eyebrow" style={{ color: "#261F29" }}>
              Production change request · {pending ? (roleOk ? "evidence reviewed by you" : "awaiting an approver") : `decided ${fmtDateTime(a.decided_at)}`}
            </span>
            <h1 className="h1" style={{ fontSize: 46, margin: 0, overflowWrap: "anywhere" }}>
              {pending ? <>Approve {r.name} for production.</> : a.status === "rejected" ? <>{r.name} was rejected.</> : <>{r.name} was approved for production.</>}
            </h1>
            {r.headline && <p style={{ margin: 0, font: "400 15px/1.55 'Manrope',sans-serif", color: "var(--text2)", maxWidth: 720 }}>{r.headline}</p>}
          </div>

          <div className="pp-row">
            <div className="pp">
              <span className="eyebrow">Migration</span>
              <span className="mono" style={{ fontSize: 16, overflowWrap: "anywhere" }}>{r.name} · V{r.version}</span>
              <span className="mono muted" style={{ fontSize: 11.5 }}>rehearsed {fmtDateTime(r.finished_at ?? r.created_at)} · by {r.created_by.name}</span>
            </div>
            <div className="pp">
              <span className="eyebrow">Risk</span>
              <div className="row" style={{ gap: 10 }}>
                <span className="serif tab" style={{ fontSize: 44, lineHeight: 0.9, color: riskColor(r.risk) }}>{pad(r.risk)}</span>
                <RiskChip risk={r.risk} />
              </div>
            </div>
            <div className="pp">
              <span className="eyebrow">Evidence</span>
              <span className="mono" style={{ fontSize: 13, overflowWrap: "anywhere" }}>rehearsal {r.id}</span>
              <Link href={reportHref} className="cite" style={{ alignSelf: "flex-start" }}>open report</Link>
            </div>
          </div>

          <Checklist a={a} me={me} reportHref={reportHref} />

          <div className="pp-row" style={{ gap: 12 }}>
            <div className="pp">
              <span className="eyebrow">Requested by</span>
              <span className="h3">{a.requested_by.name}{a.requested_by.id === me?.id ? " · you" : ""}</span>
              <span className="mono muted" style={{ fontSize: 11.5 }}>{a.requested_by.role} · {fmtTime(a.requested_at)}</span>
            </div>
            {pending ? (
              <div className="pp" style={roleOk ? { border: "2px solid #261F29" } : undefined}>
                <span className="eyebrow" style={roleOk ? { color: "#261F29" } : undefined}>Approving</span>
                <span className="h3">{roleOk && me ? `${me.name} · you` : "An approver or admin"}</span>
                <span className="mono muted" style={{ fontSize: 11.5 }}>{roleOk ? `${me?.role} · typed confirmation` : "not the requester · SOD-1"}</span>
              </div>
            ) : (
              <div className="pp" style={{ border: "2px solid #261F29" }}>
                <span className="eyebrow" style={{ color: "#261F29" }}>{a.status === "rejected" ? "Rejected by" : "Approved by"}</span>
                <span className="h3">{a.decided_by?.name ?? "—"}{a.decided_by?.id === me?.id ? " · you" : ""}</span>
                <span className="mono muted" style={{ fontSize: 11.5 }}>{a.decided_by?.role ?? "—"} · {fmtTime(a.decided_at)}</span>
              </div>
            )}
            <div className="pp">
              <span className="eyebrow">Executed by</span>
              <span className="h3">DryRun Production Agent</span>
              <span className="mono muted" style={{ fontSize: 11.5 }}>TrueForge · apply_to_production</span>
            </div>
          </div>
        </div>

        {decision}
      </div>
    </div>
  );
}

function Checklist({ a, compact, me, reportHref }: { a: Approval; compact?: boolean; me: User | null; reportHref?: string }) {
  const sodOk = !me || me.id !== a.requested_by.id;
  const items = [
    ...a.checklist,
    // Separation of duties is always shown; the server enforces it on decide.
    ...(a.status === "pending" ? [{ label: sodOk ? `Requested by ${a.requested_by.name}, not you` : "You requested this change", ok: sodOk, detail: "SOD-1" }] : []),
  ];
  return (
    <ul
      className="col"
      aria-label={`Approval checklist: ${items.filter((c) => c.ok).length} of ${items.length} passed`}
      style={{ listStyle: "none", margin: 0, padding: compact ? "2px 14px" : "4px 20px", borderRadius: 12, background: "#FFFFFF", border: "1px solid rgba(38,31,41,.16)" }}
    >
      {items.map((c, i) => (
        <li key={`${c.label}-${i}`} className="ck" style={i === items.length - 1 ? { border: 0 } : undefined}>
          <b className={c.ok ? undefined : "no"} aria-label={c.ok ? "passed" : "failed"}>{c.ok ? "✓" : "✕"}</b>
          <span style={c.ok ? undefined : { color: "#A8234F" }}>{c.label}</span>
          {!compact &&
            (c.detail ? (
              <span className="mono muted" style={{ fontSize: 11.5, textAlign: "right" }}>{c.detail}</span>
            ) : reportHref ? (
              <Link href={reportHref} className="cite">report</Link>
            ) : (
              <span />
            ))}
        </li>
      ))}
      {items.length === 0 && <li className="ck" style={{ border: 0 }}><b className="no">!</b><span>No checklist was recorded for this request.</span><span /></li>}
    </ul>
  );
}

function Decision(p: {
  a: Approval;
  compact: boolean;
  phrase: string;
  setPhrase: (v: string) => void;
  comment: string;
  setComment: (v: string) => void;
  commentRef: RefObject<HTMLTextAreaElement | null>;
  needReason: boolean;
  blocks: { text: string; sod?: boolean }[];
  roleOk: boolean;
  matches: boolean;
  busy: "approve" | "reject" | null;
  err: string | null;
  onDecide: (d: "approve" | "reject") => void;
}) {
  const { a, compact } = p;
  const r = a.rehearsal;
  const uid = useId();
  const inputId = `${uid}-c`;
  const hintId = `${uid}-h`;
  const whyId = `${uid}-w`;
  const cId = `${uid}-m`;
  const pending = a.status === "pending";
  const approveDisabled = !pending || p.blocks.length > 0 || !!p.busy;
  const okCount = a.checklist.filter((c) => c.ok).length;
  const border = p.matches ? "#9CC99A" : p.phrase ? "#FF8FAE" : "rgba(255,233,241,.35)";

  const tfNote = (
    <span className="row" style={{ gap: 8, alignItems: "flex-start", font: "400 12px/1.45 'Manrope',sans-serif", color: "#E2BFCE" }}>
      <span aria-hidden="true" style={{ color: "#CBB8F6" }}>◇</span>
      <span>
        This approval also releases the paused <span className="mono" style={{ color: "#FFFFFF" }}>apply_to_production</span> tool call in the TrueForge agent session.
      </span>
    </span>
  );

  const decided = !pending && (
    <div className="col" style={{ gap: 14 }}>
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <ApprovalChip status={a.status} />
        <span className="mono" style={{ fontSize: 12, color: "#E2BFCE" }}>
          {a.decided_by?.name ?? "—"} · {fmtDateTime(a.decided_at)}
        </span>
      </div>
      {a.comment && (
        <blockquote style={{ margin: 0, padding: "10px 14px", borderLeft: "3px solid #FFB3CE", background: "rgba(255,255,255,.06)", borderRadius: 8, font: "400 13.5px/1.5 'Manrope',sans-serif" }}>
          “{a.comment}”
        </blockquote>
      )}
      {EXECUTED.includes(a.status) ? (
        <Link href={`/approvals/${a.id}/execute`} className="btn btn-lg" style={{ height: 52, background: "#FFE9F1", color: "#2A1620", border: 0 }}>
          {a.status === "approved" ? "◉ Watch the execution live →" : "View the execution →"}
        </Link>
      ) : (
        <Link href={`/rehearsals/${r.id}/report`} className="btn" style={{ height: 48, background: "transparent", color: "#FFE9F1", borderColor: "rgba(255,233,241,.35)" }}>
          Back to the rehearsal report
        </Link>
      )}
    </div>
  );

  const form = pending && (
    <>
      <div className="col" style={{ gap: 8 }}>
        <label htmlFor={inputId} style={{ font: `500 ${compact ? 12.5 : 13}px/1.3 'Manrope',sans-serif`, color: "#E2BFCE" }}>
          Type{" "}
          <span className="mono" style={{ color: "#FFFFFF", background: "rgba(255,255,255,.12)", padding: "2px 6px", borderRadius: 5 }}>
            {a.confirm_phrase}
          </span>{" "}
          to confirm
        </label>
        <input
          id={inputId}
          className="inp"
          value={p.phrase}
          onChange={(e) => p.setPhrase(e.target.value)}
          onPaste={(e) => e.preventDefault()}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-invalid={!!p.phrase && !p.matches}
          aria-describedby={`${hintId} ${whyId}`}
          disabled={!!p.busy}
          style={{ height: compact ? 48 : 50, fontSize: compact ? 17 : 18, borderColor: border }}
        />
        <span id={hintId} aria-live="polite" style={{ font: "500 12.5px/1.2 'Manrope',sans-serif", color: p.matches ? "#9CC99A" : p.phrase ? "#FF8FAE" : "#E2BFCE" }}>
          {p.matches ? "✓ matches the database name" : p.phrase ? "Doesn’t match yet — it’s case-sensitive" : "Typing it is the confirmation. Pasting is disabled."}
        </span>
      </div>

      <div className="col" style={{ gap: 6 }}>
        <label htmlFor={cId} style={{ font: "500 12.5px/1.3 'Manrope',sans-serif", color: "#E2BFCE" }}>
          Comment <span style={{ opacity: 0.75 }}>· optional to approve, required to reject</span>
        </label>
        <textarea
          id={cId}
          ref={p.commentRef}
          className="inp"
          rows={compact ? 2 : 3}
          value={p.comment}
          onChange={(e) => p.setComment(e.target.value)}
          placeholder="e.g. Checked the archive counts with the team — go ahead."
          aria-invalid={p.needReason}
          disabled={!!p.busy}
          style={p.needReason ? { borderColor: "#FF8FAE" } : undefined}
        />
        {p.needReason && (
          <span role="alert" style={{ font: "500 12.5px/1.3 'Manrope',sans-serif", color: "#FF8FAE" }}>
            Add a reason so the requester knows what to change.
          </span>
        )}
      </div>

      <div id={whyId}>
        {p.blocks.length > 0 && (
          <ul className="why" aria-label="Why approve is disabled" style={{ margin: 0 }}>
            {p.blocks.map((b) => (
              <li key={b.text} style={b.sod ? { color: "#FFC2A1" } : undefined}>
                <span aria-hidden="true">{b.sod ? "△" : "·"}</span>
                <span>{b.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {p.err && (
        <div role="alert" className="row" style={{ gap: 10, padding: "12px 14px", borderRadius: 12, background: "rgba(255,143,174,.12)", border: "1px solid rgba(255,143,174,.45)", font: "500 13px/1.45 'Manrope',sans-serif", color: "#FFD3E0", alignItems: "flex-start" }}>
          <span aria-hidden="true">✕</span>
          <span>
            {p.err}
            <br />
            <span style={{ color: "#9CC99A" }}>Production was not modified.</span>
          </span>
        </div>
      )}

      {compact ? (
        <div className="col" style={{ gap: 10 }}>
          <button type="button" className="btn btn-lg btn-danger" style={{ height: 52 }} disabled={approveDisabled} aria-describedby={whyId} onClick={() => p.onDecide("approve")}>
            {p.busy === "approve" ? "Approving…" : "⛨ Approve & execute"}
          </button>
          <button type="button" className="btn" style={{ height: 44, background: "transparent", color: "#FFB3CE", borderColor: "#FFB3CE" }} disabled={!p.roleOk || !!p.busy} onClick={() => p.onDecide("reject")}>
            {p.busy === "reject" ? "Rejecting…" : "Reject"}
          </button>
        </div>
      ) : (
        <div className="row" style={{ gap: 10, marginTop: "auto" }}>
          <button type="button" className="btn" style={{ height: 52, background: "transparent", color: "#FFE9F1", borderColor: "rgba(255,233,241,.35)" }} disabled={!p.roleOk || !!p.busy} onClick={() => p.onDecide("reject")}>
            {p.busy === "reject" ? "Rejecting…" : "Reject"}
          </button>
          <button type="button" className="btn btn-lg btn-danger" style={{ flex: 1, height: 52, minWidth: 0 }} disabled={approveDisabled} aria-describedby={whyId} onClick={() => p.onDecide("approve")}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{p.busy === "approve" ? "Approving…" : `⛨ Approve & execute on ${r.connection_name}`}</span>
          </button>
        </div>
      )}
      {tfNote}
      <span style={{ font: "400 12px/1.4 'Manrope',sans-serif", color: "#E2BFCE", textAlign: "center" }}>
        No keyboard shortcut. A verified backup is taken before anything changes.
      </span>
    </>
  );

  if (compact) {
    return (
      <section className="adm-dz col" aria-label="Production decision" style={{ gap: 12, padding: 16, borderRadius: 14, background: "#2A1620", color: "#FFE9F1" }}>
        <span className="serif" style={{ fontSize: 24, lineHeight: 1.1 }}>{pending ? "You are about to modify production." : "Decision recorded."}</span>
        {form}
        {decided}
      </section>
    );
  }

  return (
    <section className="dz adm-dz" aria-label="Production decision">
      <div style={{ height: 8, background: "repeating-linear-gradient(135deg,#D94F87 0 8px,#2A1620 8px 14px)" }} aria-hidden="true" />
      <div className="col" style={{ padding: 28, gap: 18, flexGrow: 1 }}>
        <span style={{ font: "500 11px/1 'DM Mono',monospace", letterSpacing: ".2em", color: "#FFB3CE" }}>⛨ PRODUCTION CHANGE</span>
        <span className="serif" style={{ fontSize: 40, lineHeight: 1.05 }}>{pending ? "You are about to modify production." : "Decision recorded."}</span>
        <div className="col">
          <div className="pk"><span>Database</span><span>{r.connection_name}</span></div>
          <div className="pk"><span>Migration</span><span>{r.name} · V{r.version}</span></div>
          <div className="pk"><span>Risk score</span><span>{pad(r.risk)} · {riskWord(r.risk)}</span></div>
          <div className="pk"><span>Checks</span><span>{okCount} of {a.checklist.length} passed</span></div>
          <div className="pk" style={{ border: 0 }}><span>If verification fails</span><span>stop · offer restore</span></div>
        </div>
        {form}
        {decided}
        {!pending && tfNote}
      </div>
    </section>
  );
}
