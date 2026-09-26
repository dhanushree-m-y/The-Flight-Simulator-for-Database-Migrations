"use client";

import "@/components/rehearsal/rehearsal.css";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { TopBar } from "@/components/shell/AppShell";
import { useShell } from "@/components/shell/ShellContext";
import { EmptyBlock, ErrorBlock, LoadingBlock, Skeleton } from "@/components/ui";
import { StageTimeline } from "@/components/rehearsal/StageTimeline";
import { ImpactMiniMap } from "@/components/rehearsal/ImpactMiniMap";
import { LiveLog } from "@/components/rehearsal/LiveLog";
import { bandVar, checkSeenAt, isLive, issuesOf, useCountUp, useNow, verdictOf } from "@/components/rehearsal/util";
import { api, ApiError, useApi, useEventStream } from "@/lib/api";
import { fmtDuration, fmtInt, fmtTime, pad2 } from "@/lib/format";
import type { AgentQuestion, Check, LiveEvent, Policy, Rehearsal, RehearsalStatus } from "@/lib/types";

const MAX_LOG = 3000;

/** Fold one SSE event into the rehearsal we hold. */
function applyEvent(prev: Rehearsal | null, e: LiveEvent): Rehearsal | null {
  if (e.type === "snapshot" || e.type === "done") return e.rehearsal;
  if (!prev) return prev;
  switch (e.type) {
    case "stage": {
      const has = prev.stages.some((s) => s.key === e.stage.key);
      return { ...prev, status: prev.status === "queued" ? "running" : prev.status, stages: has ? prev.stages.map((s) => (s.key === e.stage.key ? e.stage : s)) : [...prev.stages, e.stage] };
    }
    case "log": {
      const logs = prev.logs.length >= MAX_LOG ? [...prev.logs.slice(-MAX_LOG + 1), e.line] : [...prev.logs, e.line];
      return { ...prev, logs };
    }
    case "metrics":
      return { ...prev, metrics: e.metrics };
    case "check": {
      const has = prev.checks.some((c) => c.id === e.check.id);
      return { ...prev, checks: has ? prev.checks.map((c) => (c.id === e.check.id ? e.check : c)) : [...prev.checks, e.check] };
    }
    case "sandbox":
      return { ...prev, sandbox: e.sandbox };
    case "question":
      return { ...prev, question: e.question };
    default:
      return prev;
  }
}

function heroTitle(s: RehearsalStatus) {
  if (isLive(s)) return "Let’s find out what breaks.";
  if (s === "passed") return "Nothing broke.";
  if (s === "warning") return "Something needs a second look.";
  if (s === "blocked") return "Here’s what broke.";
  if (s === "cancelled") return "Rehearsal stopped.";
  return "The rehearsal couldn’t finish.";
}

export default function LiveRehearsalPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { dark } = useShell();
  const { data: r, error, loading, reload, setData } = useApi<Rehearsal>(`/api/rehearsals/${id}`);
  const live = isLive(r?.status);

  const metricsAt = useRef(Date.now());
  const seenAt = useRef(new Map<string, string>());
  const connected = useEventStream<LiveEvent>(live ? `/api/rehearsals/${id}/events` : null, (e) => {
    if (e.type === "snapshot" || e.type === "metrics" || e.type === "done") metricsAt.current = Date.now();
    if (e.type === "check" && e.check.status !== "pass" && !seenAt.current.has(e.check.id)) seenAt.current.set(e.check.id, new Date().toISOString());
    setData((prev) => applyEvent(prev, e));
  });

  // If the stream drops, keep the page honest by polling until it reconnects.
  useEffect(() => {
    if (!live || connected) return;
    const t = setInterval(() => {
      metricsAt.current = Date.now();
      reload();
    }, 4000);
    return () => clearInterval(t);
  }, [live, connected, reload]);

  // Detect the live → finished transition (from the stream's `done` or from polling).
  const wasLive = useRef(false);
  const prevStatus = useRef<RehearsalStatus | null>(null);
  const [finale, setFinale] = useState<Rehearsal | null>(null);
  const [stay, setStay] = useState(false);
  useEffect(() => {
    if (!r) return;
    if (isLive(r.status)) wasLive.current = true;
    else if (wasLive.current && prevStatus.current && isLive(prevStatus.current)) setFinale(r);
    prevStatus.current = r.status;
  }, [r]);

  useEffect(() => {
    if (!finale || stay || finale.status === "cancelled") return;
    const t = setTimeout(() => router.push(`/rehearsals/${id}/report`), 1600);
    return () => clearTimeout(t);
  }, [finale, stay, id, router]);

  const now = useNow(!!r && (live || (!!r.sandbox?.expires_at && r.sandbox.status !== "destroyed")), 1000);
  const policies = useApi<Policy[]>(r ? "/api/policies" : null);

  const crumbs = [
    <Link key="r" href="/rehearsals" style={{ textDecoration: "none" }}>
      Rehearsals
    </Link>,
    r ? `${r.name} · V${r.version}` : "…",
  ];

  if (!r) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <>
        <TopBar crumbs={crumbs} env={{ kind: "sandbox" }} />
        <div className={`pg-live page${dark ? " pg-livedark" : ""}`} style={{ paddingTop: 30 }}>
          {loading || (!error && !r) ? (
            <>
              <Skeleton h={72} w="60%" />
              <LoadingBlock lines={3} />
              <LoadingBlock lines={5} />
            </>
          ) : notFound ? (
            <EmptyBlock
              title="Rehearsal not found"
              body="It may have been deleted, or the link is wrong."
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

  const issues = issuesOf(r.checks);
  const latest = issues[issues.length - 1] ?? null;
  const earlier = issues.slice(0, -1).slice(-2).reverse();
  const m = r.metrics;
  const pct = m.rows_total > 0 ? Math.round((m.rows_scanned / m.rows_total) * 100) : null;
  const sbId = r.sandbox?.id ?? null;

  return (
    <>
      <TopBar
        crumbs={crumbs}
        env={{ kind: "sandbox", id: sbId }}
        right={
          <>
            {r.agent?.url && (
              <a className="btn btn-sm" href={r.agent.url} target="_blank" rel="noopener noreferrer" title={`TrueForge session ${r.agent.session_id ?? ""}`}>
                <span style={{ color: "var(--purple-ink)" }} aria-hidden="true">
                  ◇
                </span>
                Open in TrueForge ↗
              </a>
            )}
            <span className="st st-safe">✓ production writes blocked</span>
            {live && <AbortButton id={id} onDone={reload} />}
          </>
        }
      />
      <div className={`pg-live page${dark ? " pg-livedark" : ""}`} style={dark ? { paddingTop: 34, gap: 28 } : undefined}>
        {/* hero */}
        {dark ? (
          <div className="col" style={{ gap: 12 }}>
            <span className="eyebrow">
              Rehearsal · {r.connection_name} <span style={{ color: "#F08AB0" }}>→</span> {sbId ?? "provisioning sandbox…"} · started {fmtTime(r.created_at)}
            </span>
            <h1 className="display" style={{ fontSize: 72, margin: 0 }}>
              {heroTitle(r.status)}
            </h1>
          </div>
        ) : (
          <div className="bloom lv-hero">
            <div className="dots" aria-hidden="true" />
            <div className="dots2" aria-hidden="true" />
            <div className="cols" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
            <span className="b-rule" style={{ width: 90, position: "relative" }} />
            <span className="eyebrow" style={{ color: "#FFF7F2", position: "relative" }}>
              Rehearsal · {r.connection_name} → {sbId ?? "provisioning sandbox…"} · started {fmtTime(r.created_at)}
            </span>
            <h1 className="display" style={{ fontSize: 72, position: "relative", margin: 0, textShadow: "0 2px 24px rgba(120,20,60,.18)" }}>
              {heroTitle(r.status)}
            </h1>
            <svg className="deco" width="300" height="120" viewBox="0 0 300 120" aria-hidden="true">
              <path d="M0 90 C80 20 170 10 250 60" fill="none" stroke="rgba(255,255,255,.4)" strokeDasharray="2 7" className={live ? "flow" : undefined} />
              <g transform="translate(262 70)">
                <g fill="#FFFFFF" className={live ? "twinkle" : undefined} style={{ transformBox: "fill-box", transformOrigin: "center" }}>
                  {[0, 72, 144, 216, 288].map((a) => (
                    <ellipse key={a} cx="0" cy="-10" rx="7.5" ry="10.5" transform={a ? `rotate(${a})` : undefined} />
                  ))}
                </g>
                <circle r="6" fill="#FFD7E5" />
                <circle r="3" fill="#F0507A" />
              </g>
            </svg>
          </div>
        )}

        {/* finished-on-arrival: final state + prominent report link */}
        {!live && !finale && <FinalBanner r={r} id={id} />}

        {live && r.question && <AgentQuestionCard id={id} question={r.question} />}

        <StageTimeline stages={r.stages} metrics={m} dark={dark} now={now} />

        {/* live metrics */}
        <div
          className="lv-metrics grid-bg"
          style={{ padding: "18px 4px", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}
          aria-live="off"
        >
          <RowsScanned value={m.rows_scanned} total={m.rows_total} />
          <div className="lm" style={{ flex: 1 }}>
            <span className="num tab">{pad2(m.tables)}</span>
            <span className="eyebrow">tables</span>
          </div>
          <div className="lm" style={{ flex: 1 }}>
            <span className="num tab">{pad2(m.checks_run)}</span>
            <span className="eyebrow">checks run · of {m.checks_total}</span>
          </div>
          <Elapsed live={live} baseMs={live ? m.elapsed_ms : r.duration_ms ?? m.elapsed_ms} anchor={metricsAt} dark={dark} />
        </div>

        <div className="lv-grid">
          {/* discovery */}
          <div className="col" style={{ gap: 14, minHeight: 0 }} aria-live="polite">
            {latest ? (
              <IssueCard key={latest.id} check={latest} r={r} id={id} live={live} dark={dark} seen={seenAt.current.get(latest.id) ?? checkSeenAt(r, latest)} />
            ) : (
              <div className="glass row" style={{ padding: "22px 24px", gap: 14 }}>
                <span className={live ? "st st-ai" : "st st-safe"}>{live ? "◉ watching" : "✓ clean"}</span>
                <span style={{ font: "500 15px/1.4 'Manrope',sans-serif" }}>
                  {live
                    ? `No issues so far · ${m.checks_run} check${m.checks_run === 1 ? "" : "s"} passed.`
                    : `No issues found across ${m.checks_run} checks.`}
                </span>
              </div>
            )}
            {earlier.map((c) => (
              <Link
                key={c.id}
                href={`/rehearsals/${id}/rows?check=${encodeURIComponent(c.id)}`}
                className="panel row"
                style={{ padding: "12px 16px", gap: 12, textDecoration: "none", color: "var(--text)" }}
              >
                <span className={c.status === "fail" ? "st st-block" : "st st-review"}>{c.status === "fail" ? "✕" : "△"} {fmtInt(c.affected_rows)}</span>
                <span style={{ font: "500 13.5px/1.3 'Manrope',sans-serif", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title}</span>
                <span className="mono muted" style={{ marginLeft: "auto", fontSize: 11.5 }}>
                  {c.key} →
                </span>
              </Link>
            ))}
            <LockPanel r={r} live={live} policies={policies.data} />
          </div>

          {/* being inspected */}
          <div className="glass col" style={{ padding: 20, gap: 10 }}>
            <span className="eyebrow">{live ? "Being inspected" : "Inspected"}</span>
            <ImpactMiniMap impact={r.impact} live={live} dark={dark} />
            <InspectedKv r={r} pct={pct} live={live} issues={issues} />
          </div>

          <SandboxCard r={r} now={now} live={live} dark={dark} />
        </div>

        <LiveLog logs={r.logs} live={live} connected={connected} />
      </div>

      {finale && <FinaleToast r={finale} id={id} autoNav={!stay && finale.status !== "cancelled"} onStay={() => setStay(true)} />}
    </>
  );
}

/* ------------------------------------------------------------------ pieces */

function RowsScanned({ value, total }: { value: number; total: number }) {
  const v = useCountUp(value, 900);
  return (
    <div className="lm" style={{ flex: 1.4 }}>
      <span className="num tab">{fmtInt(Math.round(v))}</span>
      <span className="eyebrow">rows scanned · of {fmtInt(total)}</span>
    </div>
  );
}

/** Elapsed seconds, ticking locally every 100ms from the last server-reported value. */
function Elapsed({ live, baseMs, anchor, dark }: { live: boolean; baseMs: number; anchor: { current: number }; dark: boolean }) {
  const now = useNow(live, 100);
  const ms = live ? baseMs + Math.max(0, now - anchor.current) : baseMs;
  const s = Math.max(0, ms) / 1000;
  return (
    <div className="lm" style={{ flex: 1 }}>
      <span className="num tab" aria-label={`${s.toFixed(1)} seconds elapsed`}>
        {s < 600 ? s.toFixed(1) : fmtDuration(ms)}
        {s < 600 && <span style={{ fontSize: 24, color: dark ? "#BBA9BE" : "var(--text2)" }}>s</span>}
      </span>
      <span className="eyebrow">elapsed</span>
    </div>
  );
}

function IssueCard({ check: c, r, id, live, dark, seen }: { check: Check; r: Rehearsal; id: string; live: boolean; dark: boolean; seen: string | null }) {
  const n = useCountUp(c.affected_rows, 1100);
  const fail = c.status === "fail";
  const where = [c.table, c.column].filter(Boolean).join(".");
  return (
    <div
      className="glass rise"
      style={{
        padding: "24px 26px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        borderColor: dark ? "rgba(240,138,176,.35)" : fail ? "#F4B8CC" : "#F7C59F",
        boxShadow: dark ? "0 18px 40px rgba(240,138,176,.12)" : `0 1px 0 rgba(255,255,255,.9) inset,0 18px 40px ${fail ? "rgba(217,79,135,.14)" : "rgba(197,111,69,.14)"}`,
      }}
    >
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <span className="eyebrow" style={{ color: "var(--rose-ink)" }}>
          Issue discovered{seen ? ` · ${fmtTime(seen)}` : ""}
        </span>
        {c.group === "ai" ? (
          <span className="st st-ai" style={{ marginLeft: "auto" }}>
            ◇ AI check · {c.key}
          </span>
        ) : (
          <span className={fail ? "st st-block" : "st st-review"} style={{ marginLeft: "auto" }}>
            {fail ? "✕" : "△"} {c.key}
          </span>
        )}
      </div>
      <div className="row" style={{ gap: 18, alignItems: "flex-end" }}>
        <span className="serif tab" style={{ fontSize: 96, lineHeight: 0.8, color: fail ? "var(--danger)" : "var(--peach-ink)", position: "relative" }}>
          {fmtInt(Math.round(n))}
        </span>
        <span style={{ font: "500 11px/1.3 'DM Mono',monospace", letterSpacing: ".16em", paddingBottom: 8, textTransform: "uppercase" }}>
          {c.affected_rows === 1 ? "row" : "rows"} affected
          {where && (
            <>
              <br />
              <span className="muted" style={{ letterSpacing: ".06em", textTransform: "none" }}>
                {where}
              </span>
            </>
          )}
        </span>
      </div>
      <span style={{ font: "500 16px/1.45 'Manrope',sans-serif" }}>{c.title}</span>
      {c.explanation && <span style={{ font: "400 14px/1.55 'Manrope',sans-serif", color: "var(--text2)" }}>{c.explanation}</span>}
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <Link
          href={`/rehearsals/${id}/rows?check=${encodeURIComponent(c.id)}`}
          className="btn btn-p"
          style={dark ? { background: "#F08AB0", borderColor: "#F08AB0", color: "#1D1520" } : undefined}
        >
          Inspect evidence
        </Link>
        <span className="mono muted" style={{ fontSize: 12 }}>
          {live ? "rehearsal continues collecting evidence" : `${r.checks.length} checks · ${issuesOf(r.checks).length} flagged`}
        </span>
      </div>
    </div>
  );
}

function lockLimitMs(policies: Policy[] | null | undefined): number | null {
  const p = policies?.find((x) => x.enabled && /lock/i.test(`${x.key} ${x.title}`));
  if (!p) return null;
  for (const [k, v] of Object.entries(p.params)) {
    const n = typeof v === "number" ? v : typeof v === "string" && /^\d+(\.\d+)?$/.test(v) ? Number(v) : NaN;
    if (Number.isNaN(n)) continue;
    if (/ms$|_ms|millis/i.test(k)) return n;
    if (/(^|_)(s|sec|secs|seconds)$/i.test(k)) return n * 1000;
  }
  return null;
}

function LockPanel({ r, live, policies }: { r: Rehearsal; live: boolean; policies: Policy[] | null }) {
  const lock = [...r.locks].sort((a, b) => b.duration_ms - a.duration_ms)[0];
  const limit = lockLimitMs(policies);
  const violated = r.policy_violations.some((v) => /lock/i.test(`${v.title} ${v.message}`));
  const at = r.logs.filter((l) => /lock/i.test(l.source)).pop()?.ts ?? null;

  if (!lock) {
    return (
      <div className="panel row" style={{ padding: "14px 16px", gap: 12 }}>
        <span className={live ? "st st-info" : "st st-safe"}>{live ? "○ lock" : "✓ lock"}</span>
        <span style={{ font: "500 13.5px/1.3 'Manrope',sans-serif" }}>{live ? "Lock simulation pending" : "No blocking locks measured"}</span>
      </div>
    );
  }
  const over = violated || (limit != null && lock.duration_ms > limit);
  return (
    <div className="panel row" style={{ padding: "14px 16px", gap: 12, flexWrap: "wrap" }} title={`${lock.mode} on ${lock.table}${r.locks.length > 1 ? ` · ${r.locks.length} locks` : ""}`}>
      <span className={over ? "st st-review" : "st st-safe"}>{over ? "△ lock" : "✓ lock"}</span>
      <span style={{ font: "500 13.5px/1.3 'Manrope',sans-serif" }}>
        {fmtDuration(lock.duration_ms)} {lock.source === "measured" ? "measured" : "estimated"}
        {limit != null ? ` · policy allows ${fmtDuration(limit)}` : ` · ${lock.mode} on ${lock.table}`}
        {lock.blocks_writes ? " · blocks writes" : ""}
      </span>
      <span className="mono muted" style={{ marginLeft: "auto", fontSize: 11.5 }}>
        {at ? fmtTime(at) : lock.table}
      </span>
    </div>
  );
}

function InspectedKv({ r, pct, live, issues }: { r: Rehearsal; pct: number | null; live: boolean; issues: Check[] }) {
  const changed = r.impact.filter((t) => t.status === "changed");
  const affected = r.impact.filter((t) => t.status === "affected");
  const rows: [string, string][] = [];
  changed.slice(0, 2).forEach((t) => {
    const col = issues.find((c) => c.table === t.name && c.column)?.column ?? r.checks.find((c) => c.table === t.name && c.column)?.column;
    rows.push([`${t.name}${col ? `.${col}` : ""}`, live ? `scanning · ${pct ?? 0}%` : `${fmtInt(t.rows)} rows · changed`]);
  });
  affected.slice(0, 3 - rows.length).forEach((t) => rows.push([t.name, t.note ?? `${fmtInt(t.rows)} rows · depends on ${t.references[0] ?? "changed table"}`]));
  if (!rows.length) return null;
  return (
    <div>
      {rows.map(([k, v]) => (
        <div key={k} className="kv">
          <span>{k}</span>
          <span style={{ textAlign: "right" }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

function CpuSpark({ live }: { live: boolean }) {
  const now = useNow(live, 250);
  const t = now / 1000;
  const v = (x: number) => (live ? 42 + 7 * Math.sin(x * 1.7) + 4 * Math.sin(x * 4.3) : 3 + Math.sin(x) * 0.5);
  let d = `M0 ${(18 - v(t - 6) / 6).toFixed(1)}`;
  for (let i = 1; i <= 20; i++) d += ` L${i * 5} ${(18 - v(t - 6 + i * 0.3) / 6).toFixed(1)}`;
  return (
    <>
      <svg width="100%" height="18" viewBox="0 0 100 18" preserveAspectRatio="none" aria-hidden="true">
        <path d={d} fill="none" stroke="var(--purple)" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
      </svg>
      <span style={{ textAlign: "right" }}>{live ? `${Math.round(v(t))}%` : "idle"}</span>
    </>
  );
}

function SandboxCard({ r, now, live, dark }: { r: Rehearsal; now: number; live: boolean; dark: boolean }) {
  const sb = r.sandbox;
  const left = sb?.expires_at ? Math.max(0, Math.floor((new Date(sb.expires_at).getTime() - now) / 1000)) : null;
  const state = !sb ? "PENDING" : sb.status === "creating" ? "PROVISIONING" : sb.status === "destroyed" ? "DELETED" : "ISOLATED";
  const provider = r.agent?.provider === "direct" ? "DryRun agent · local Postgres sandbox" : "TrueFoundry TrueForge agent · local Postgres sandbox";
  return (
    <div className="glass col" style={{ padding: "20px 22px", gap: 12, border: `1px dashed ${dark ? "rgba(156,201,154,.45)" : "rgba(71,112,90,.5)"}` }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="eyebrow" style={{ color: "var(--green)" }}>
          Sandbox
        </span>
        <span className="row mono" style={{ gap: 6, fontSize: 11, color: "var(--green)" }}>
          <span className={`dot${sb?.status === "ready" ? " breathe" : ""}`} />
          {state}
        </span>
      </div>
      {sb ? (
        <span className="mono" style={{ fontSize: 20, overflowWrap: "anywhere" }}>
          {sb.id}
        </span>
      ) : (
        <Skeleton h={22} w="70%" />
      )}
      <span className="mono muted" style={{ fontSize: 12 }}>
        {sb ? [sb.engine, sb.region].filter(Boolean).join(" · ") : "provisioning…"}
      </span>
      <span style={{ font: "500 12.5px/1.4 'Manrope',sans-serif", color: "var(--text2)" }}>{provider}</span>
      <div className="res">
        <span className="muted">CPU</span>
        <CpuSpark live={live && sb?.status === "ready"} />
      </div>
      {r.agent?.model && (
        <div className="res">
          <span className="muted">MODEL</span>
          <span style={{ gridColumn: "2 / 4", textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.agent.model}</span>
        </div>
      )}
      <div className="rule" />
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="eyebrow">Auto delete</span>
        <span className="mono tab" style={{ fontSize: 18 }} aria-label={left != null ? `sandbox deletes in ${Math.floor(left / 60)} minutes ${left % 60} seconds` : undefined}>
          {sb?.status === "destroyed" ? "deleted" : left != null ? `${Math.floor(left / 60)}:${pad2(left % 60)}` : "—"}
        </span>
      </div>
      <div className="row" style={{ justifyContent: "space-between", padding: "10px 12px", borderRadius: 10, background: "var(--green-soft)" }}>
        <span className="eyebrow" style={{ color: "var(--green)" }}>
          Production writes
        </span>
        <span className="mono" style={{ fontSize: 12.5, color: "var(--green)", fontWeight: 500 }}>
          ✓ BLOCKED
        </span>
      </div>
    </div>
  );
}

function FinalBanner({ r, id }: { r: Rehearsal; id: string }) {
  const v = verdictOf(r.status);
  const headline = r.ai?.headline ?? r.headline;
  return (
    <div className="glass lv-final rise" role="status">
      <span className={v.cls} style={{ height: 32, fontSize: 12 }}>
        {v.label}
      </span>
      {r.risk != null && (
        <span style={{ font: "500 13.5px/1 'Manrope',sans-serif" }}>
          Risk <b className="serif" style={{ fontSize: 30, fontWeight: 400, color: bandVar(r.risk) }}>{pad2(r.risk)}</b>
          <span className="muted">/100</span>
        </span>
      )}
      <span className="col" style={{ gap: 4, flex: "1 1 280px", minWidth: 0 }}>
        <span style={{ font: "500 15px/1.4 'Manrope',sans-serif" }}>
          {r.status === "failed"
            ? r.error ?? "DryRun hit an error before it could finish."
            : r.status === "cancelled"
              ? "This rehearsal was aborted before it finished."
              : headline ?? "The rehearsal finished."}
        </span>
        <span className="mono muted" style={{ fontSize: 11.5 }}>
          finished {fmtTime(r.finished_at)} · {fmtDuration(r.duration_ms)} · production was not modified
        </span>
      </span>
      {r.status === "cancelled" ? (
        <Link href="/rehearsals" className="btn btn-lg">
          Back to rehearsals
        </Link>
      ) : (
        <Link href={`/rehearsals/${id}/report`} className="btn btn-p btn-lg btn-spark">
          Open report →
        </Link>
      )}
    </div>
  );
}

function FinaleToast({ r, id, autoNav, onStay }: { r: Rehearsal; id: string; autoNav: boolean; onStay: () => void }) {
  const v = verdictOf(r.status);
  return (
    <div className="pg-live">
      <div className="glass lv-done-toast rise" role="status" aria-live="assertive">
        <div className="row" style={{ gap: 10 }}>
          <span className={v.cls}>{v.label}</span>
          <span className="eyebrow">Rehearsal complete · {fmtDuration(r.duration_ms)}</span>
          {r.risk != null && (
            <span style={{ marginLeft: "auto", font: "500 13px/1 'Manrope',sans-serif" }}>
              Risk <b className="serif" style={{ fontSize: 26, fontWeight: 400, color: bandVar(r.risk) }}>{pad2(r.risk)}</b>
            </span>
          )}
        </div>
        <span className="serif" style={{ fontSize: 26, lineHeight: 1.15 }}>
          {r.status === "failed" ? r.error ?? "DryRun hit an error." : r.status === "cancelled" ? "Rehearsal aborted. Production untouched." : r.ai?.headline ?? r.headline ?? "Your report is ready."}
        </span>
        <div className="row" style={{ gap: 10 }}>
          {r.status !== "cancelled" && (
            <Link href={`/rehearsals/${id}/report`} className="btn btn-p btn-spark">
              Open report →
            </Link>
          )}
          {autoNav && (
            <>
              <span className="mono muted" style={{ fontSize: 11.5 }}>
                opening report…
              </span>
              <button type="button" className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={onStay}>
                Stay here
              </button>
            </>
          )}
        </div>
        {autoNav && (
          <div className="lv-done-bar" aria-hidden="true">
            <i />
          </div>
        )}
      </div>
    </div>
  );
}

function AbortButton({ id, onDone }: { id: string; onDone: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 4000);
    const k = (e: KeyboardEvent) => e.key === "Escape" && setConfirming(false);
    window.addEventListener("keydown", k);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", k);
    };
  }, [confirming]);

  const go = async () => {
    if (!confirming) return setConfirming(true);
    setBusy(true);
    try {
      await api(`/api/rehearsals/${id}/cancel`, { method: "POST" });
      toast.success("Rehearsal aborted — the sandbox will be torn down. Production was never touched.");
      onDone();
    } catch (e) {
      toast.error(`Couldn’t abort: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <button type="button" className={`btn btn-sm${confirming ? " abort-confirm" : ""}`} onClick={go} disabled={busy} aria-live="polite">
      {busy ? "Aborting…" : confirming ? "Confirm abort?" : "Abort"}
    </button>
  );
}


/** The TrueForge agent paused on ask_user_question — the engineer answers here and the agent resumes. */
function AgentQuestionCard({ id, question }: { id: string; question: AgentQuestion }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const send = async (answer: string) => {
    if (!answer.trim() || sending) return;
    setSending(true);
    try {
      await api(`/api/rehearsals/${id}/answer`, { method: "POST", json: { answer: answer.trim() } });
      toast.success("Answer sent — the agent is continuing");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not send the answer");
      setSending(false);
    }
  };
  return (
    <div
      className="glass rise"
      role="alertdialog"
      aria-label="The DryRun agent is asking a question"
      style={{ padding: "22px 26px", display: "flex", flexDirection: "column", gap: 14, borderColor: "#CBB8F6", boxShadow: "0 1px 0 rgba(255,255,255,.9) inset,0 18px 40px rgba(119,88,200,.18)" }}
    >
      <div className="row" style={{ gap: 10 }}>
        <span className="st st-ai">◇ Agent needs your input</span>
        <span className="eyebrow" style={{ marginLeft: "auto" }}>asked {fmtTime(question.asked_at)} · rehearsal paused</span>
      </div>
      <span className="serif" style={{ fontSize: 30, lineHeight: 1.15 }}>{question.text}</span>
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        {question.options.map((o) => (
          <button key={o} type="button" className="btn btn-ai" disabled={sending} onClick={() => send(o)}>
            {o}
          </button>
        ))}
      </div>
      <form
        className="row"
        style={{ gap: 10 }}
        onSubmit={(ev) => {
          ev.preventDefault();
          send(text);
        }}
      >
        <input className="inp" style={{ fontFamily: "var(--f-ui)", fontSize: 14 }} placeholder="Or type your own answer…" value={text} onChange={(ev) => setText(ev.target.value)} aria-label="Your answer" />
        <button type="submit" className="btn" disabled={sending || !text.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
