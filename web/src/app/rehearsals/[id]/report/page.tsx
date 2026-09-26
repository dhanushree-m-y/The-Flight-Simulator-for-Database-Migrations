"use client";

import "@/components/rehearsal/rehearsal.css";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { toast } from "sonner";
import { TopBar } from "@/components/shell/AppShell";
import { useShell } from "@/components/shell/ShellContext";
import { EmptyBlock, ErrorBlock, LoadingBlock, RiskBar, Skeleton, SqlCode } from "@/components/ui";
import {
  bandVar,
  checkChip,
  GROUP_LABEL,
  isLive,
  issuesOf,
  lineDiff,
  shortHash,
  useCountUp,
  verdictOf,
} from "@/components/rehearsal/util";
import { api, API_URL, ApiError, useApi } from "@/lib/api";
import { fmtDuration, fmtInt, fmtTime, pad2 } from "@/lib/format";
import type { AiFixState, Approval, Check, Rehearsal, RiskPart } from "@/lib/types";

const CREAM = "#FFF8F3";

export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const { dark } = useShell();
  const { data: r, error, loading, reload } = useApi<Rehearsal>(`/api/rehearsals/${id}`);
  const live = isLive(r?.status);

  // still rehearsing → keep the page fresh so the report appears the moment it lands
  useEffect(() => {
    if (!live) return;
    const t = setInterval(reload, 3000);
    return () => clearInterval(t);
  }, [live, reload]);

  const crumbs = [
    <Link key="r" href="/rehearsals" style={{ textDecoration: "none" }}>
      Rehearsals
    </Link>,
    r ? (
      <Link key="n" href={`/rehearsals/${id}`} style={{ textDecoration: "none" }}>
        {r.name}
      </Link>
    ) : (
      "…"
    ),
    r ? `Report · V${r.version}` : "Report",
  ];

  if (!r || live) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <>
        <TopBar crumbs={crumbs} env={{ kind: "sandbox", id: r?.sandbox?.id }} />
        <div className="pg-report page" style={{ paddingTop: 40, gap: 28 }}>
          {r && live ? (
            <EmptyBlock
              title="Still rehearsing…"
              body={`${r.name} is running in ${r.sandbox?.id ?? "a fresh sandbox"}. The report is written when every check has finished — this page refreshes on its own.`}
              action={
                <Link href={`/rehearsals/${id}`} className="btn btn-p">
                  ◉ Watch it live
                </Link>
              }
            />
          ) : loading || (!error && !r) ? (
            <>
              <div className="row" style={{ gap: 48, alignItems: "flex-end" }}>
                <Skeleton h={150} w={300} />
                <div className="col" style={{ gap: 14, flex: 1 }}>
                  <Skeleton h={14} w="40%" />
                  <Skeleton h={52} w="90%" />
                  <Skeleton h={52} w="70%" />
                </div>
              </div>
              <LoadingBlock lines={5} />
              <LoadingBlock lines={4} />
            </>
          ) : notFound ? (
            <EmptyBlock
              title="Report not found"
              body="This rehearsal doesn’t exist, or it was deleted."
              action={
                <Link href="/rehearsals" className="btn btn-sm">
                  Back to rehearsals
                </Link>
              }
            />
          ) : (
            <ErrorBlock error={error} onRetry={reload} />
          )}
        </div>
      </>
    );
  }

  return <Report r={r} id={id} dark={dark} crumbs={crumbs} />;
}

/* ================================================================== report body */

function Report({ r, id, dark, crumbs }: { r: Rehearsal; id: string; dark: boolean; crumbs: ReactNode[] }) {
  const router = useRouter();
  const v = verdictOf(r.status);
  const issues = issuesOf(r.checks);
  const passed = r.checks.filter((c) => c.status === "pass").length;
  const affectedSum = issues.reduce((s, c) => s + c.affected_rows, 0);
  const top = [...issues].sort((a, b) => (a.status === b.status ? b.affected_rows - a.affected_rows : a.status === "fail" ? -1 : 1))[0] ?? null;
  const rb = r.rollback;
  const rbMatch = rb && rb.status !== "skipped" && rb.tables.length ? Math.round((rb.tables.filter((t) => t.identical).length / rb.tables.length) * 100) : rb?.status === "passed" ? 100 : null;
  const canFix = r.status === "blocked" || r.status === "warning";
  const canApprove = r.status === "passed";
  const errored = r.status === "failed" || r.status === "cancelled";
  const onSunset = (c: string) => (dark ? c : CREAM);

  // count-up on arrival, like the design
  const risk = useCountUp(r.risk ?? 0, 1800);
  const rows = useCountUp(r.metrics.rows_scanned, 1800);
  const issuesN = useCountUp(issues.length, 1800);
  const match = useCountUp(rbMatch ?? 0, 1800);

  const [openWhy, setOpenWhy] = useState(false);
  const [openChecks, setOpenChecks] = useState<Set<string>>(() => new Set(top ? [top.id] : []));
  const [busy, setBusy] = useState<"fix" | "approve" | null>(null);
  const [apprOpen, setApprOpen] = useState(false);
  const [comment, setComment] = useState("");
  const ctaRef = useRef<HTMLDivElement>(null);
  const commentRef = useRef<HTMLTextAreaElement>(null);

  const toggleCheck = (cid: string, force?: boolean) =>
    setOpenChecks((s) => {
      const n = new Set(s);
      if (force ?? !n.has(cid)) n.add(cid);
      else n.delete(cid);
      return n;
    });
  const jumpTo = (c: Check) => {
    toggleCheck(c.id, true);
    requestAnimationFrame(() => document.getElementById(`check-${c.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };

  const suggestFix = async () => {
    setBusy("fix");
    try {
      await api<AiFixState>(`/api/rehearsals/${id}/fix`, { method: "POST" });
      toast.success("DryRun is drafting a safer migration…");
      router.push(`/rehearsals/${id}/fix`);
    } catch (e) {
      toast.error(`Couldn’t start the AI fix: ${(e as Error).message}`);
      setBusy(null);
    }
  };
  const openApproval = () => {
    setApprOpen(true);
    requestAnimationFrame(() => {
      ctaRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      commentRef.current?.focus({ preventScroll: true });
    });
  };
  const requestApproval = async () => {
    setBusy("approve");
    try {
      const a = await api<Approval>(`/api/rehearsals/${id}/request-approval`, { method: "POST", json: { comment: comment.trim() || null } });
      toast.success("Approval requested — approvers have been notified.");
      router.push(`/approvals/${a.id}`);
    } catch (e) {
      toast.error(`Couldn’t request approval: ${(e as Error).message}`);
      setBusy(null);
    }
  };
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(r, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${r.name}-v${r.version}-report.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success("Report exported");
  };

  const primary = canFix ? (
    <button type="button" className="btn btn-sm btn-ai btn-spark" style={{ marginLeft: "auto" }} onClick={suggestFix} disabled={busy !== null}>
      {busy === "fix" ? "Starting…" : "◇ Suggest a fix with AI"}
    </button>
  ) : canApprove ? (
    <button type="button" className="btn btn-sm btn-p" style={{ marginLeft: "auto" }} onClick={openApproval} disabled={busy !== null}>
      Request production approval
    </button>
  ) : (
    <Link href={`/rehearsals/${id}`} className="btn btn-sm" style={{ marginLeft: "auto" }}>
      View rehearsal
    </Link>
  );

  const headline = r.ai?.headline ?? r.headline ?? (errored ? (r.status === "failed" ? "The rehearsal couldn’t finish." : "The rehearsal was aborted.") : "Rehearsal complete.");
  const sb = r.sandbox;

  return (
    <>
      <TopBar
        crumbs={crumbs}
        env={{ kind: "sandbox", id: sb ? `${sb.id}${sb.status === "destroyed" ? " · deleted" : ""}` : null }}
        right={
          <>
            {r.agent?.url && (
              <a className="btn btn-sm" href={r.agent.url} target="_blank" rel="noopener noreferrer">
                <span style={{ color: "var(--purple-ink)" }} aria-hidden="true">
                  ◇
                </span>
                Open in TrueForge ↗
              </a>
            )}
            <span className="st st-safe">✓ production unchanged</span>
            <a className="btn btn-sm" href={`${API_URL}/api/rehearsals/${r.id}/report.md`} download>
              Download report
            </a>
            <button type="button" className="btn btn-sm" onClick={exportJson}>
              JSON
            </button>
          </>
        }
      />
      <div className="pg-report page" style={{ gap: 40 }}>
        {/* sticky verdict bar */}
        <div
          className="verdict"
          role="status"
          aria-label={`Verdict: ${v.label.replace(/^\W+\s*/, "")}. Risk ${r.risk ?? "unknown"} of 100. ${top ? `${top.affected_rows} rows: ${top.title}.` : ""} Rollback ${rb?.identical ? "verified" : rb?.status ?? "not run"}.`}
        >
          <span className={v.cls}>{v.label}</span>
          <span className="mono" style={{ fontSize: 13, whiteSpace: "nowrap" }}>
            {r.name}
          </span>
          <span className="vsep" />
          <span style={{ font: "500 13.5px/1 'Manrope',sans-serif", whiteSpace: "nowrap" }}>
            Risk{" "}
            <b className="serif" style={{ fontSize: 24, fontWeight: 400, color: bandVar(r.risk) }}>
              {r.risk ?? "—"}
            </b>
            <span className="muted">/100</span>
          </span>
          <span className="vsep" />
          <span style={{ font: "500 13.5px/1 'Manrope',sans-serif", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 360 }}>
            {top ? `${fmtInt(top.affected_rows)} · ${top.title}` : errored ? r.error ?? "no result" : `all ${r.checks.length} checks passed`}
          </span>
          <span className="vsep" />
          <span
            style={{
              font: "500 13.5px/1 'Manrope',sans-serif",
              whiteSpace: "nowrap",
              color: rb?.identical ? "var(--green)" : rb?.status === "failed" ? "var(--danger)" : "var(--text2)",
            }}
          >
            ↺ rollback {rb?.identical ? "verified" : rb?.status === "failed" ? "failed" : "not verified"}
          </span>
          {primary}
        </div>

        {/* hero */}
        <div className="rp-hero">
          <div className="col" style={{ gap: 14 }}>
            <span className="mono" style={{ fontSize: 15 }}>
              {r.name} · V{r.version}
            </span>
            <span className={v.cls} style={{ alignSelf: "flex-start", height: 34, fontSize: 13, padding: "0 14px" }}>
              {v.label}
            </span>
            <div className="row" style={{ alignItems: "flex-end", gap: 10 }} aria-label={`Risk ${r.risk ?? "unknown"} out of 100`}>
              <span className="serif tab rp-risk" style={{ fontSize: 120, lineHeight: 0.85, color: onSunset(bandVar(r.risk)) }} aria-hidden="true">
                {r.risk == null ? "—" : pad2(Math.round(risk))}
              </span>
              <div className="col" style={{ gap: 6, paddingBottom: 10 }} aria-hidden="true">
                <span className="serif" style={{ fontSize: 28, lineHeight: 1, color: "var(--text2)" }}>
                  /100
                </span>
                <span className="eyebrow">risk</span>
              </div>
            </div>
          </div>
          <div className="col" style={{ gap: 16, paddingBottom: 10 }}>
            <span className="eyebrow">
              Rehearsal report · V{r.version} · {fmtTime(r.created_at)} – {fmtTime(r.finished_at)} · {fmtDuration(r.duration_ms)}
              {sb ? ` · ${sb.id}` : ""}
            </span>
            <h1 className="serif rp-headline" style={{ fontSize: 30, lineHeight: 1.25, letterSpacing: "-.015em", margin: 0 }}>
              {headline}
            </h1>
            {r.risk_parts.length > 0 && (
              <div style={{ maxWidth: 520 }}>
                <RiskBar parts={r.risk_parts} />
              </div>
            )}
          </div>
        </div>

        {errored && (
          <div className="glass row" role="alert" style={{ padding: "22px 26px", gap: 16, flexWrap: "wrap" }}>
            <span className={v.cls}>{v.label}</span>
            <span className="col" style={{ gap: 4, flex: "1 1 320px" }}>
              <span style={{ font: "500 15px/1.45 'Manrope',sans-serif" }}>
                {r.status === "failed" ? r.error ?? "DryRun itself hit an error while rehearsing." : "Someone aborted this rehearsal before it finished."}
              </span>
              <span className="mono muted" style={{ fontSize: 12 }}>
                Production was not modified. Findings below are partial.
              </span>
            </span>
            <Link href={`/rehearsals/${id}`} className="btn btn-sm">
              Open rehearsal log
            </Link>
            <Link href="/rehearsals/new" className="btn btn-sm btn-p">
              New rehearsal
            </Link>
          </div>
        )}

        {/* headline metrics */}
        <div className="rp-metrics" style={{ padding: "22px 0", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
          <div className="hm" style={{ flex: 1 }}>
            <span className="num tab">{fmtInt(Math.round(rows))}</span>
            <span className="eyebrow">rows checked · {r.metrics.tables} tables</span>
          </div>
          <div className="hm" style={{ flex: 1 }}>
            <span className="num tab" style={{ color: onSunset(issues.length ? "var(--danger)" : "var(--green)") }}>
              {pad2(Math.round(issuesN))}
            </span>
            <span className="eyebrow">issues · {fmtInt(affectedSum)} rows</span>
          </div>
          <div className="hm" style={{ flex: 1 }}>
            <span className="num tab">
              {passed}
              <span style={{ fontSize: 28, color: "var(--text2)" }}>/{r.checks.length}</span>
            </span>
            <span className="eyebrow">checks passed</span>
          </div>
          <div className="hm" style={{ flex: 1 }}>
            <span className="num tab" style={{ color: onSunset(rbMatch === 100 ? "var(--green)" : "var(--danger)") }}>
              {rbMatch == null ? "—" : `${Math.round(match)}%`}
            </span>
            <span className="eyebrow">rollback match</span>
          </div>
        </div>

        {/* fingerprint + AI */}
        <div className="rp-2">
          <div className="glass" style={{ padding: "24px 28px" }}>
            <div className="row" style={{ justifyContent: "space-between", paddingBottom: 6, gap: 12 }}>
              <h2 className="h2" style={{ margin: 0 }}>
                Risk fingerprint
              </h2>
              {(r.risk_parts.length > 0 || issues.length > 0) && (
                <button type="button" className="btn btn-sm" onClick={() => setOpenWhy((o) => !o)} aria-expanded={openWhy} aria-controls="why-list">
                  {openWhy ? "Hide evidence" : `Why ${r.risk ?? "this score"}?`}
                </button>
              )}
            </div>
            <Fingerprint parts={r.risk_parts} r={r} />
            {openWhy && <WhyList id="why-list" r={r} issues={issues} onCite={jumpTo} />}
          </div>

          <div className="col" style={{ gap: 20 }}>
            <div
              className="glass"
              style={{
                padding: "24px 26px",
                display: "flex",
                flexDirection: "column",
                gap: 12,
                background: dark ? "rgba(50,39,72,.55)" : "rgba(238,231,255,.55)",
                borderColor: "rgba(119,88,200,.22)",
              }}
            >
              <span className="st st-ai" style={{ alignSelf: "flex-start" }}>
                ◇ AI explanation · grounded in {issues.length || r.checks.length} check{(issues.length || r.checks.length) === 1 ? "" : "s"}
              </span>
              {r.ai ? (
                <AiSummaryText text={r.ai.summary} checks={r.checks} onCite={jumpTo} />
              ) : (
                <span style={{ font: "400 15px/1.6 'Manrope',sans-serif", color: "var(--text2)" }}>
                  No AI explanation was produced for this rehearsal. The deterministic checks below are the full record.
                </span>
              )}
              <div className="row mono muted" style={{ gap: 10, fontSize: 11.5, flexWrap: "wrap" }}>
                <span>
                  {r.ai?.model ?? r.agent?.model ?? "model unknown"} · {r.agent?.provider === "trueforge" ? "TrueForge agent" : "DryRun agent"}
                </span>
                {r.agent?.url && (
                  <a href={r.agent.url} target="_blank" rel="noopener noreferrer" className="cite" style={{ marginLeft: "auto" }}>
                    Open in TrueForge ↗
                  </a>
                )}
              </div>
            </div>
            {top ? <SpotlightCheck c={top} id={id} /> : <AllClear r={r} />}
          </div>
        </div>

        {/* checks */}
        <section className="panel col" aria-labelledby="checks-h">
          <div className="row" style={{ padding: "16px 18px", gap: 12, flexWrap: "wrap", borderBottom: "1px solid var(--line)" }}>
            <h2 id="checks-h" className="h2" style={{ fontSize: 24, margin: 0 }}>
              Checks
            </h2>
            <span className="mono muted" style={{ fontSize: 12 }}>
              {r.checks.length} run · {r.checks.filter((c) => c.status === "fail").length} failed · {r.checks.filter((c) => c.status === "warn").length} warnings
            </span>
            <Link href={`/rehearsals/${id}/rows`} className="btn btn-sm" style={{ marginLeft: "auto" }}>
              Open row explorer →
            </Link>
          </div>
          {r.checks.length === 0 ? (
            <div className="state-box muted">No checks were recorded.</div>
          ) : (
            (["data", "constraint", "performance", "ai"] as Check["group"][]).map((g) => {
              const list = r.checks.filter((c) => c.group === g);
              if (!list.length) return null;
              const bad = list.filter((c) => c.status !== "pass").length;
              return (
                <div key={g}>
                  <div className="ck-group row" style={{ gap: 10 }}>
                    <span className="eyebrow" style={g === "ai" ? { color: "var(--purple-ink)" } : undefined}>
                      {g === "ai" ? "◇ " : ""}
                      {GROUP_LABEL[g]}
                    </span>
                    <span className="mono muted" style={{ fontSize: 11 }}>
                      {list.length} · {bad ? `${bad} flagged` : "all pass"}
                    </span>
                  </div>
                  {list.map((c) => (
                    <CheckRow key={c.id} c={c} id={id} open={openChecks.has(c.id)} onToggle={() => toggleCheck(c.id)} />
                  ))}
                </div>
              );
            })
          )}
        </section>

        {/* before → after + rollback */}
        <div className="rp-2b">
          <BeforeAfter r={r} id={id} />
          <RollbackCard r={r} id={id} dark={dark} match={rbMatch} />
        </div>

        {/* schema diff */}
        {r.schema_diff.length > 0 && (
          <section className="col" style={{ gap: 14 }} aria-labelledby="schema-h">
            <div className="row" style={{ gap: 12 }}>
              <h2 id="schema-h" className="h2" style={{ margin: 0 }}>
                Schema diff
              </h2>
              <span className="mono muted" style={{ fontSize: 12 }}>
                {r.schema_diff.length} table{r.schema_diff.length === 1 ? "" : "s"} changed
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,460px),1fr))", gap: 20 }}>
              {r.schema_diff.map((d) => (
                <SchemaDiffCard key={d.table} table={d.table} before={d.before} after={d.after} />
              ))}
            </div>
          </section>
        )}

        {/* locks + policies */}
        <div className="rp-2">
          <LocksPanel r={r} />
          <PolicyPanel r={r} />
        </div>

        {/* evidence */}
        <nav className="col" style={{ gap: 12 }} aria-label="Evidence">
          <span className="eyebrow">Go deeper · every claim has evidence</span>
          <div className="ev-links">
            <Link href={`/rehearsals/${id}/rows`} className="btn">
              Row explorer →
            </Link>
            <Link href={`/rehearsals/${id}/impact`} className="btn">
              Impact map →
            </Link>
            <Link href={`/rehearsals/${id}/rollback`} className="btn">
              Rollback proof →
            </Link>
            <Link href={`/rehearsals/${id}/lineage`} className="btn">
              Lineage · V{r.version} →
            </Link>
          </div>
        </nav>

        {/* CTA */}
        <div className="cta-dark" ref={ctaRef}>
          <span className="serif" style={{ fontSize: 30, lineHeight: 1.1 }}>
            {canFix ? "What should I change to make it safe?" : canApprove ? "Ready for production." : "Want to try again?"}
          </span>
          <div className="row" style={{ gap: 10, marginLeft: "auto", flexWrap: "wrap" }}>
            {r.approval_status && <span className="st st-info" style={{ color: "#D8CCD9" }}>approval · {r.approval_status.replace("_", " ")}</span>}
            {canFix && (
              <button type="button" className="btn btn-ai btn-lg btn-spark" onClick={suggestFix} disabled={busy !== null}>
                {busy === "fix" ? "Starting the AI fix…" : "◇ Suggest a fix with AI"}
              </button>
            )}
            {canApprove && !apprOpen && (
              <button type="button" className="btn btn-p btn-lg btn-spark" onClick={openApproval}>
                Request production approval
              </button>
            )}
            {errored && (
              <Link href="/rehearsals/new" className="btn btn-p btn-lg">
                Start a new rehearsal
              </Link>
            )}
          </div>
          {canApprove && apprOpen && (
            <form
              className="appr-box rise"
              onSubmit={(e) => {
                e.preventDefault();
                requestApproval();
              }}
            >
              <label htmlFor="appr-comment" className="eyebrow" style={{ color: "#D8CCD9" }}>
                Note for the approver (optional)
              </label>
              <textarea
                id="appr-comment"
                ref={commentRef}
                className="inp"
                rows={3}
                maxLength={1000}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="e.g. Applies during tonight’s maintenance window."
              />
              <div className="row" style={{ gap: 10, justifyContent: "flex-end" }}>
                <button type="button" className="btn btn-sm" onClick={() => setApprOpen(false)} disabled={busy !== null}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-p" disabled={busy !== null}>
                  {busy === "approve" ? "Requesting…" : "Send approval request"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </>
  );
}

/* ================================================================== pieces */

const KIND_COLOR: Record<RiskPart["kind"], string> = {
  data_loss: "var(--danger)",
  constraint: "var(--danger)",
  policy: "var(--peach-ink)",
  lock: "var(--purple-ink)",
  rollback: "var(--green)",
  ai: "var(--purple-ink)",
  other: "var(--text2)",
};
const KIND_BAR: Record<RiskPart["kind"], string> = {
  data_loss: "linear-gradient(90deg,#F4B8CC,#D94F87)",
  constraint: "linear-gradient(90deg,#F4B8CC,#D94F87)",
  policy: "#F7C59F",
  lock: "#CBB8F6",
  rollback: "#BFD9B5",
  ai: "linear-gradient(90deg,#CBB8F6,#7758C8)",
  other: "#E6D9E5",
};
const KIND_GROUP: Partial<Record<RiskPart["kind"], Check["group"]>> = { data_loss: "data", constraint: "constraint", lock: "performance", ai: "ai" };

function level(points: number): { text: string; color: string } {
  if (points >= 25) return { text: "✕ High", color: "var(--danger)" };
  if (points >= 10) return { text: "△ Review", color: "var(--peach-ink)" };
  if (points > 0) return { text: "Low", color: "var(--purple-ink)" };
  return { text: "✓ Clear", color: "var(--green)" };
}

function Fingerprint({ parts, r }: { parts: RiskPart[]; r: Rehearsal }) {
  const maxLock = r.locks.reduce((m, l) => Math.max(m, l.duration_ms), 0);
  const hasRollbackPart = parts.some((p) => p.kind === "rollback");
  const rb = r.rollback;
  if (!parts.length && !rb) return <div className="state-box muted">No risk factors were recorded.</div>;
  return (
    <div>
      {parts.map((p, i) => {
        const lv = level(p.points);
        const w = Math.max(p.points > 0 ? 6 : 2, Math.min(100, p.points * 2.5));
        return (
          <div key={`${p.kind}-${i}`} className="fp" style={!rb || hasRollbackPart ? (i === parts.length - 1 ? { border: 0 } : undefined) : undefined}>
            <span className="lb">{p.label}</span>
            <div className="tr2" role="meter" aria-valuemin={0} aria-valuemax={40} aria-valuenow={p.points} aria-label={`${p.label}: ${p.points} risk points`}>
              <i className="grow-x" style={{ width: `${w}%`, background: KIND_BAR[p.kind], animationDelay: `${i * 0.15}s` }} />
            </div>
            <span className="lv" style={{ color: lv.color }}>
              {p.kind === "lock" && maxLock > 0 ? `${lv.text.replace(/^✓ Clear$/, "Low")} · ${fmtDuration(maxLock)}` : lv.text}
            </span>
          </div>
        );
      })}
      {!hasRollbackPart && rb && (
        <div className="fp" style={{ border: 0 }}>
          <span className="lb">Rollback</span>
          <div className="tr2">
            <i
              style={{
                width: "100%",
                background:
                  rb.status === "failed"
                    ? "repeating-linear-gradient(90deg,#F4B8CC 0 6px,transparent 6px 10px)"
                    : rb.status === "skipped"
                      ? "repeating-linear-gradient(90deg,rgba(120,50,80,.15) 0 6px,transparent 6px 10px)"
                      : "repeating-linear-gradient(90deg,#BFD9B5 0 6px,transparent 6px 10px)",
              }}
            />
          </div>
          <span className="lv" style={{ color: rb.identical ? "var(--green)" : rb.status === "failed" ? "var(--danger)" : "var(--text2)" }}>
            {rb.identical ? "✓ Verified" : rb.status === "failed" ? "✕ Failed" : "Skipped"}
          </span>
        </div>
      )}
    </div>
  );
}

function WhyList({ id, r, issues, onCite }: { id: string; r: Rehearsal; issues: Check[]; onCite: (c: Check) => void }) {
  const used = new Set<string>();
  const cite = (p: RiskPart) => {
    const g = KIND_GROUP[p.kind];
    const c = issues.find((x) => !used.has(x.id) && (g ? x.group === g : true));
    if (c) used.add(c.id);
    return c ?? null;
  };
  const rows = r.risk_parts.map((p) => ({ p, c: cite(p) }));
  const rest = issues.filter((c) => !used.has(c.id));
  return (
    <div id={id} className="col rise" style={{ marginTop: 14, paddingTop: 6, borderTop: "1px dashed var(--line2)" }}>
      <span className="eyebrow" style={{ padding: "10px 0 4px" }}>
        Why {r.risk ?? "this score"} · every point traced to a check
      </span>
      {rows.map(({ p, c }, i) => (
        <div key={i} className="why">
          <b style={{ color: KIND_COLOR[p.kind] }}>+{p.points}</b>
          <span>{p.label}</span>
          {c ? (
            <button type="button" className="cite" style={{ border: 0, cursor: "pointer" }} onClick={() => onCite(c)}>
              {c.key}
            </button>
          ) : (
            <span className="cite">{p.kind.replace("_", " ")}</span>
          )}
        </div>
      ))}
      {rest.map((c) => (
        <div key={c.id} className="why">
          <b style={{ color: c.status === "fail" ? "var(--danger)" : "var(--peach-ink)" }}>{c.status === "fail" ? "✕" : "△"}</b>
          <span>
            {c.title}
            {c.affected_rows > 0 && <span className="muted"> · {fmtInt(c.affected_rows)} rows</span>}
          </span>
          <button type="button" className="cite" style={{ border: 0, cursor: "pointer" }} onClick={() => onCite(c)}>
            {c.key}
          </button>
        </div>
      ))}
      {r.rollback && (
        <div className="why" style={{ border: 0 }}>
          <b style={{ color: r.rollback.identical ? "var(--green)" : "var(--danger)" }}>{r.rollback.identical ? "+0" : "!"}</b>
          <span>{r.rollback.identical ? "Rollback identical" : r.rollback.message ?? `Rollback ${r.rollback.status}`}</span>
          <span className="cite">hash {shortHash(r.rollback.tables[0]?.checksum_after)}</span>
        </div>
      )}
    </div>
  );
}

/** AI summary with inline citation chips wherever a check key is mentioned. */
function AiSummaryText({ text, checks, onCite }: { text: string; checks: Check[]; onCite: (c: Check) => void }) {
  const keys = checks.map((c) => c.key).filter((k) => k.length > 2).sort((a, b) => b.length - a.length);
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = keys.length ? text.split(new RegExp(`(${keys.map(esc).join("|")}|\`[^\`]+\`)`, "g")) : [text];
  return (
    <p style={{ font: "400 15.5px/1.65 'Manrope',sans-serif", margin: 0 }}>
      {parts.map((s, i) => {
        const c = checks.find((x) => x.key === s);
        if (c)
          return (
            <button key={i} type="button" className="cite" style={{ border: 0, cursor: "pointer" }} onClick={() => onCite(c)}>
              {s}
            </button>
          );
        if (/^`[^`]+`$/.test(s))
          return (
            <span key={i} className="mono">
              {s.slice(1, -1)}
            </span>
          );
        return <span key={i}>{s}</span>;
      })}
    </p>
  );
}

function SpotlightCheck({ c, id }: { c: Check; id: string }) {
  const fail = c.status === "fail";
  return (
    <div className="panel" style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        {c.group === "ai" ? <span className="st st-ai">◇ AI check</span> : <span className="st st-info">{GROUP_LABEL[c.group]}</span>}
        <span className="mono" style={{ fontSize: 13 }}>
          {c.key}
        </span>
        <span className={fail ? "st st-block" : "st st-review"} style={{ marginLeft: "auto" }}>
          {fail ? "✕" : "△"} {fmtInt(c.affected_rows)} rows
        </span>
      </div>
      <span style={{ font: "400 13px/1.5 'Manrope',sans-serif", color: "var(--text2)" }}>
        <b style={{ color: "var(--text)" }}>{c.title}.</b> {c.explanation}
      </span>
      {c.sql && <SqlCode sql={c.sql} style={{ fontSize: 12.5, lineHeight: 1.7 }} />}
      {c.has_rows && (
        <Link href={`/rehearsals/${id}/rows?check=${encodeURIComponent(c.id)}`} className="btn btn-sm" style={{ alignSelf: "flex-start" }}>
          Inspect {fmtInt(c.affected_rows)} rows →
        </Link>
      )}
    </div>
  );
}

function AllClear({ r }: { r: Rehearsal }) {
  return (
    <div className="panel" style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="row" style={{ gap: 10 }}>
        <span className="st st-safe">✓ all clear</span>
        <span className="mono muted" style={{ fontSize: 12 }}>
          {r.checks.length} checks · 0 flagged
        </span>
      </div>
      <span style={{ font: "400 13.5px/1.5 'Manrope',sans-serif", color: "var(--text2)" }}>
        Every deterministic and AI check passed on a full copy of production data.
      </span>
    </div>
  );
}

function CheckRow({ c, id, open, onToggle }: { c: Check; id: string; open: boolean; onToggle: () => void }) {
  const chip = checkChip(c);
  const where = [c.table, c.column].filter(Boolean).join(".");
  const changed = c.before != null && c.after != null && c.before !== c.after;
  return (
    <div id={`check-${c.id}`} style={{ scrollMarginTop: 80 }}>
      <button type="button" className="ck-row" aria-expanded={open} aria-controls={`ck-${c.id}`} onClick={onToggle}>
        <span className={chip.cls} style={{ justifySelf: "start" }}>
          {chip.label}
        </span>
        <span style={{ minWidth: 0 }}>
          {c.title}
          <span className="mono muted" style={{ fontSize: 11, marginLeft: 8 }}>
            {c.key}
          </span>
        </span>
        <span className="mono muted ck-where" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {where || "—"}
        </span>
        <span className="mono ck-aff" style={{ fontSize: 12, textAlign: "right", color: c.status === "pass" ? "var(--text2)" : undefined }}>
          {c.affected_rows ? `${fmtInt(c.affected_rows)} rows` : "—"}
        </span>
        <span className="chev" aria-hidden="true">
          ›
        </span>
      </button>
      {open && (
        <div id={`ck-${c.id}`} className="ck-body rise">
          {(c.before != null || c.after != null) && (
            <div className="row mono" style={{ gap: 10, fontSize: 13, flexWrap: "wrap" }}>
              <span className="eyebrow">Before → after</span>
              <span>{c.before ?? "—"}</span>
              <span className="muted">→</span>
              <span className={changed ? (c.status === "pass" ? "add" : "cut") : undefined} style={{ padding: "1px 4px" }}>
                {c.after ?? "—"}
              </span>
            </div>
          )}
          {c.explanation && <span style={{ font: "400 14px/1.6 'Manrope',sans-serif", color: "var(--text2)", maxWidth: 820 }}>{c.explanation}</span>}
          {c.sql && <SqlCode sql={c.sql} style={{ fontSize: 12.5 }} />}
          {c.has_rows && (
            <Link href={`/rehearsals/${id}/rows?check=${encodeURIComponent(c.id)}`} className="btn btn-sm" style={{ alignSelf: "flex-start" }}>
              Inspect evidence rows →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function BeforeAfter({ r, id }: { r: Rehearsal; id: string }) {
  const rows = r.checks.filter((c) => c.before != null || c.after != null);
  const cols: CSSProperties = { gridTemplateColumns: "minmax(0,1.4fr) minmax(0,.8fr) minmax(0,1fr)" };
  return (
    <section className="panel col" aria-labelledby="ba-h">
      <div className="row" style={{ padding: "16px 18px", gap: 12, flexWrap: "wrap" }}>
        <h2 id="ba-h" className="h2" style={{ fontSize: 24, margin: 0 }}>
          Before → after
        </h2>
        <span className="mono muted" style={{ fontSize: 12 }}>
          {rows.length} measured
        </span>
        <Link href={`/rehearsals/${id}/rows`} className="btn btn-sm" style={{ marginLeft: "auto" }}>
          Open row explorer →
        </Link>
      </div>
      <div className="dg th" style={{ ...cols, font: "500 10.5px/1 'DM Mono',monospace", letterSpacing: ".14em", color: "var(--text2)" }}>
        <span>MEASURE</span>
        <span>BEFORE</span>
        <span>AFTER</span>
      </div>
      {rows.length === 0 ? (
        <div className="state-box muted" style={{ padding: 28 }}>
          No before/after measurements were recorded.
        </div>
      ) : (
        rows.map((c, i) => {
          const changed = c.before !== c.after;
          return (
            <div key={c.id} className="dg" style={{ ...cols, ...(i === rows.length - 1 ? { border: 0 } : null) }} title={c.title}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{[c.table, c.column].filter(Boolean).join(".") || c.key}</span>
              <span>{c.before ?? "—"}</span>
              <span>{changed ? <span className={c.status === "pass" ? "add" : "cut"} style={{ padding: "1px 3px" }}>{c.after ?? "—"}</span> : c.after ?? "—"}</span>
            </div>
          );
        })
      )}
    </section>
  );
}

function RollbackCard({ r, id, dark, match }: { r: Rehearsal; id: string; dark: boolean; match: number | null }) {
  const rb = r.rollback;
  const ok = !!rb?.identical;
  const failed = rb?.status === "failed";
  const bg = ok ? (dark ? "rgba(35,48,42,.6)" : "rgba(230,242,223,.6)") : failed ? (dark ? "rgba(58,26,40,.6)" : "rgba(251,227,236,.6)") : undefined;
  const border = ok ? "rgba(71,112,90,.25)" : failed ? "rgba(168,35,79,.25)" : undefined;
  const tone = ok ? "var(--green)" : failed ? "var(--danger)" : "var(--text2)";
  const before = rb?.tables.reduce((s, t) => s + t.rows_before, 0) ?? 0;
  const after = rb?.tables.reduce((s, t) => s + t.rows_after, 0) ?? 0;
  return (
    <section className="glass" style={{ padding: "24px 26px", display: "flex", flexDirection: "column", gap: 10, background: bg, borderColor: border }} aria-label="Rollback">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="eyebrow" style={{ color: tone }}>
          {ok ? "Rollback verified" : failed ? "Rollback failed" : "Rollback not verified"}
        </span>
        <span className={ok ? "st st-safe" : failed ? "st st-block" : "st st-info"}>{ok ? "✓ identical" : failed ? "✕ differs" : rb?.status ?? "not run"}</span>
      </div>
      {rb && rb.status !== "skipped" ? (
        <>
          <div className="row" style={{ alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
            <span className="serif" style={{ fontSize: 52, lineHeight: 0.9, color: tone }}>
              {match == null ? "—" : `${match}%`}
            </span>
            <span className="mono muted" style={{ fontSize: 12, paddingBottom: 8 }}>
              {fmtInt(after)} / {fmtInt(before)} rows restored
            </span>
          </div>
          {rb.tables.slice(0, 4).map((t) => (
            <div key={t.table} className="kv">
              <span>{t.table}</span>
              <span style={{ color: t.identical ? "var(--green)" : "var(--danger)" }}>
                {t.identical ? "MATCH" : "DIFF"} · {shortHash(t.checksum_after)} {t.identical ? "✓" : "✕"}
              </span>
            </div>
          ))}
          {rb.tables.length > 4 && <span className="mono muted" style={{ fontSize: 11.5 }}>+ {rb.tables.length - 4} more tables</span>}
          {rb.down_sql_source && (
            <div className="kv">
              <span>Down migration</span>
              <span>{rb.down_sql_source === "ai" ? "◇ AI-generated" : "provided by you"}</span>
            </div>
          )}
        </>
      ) : (
        <span style={{ font: "400 14px/1.55 'Manrope',sans-serif", color: "var(--text2)" }}>
          {rb?.message ?? "No rollback was rehearsed — add a down migration so DryRun can prove you can undo this."}
        </span>
      )}
      {rb?.message && rb.status !== "skipped" && <span style={{ font: "400 13px/1.5 'Manrope',sans-serif", color: "var(--text2)" }}>{rb.message}</span>}
      <Link href={`/rehearsals/${id}/rollback`} className="btn btn-sm" style={{ alignSelf: "flex-start" }}>
        Replay rollback proof
      </Link>
    </section>
  );
}

function SchemaDiffCard({ table, before, after }: { table: string; before: string; after: string }) {
  const lines = lineDiff(before, after);
  const marks: Record<number, "add" | "del"> = {};
  lines.forEach((l, i) => l.mark && (marks[i + 1] = l.mark));
  const adds = lines.filter((l) => l.mark === "add").length;
  const dels = lines.filter((l) => l.mark === "del").length;
  return (
    <div className="panel col" style={{ overflow: "hidden" }}>
      <div className="row" style={{ padding: "12px 16px", gap: 10 }}>
        <span className="mono" style={{ fontSize: 13 }}>
          {table}
        </span>
        <span className="mono" style={{ fontSize: 12, color: "var(--green)", marginLeft: "auto" }}>
          +{adds}
        </span>
        <span className="mono" style={{ fontSize: 12, color: "var(--danger)" }}>
          −{dels}
        </span>
      </div>
      <SqlCode sql={lines.map((l) => l.text).join("\n")} marks={marks} style={{ borderRadius: 0, border: 0, borderTop: "1px solid var(--line)" }} />
    </div>
  );
}

function LocksPanel({ r }: { r: Rehearsal }) {
  const cols: CSSProperties = { gridTemplateColumns: "minmax(0,1fr) minmax(0,1.2fr) 70px minmax(0,1fr)" };
  return (
    <section className="panel col" aria-labelledby="locks-h">
      <div className="row" style={{ padding: "16px 18px", gap: 12 }}>
        <h2 id="locks-h" className="h2" style={{ fontSize: 24, margin: 0 }}>
          Locks
        </h2>
        <span className="mono muted" style={{ fontSize: 12 }}>
          {r.locks.length ? `${r.locks.length} taken · longest ${fmtDuration(Math.max(...r.locks.map((l) => l.duration_ms)))}` : "none"}
        </span>
      </div>
      {r.locks.length === 0 ? (
        <div className="row" style={{ padding: "0 18px 18px", gap: 10 }}>
          <span className="st st-safe">✓ no blocking locks</span>
        </div>
      ) : (
        <>
          <div className="tr th" style={cols}>
            <span>Table</span>
            <span>Mode</span>
            <span>Held</span>
            <span>Blocks</span>
          </div>
          {r.locks.map((l, i) => (
            <div key={i} className="tr" style={{ ...cols, ...(i === r.locks.length - 1 ? { borderBottom: 0 } : null) }}>
              <span className="mono" style={{ fontSize: 12.5 }}>
                {l.table}
              </span>
              <span className="mono" style={{ fontSize: 12 }}>
                {l.mode}
              </span>
              <span className="mono tab" style={{ fontSize: 12.5 }} title={l.source === "measured" ? "measured in the sandbox" : "static estimate"}>
                {fmtDuration(l.duration_ms)}
                {l.source === "static" ? "*" : ""}
              </span>
              <span>
                {l.blocks_writes || l.blocks_reads ? (
                  <span className={l.blocks_reads ? "st st-block" : "st st-review"}>{l.blocks_reads ? "reads + writes" : "writes"}</span>
                ) : (
                  <span className="st st-safe">nothing</span>
                )}
              </span>
            </div>
          ))}
          {r.locks.some((l) => l.source === "static") && (
            <span className="mono muted" style={{ fontSize: 11, padding: "0 18px 14px" }}>
              * static estimate
            </span>
          )}
        </>
      )}
    </section>
  );
}

function PolicyPanel({ r }: { r: Rehearsal }) {
  const v = r.policy_violations;
  return (
    <section className="panel col" aria-labelledby="pol-h">
      <div className="row" style={{ padding: "16px 18px", gap: 12 }}>
        <h2 id="pol-h" className="h2" style={{ fontSize: 24, margin: 0 }}>
          Policies
        </h2>
        <span className="mono muted" style={{ fontSize: 12 }}>
          {v.length ? `${v.length} violation${v.length === 1 ? "" : "s"}` : "all satisfied"}
        </span>
        <Link href="/policies" className="btn btn-sm" style={{ marginLeft: "auto" }}>
          Policies →
        </Link>
      </div>
      {v.length === 0 ? (
        <div className="row" style={{ padding: "0 18px 18px", gap: 10 }}>
          <span className="st st-safe">✓ no policy violations</span>
        </div>
      ) : (
        v.map((p, i) => (
          <div key={`${p.policy_id}-${i}`} className="row" style={{ gap: 12, padding: "12px 18px", borderTop: "1px solid var(--line)", alignItems: "flex-start" }}>
            <span className={p.severity === "block" ? "st st-block" : p.severity === "review" ? "st st-review" : "st st-info"} style={{ flexShrink: 0 }}>
              {p.severity === "block" ? "✕ block" : p.severity === "review" ? "△ review" : "i info"}
            </span>
            <span className="col" style={{ gap: 3, minWidth: 0 }}>
              <span style={{ font: "600 13.5px/1.3 'Manrope',sans-serif" }}>{p.title}</span>
              <span style={{ font: "400 13px/1.5 'Manrope',sans-serif", color: "var(--text2)" }}>{p.message}</span>
            </span>
          </div>
        ))
      )}
    </section>
  );
}
