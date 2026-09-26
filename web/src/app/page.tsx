"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { TopBar } from "@/components/shell/AppShell";
import { ErrorBlock, EmptyBlock, RiskBar, RiskNumber, Skeleton, StatusChip } from "@/components/ui";
import { RehearsalTable } from "@/components/rehearsals/RehearsalTable";
import {
  compactChip,
  dayKey,
  dayLabel,
  isLive,
  monotonePath,
  pinColor,
  rehearsalHref,
  shortName,
  sparkPath,
  startOfDay,
  useCountUp,
  useElementWidth,
} from "@/components/rehearsals/util";
import { useApi } from "@/lib/api";
import { fmtInt, pad2, timeAgo } from "@/lib/format";
import type { Approval, Overview, Rehearsal, RehearsalSummary } from "@/lib/types";
import "@/components/rehearsals/screens.css";

export default function OverviewPage() {
  const ov = useApi<Overview>("/api/overview", { pollMs: 20000 });
  const data = ov.data;

  return (
    <>
      <TopBar crumbs={["Overview"]} env={{ kind: "org" }} />
      <div className="pg-overview page">
        <div className="bloom hero-band">
          <div className="cols" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <div className="row ov-hero-row" style={{ justifyContent: "space-between", alignItems: "flex-end", position: "relative" }}>
            <div className="col" style={{ gap: 14 }}>
              <span className="b-rule" style={{ width: 110 }} />
              <span className="eyebrow">{data ? `Overview · ${data.week_label}` : "Overview · this week"}</span>
              <h1 className="display" style={{ maxWidth: 860, margin: 0 }}>
                Everything that tried to reach production.
              </h1>
            </div>
            <Link href="/rehearsals/new" className="btn btn-lg btn-p btn-spark" aria-keyshortcuts="N">
              + New rehearsal{" "}
              <span className="kbd" style={{ background: "transparent", color: "#FFFFFF", borderColor: "rgba(255,255,255,.5)" }}>
                N
              </span>
            </Link>
          </div>
        </div>

        {ov.error && !data ? (
          <ErrorBlock error={ov.error} onRetry={ov.reload} />
        ) : !data ? (
          <BentoSkeleton />
        ) : (
          <Bento data={data} />
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ bento */

function Bento({ data }: { data: Overview }) {
  const p = useCountUp(true);
  const { kpis } = data;
  const recentChrono = useMemo(
    () => [...data.recent].sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at)),
    [data.recent],
  );

  // tile 1 — rehearsals per day this week (sparkline) + band split
  const perDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of [...data.risk_trend].sort((a, b) => +new Date(a.at) - +new Date(b.at))) m.set(dayKey(t.at), (m.get(dayKey(t.at)) ?? 0) + 1);
    return [...m.values()];
  }, [data.risk_trend]);
  const bands = useMemo(() => {
    const b = { safe: 0, review: 0, block: 0 };
    for (const t of data.risk_trend) b[t.risk <= 30 ? "safe" : t.risk <= 60 ? "review" : "block"]++;
    return b;
  }, [data.risk_trend]);

  // tile 2 — the newest blocked migration
  const newestBlocked = useMemo(
    () => [...data.recent].filter((r) => r.status === "blocked").sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))[0] ?? null,
    [data.recent],
  );

  // tile 4 — durations of recent finished rehearsals
  const durations = useMemo(
    () => recentChrono.filter((r) => r.duration_ms != null).map((r) => r.duration_ms as number),
    [recentChrono],
  );
  const p95 = useMemo(() => {
    if (!durations.length) return null;
    const s = [...durations].sort((a, b) => a - b);
    return s[Math.max(0, Math.ceil(0.95 * s.length) - 1)];
  }, [durations]);

  const sp1 = sparkPath(perDay);
  const sp4 = sparkPath(durations);
  const issues = data.top_issues.filter((i) => i.count > 0).slice(0, 3);

  return (
    <>
      <div className="bento">
        <ApprovalTile pending={data.pending} />
        <RiskTrendTile points={data.risk_trend} />

        {/* metric tiles */}
        <div className="glass tile rise ov-m" style={{ gridColumn: "span 3", animationDelay: ".12s" }}>
          <span className="eyebrow">Rehearsals this week</span>
          <span className="num tab" style={{ fontSize: 44 }}>{pad2(Math.round(kpis.rehearsals * p))}</span>
          <div className="row" style={{ gap: 10, marginTop: "auto" }}>
            <span className="mono" style={{ fontSize: 12, color: "var(--text2)" }}>
              <span style={{ color: "#3F7A3A" }}>{bands.safe} safe</span> · {bands.review} review · {bands.block} blocked
            </span>
            {sp1 && (
              <svg width="90" height="22" viewBox="0 0 90 22" aria-hidden="true" style={{ marginLeft: "auto", flexShrink: 0 }}>
                <path className="draw" d={sp1} fill="none" stroke="#7758C8" strokeWidth="1.5" />
              </svg>
            )}
          </div>
        </div>
        <div className="glass tile rise ov-m" style={{ gridColumn: "span 3", animationDelay: ".16s" }}>
          <span className="eyebrow">Migrations blocked</span>
          <span className="num tab" style={{ fontSize: 44, color: kpis.blocked > 0 ? "#A8234F" : undefined }}>
            {pad2(Math.round(kpis.blocked * p))}
          </span>
          <div className="row" style={{ gap: 8, marginTop: "auto", minWidth: 0 }}>
            {newestBlocked ? (
              <>
                <span className="pulse" style={{ width: 8, height: 8, borderRadius: "50%", background: "#D94F87", color: "#D94F87", flexShrink: 0 }} />
                <Link href={rehearsalHref(newestBlocked)} className="mono ellipsis" style={{ fontSize: 12, textDecoration: "none" }}>
                  new · {newestBlocked.name}
                </Link>
              </>
            ) : (
              <>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#BFD9B5", flexShrink: 0 }} />
                <span className="mono muted" style={{ fontSize: 12 }}>nothing blocked recently</span>
              </>
            )}
          </div>
        </div>
        <div className="glass tile rise ov-m" style={{ gridColumn: "span 3", animationDelay: ".2s" }}>
          <span className="eyebrow">Rows protected</span>
          <span className="num tab" style={{ fontSize: 44 }}>{fmtInt(Math.round(kpis.rows_protected * p))}</span>
          <span className="muted" style={{ fontSize: 12.5, marginTop: "auto" }}>
            {issues.length ? `${issues.map((i) => `${i.kind.replace(/_/g, " ")} ${i.count}`).join(" · ")} caught` : "truncations · duplicates · orphans caught"}
          </span>
        </div>
        <div className="glass tile rise ov-m" style={{ gridColumn: "span 3", animationDelay: ".24s" }}>
          <span className="eyebrow">Avg rehearsal time</span>
          <span className="num tab" style={{ fontSize: 44 }}>
            {((kpis.avg_duration_ms / 1000) * p).toFixed(1)}
            <span style={{ fontSize: 24, color: "var(--text2)" }}>s</span>
          </span>
          <div className="row" style={{ gap: 10, marginTop: "auto" }}>
            <span className="mono" style={{ fontSize: 12, color: "var(--text2)" }}>
              {p95 != null ? `p95 ${(p95 / 1000).toFixed(0)}s` : "no finished runs yet"}
            </span>
            {sp4 && (
              <svg width="90" height="22" viewBox="0 0 90 22" aria-hidden="true" style={{ marginLeft: "auto", flexShrink: 0 }}>
                <path className="draw" d={sp4} fill="none" stroke="#7758C8" strokeWidth="1.5" />
              </svg>
            )}
          </div>
        </div>

        <TimelineTile recent={recentChrono} />
      </div>

      {data.recent.length > 0 && (
        <div className="glass rise" style={{ animationDelay: ".32s", overflow: "hidden" }}>
          <div className="row" style={{ justifyContent: "space-between", padding: "18px 18px 4px" }}>
            <h2 className="h2" style={{ fontSize: 18, margin: 0 }}>Latest runs</h2>
            <Link href="/rehearsals" className="btn btn-sm">
              All rehearsals →
            </Link>
          </div>
          <RehearsalTable rows={data.recent.slice(0, 6)} />
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ A · approval */

function ApprovalTile({ pending }: { pending: Approval[] }) {
  const top = pending[0] ?? null;
  const next = pending[1] ?? null;
  const detail = useApi<Rehearsal>(top ? `/api/rehearsals/${top.rehearsal.id}` : null);

  if (!top) {
    return (
      <div className="glass tile rise ov-a" style={{ gridColumn: "span 7", gridRow: "span 2", padding: "28px 30px", gap: 18 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="eyebrow" style={{ color: "#47705A" }}>Needs your approval · 0</span>
          <span className="eyebrow">production queue</span>
        </div>
        <div className="col" style={{ gap: 12, margin: "auto 0" }}>
          <span className="serif" style={{ fontSize: 30, lineHeight: 1.2 }}>Nothing is waiting on you.</span>
          <span className="muted" style={{ fontSize: 14.5, maxWidth: 460 }}>
            When a rehearsal passes and someone requests a production apply, it lands here with its risk and evidence.
          </span>
        </div>
        <div className="row" style={{ gap: 12, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
          <Link href="/rehearsals/new" className="btn btn-p">Start a rehearsal →</Link>
          <Link href="/approvals" className="btn" style={{ marginLeft: "auto" }}>Approval history</Link>
        </div>
      </div>
    );
  }

  const r = top.rehearsal;
  return (
    <div className="glass tile rise ov-a" style={{ gridColumn: "span 7", gridRow: "span 2", padding: "28px 30px", gap: 18 }}>
      <div className="row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <span className="eyebrow" style={{ color: "#B8386E" }}>Needs your approval · {pending.length}</span>
        <span className="eyebrow">
          requested {timeAgo(top.requested_at)} · {top.requested_by.name}
        </span>
      </div>
      <span className="mono ellipsis" style={{ fontSize: 24, fontWeight: 500 }}>
        {r.name} <span className="muted" style={{ fontSize: 15 }}>V{r.version}</span>
      </span>
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <span className="env env-prod" style={{ height: 28 }}>⛨ {r.connection_name}</span>
        <StatusChip status={r.status} />
      </div>
      <div className="row" style={{ gap: 28, alignItems: "flex-end", marginTop: "auto" }}>
        <div className="col" style={{ gap: 2 }}>
          <span className="eyebrow">Risk</span>
          <RiskNumber risk={r.risk} />
        </div>
        <div className="col" style={{ gap: 12, flex: 1, paddingBottom: 8, minWidth: 0 }}>
          <span style={{ font: "500 17px/1.4 'Manrope',sans-serif" }}>
            {r.headline ?? detail.data?.ai?.headline ?? "Rehearsal finished — review the evidence before applying."}
          </span>
          {detail.data ? (
            detail.data.risk_parts.length > 0 ? (
              <RiskBar parts={detail.data.risk_parts} />
            ) : (
              <div style={{ height: 6, borderRadius: 3, background: "var(--line)" }} aria-label="No risk contributions" />
            )
          ) : detail.error ? (
            <span className="mono muted" style={{ fontSize: 11.5 }}>risk breakdown unavailable</span>
          ) : (
            <Skeleton h={6} />
          )}
        </div>
      </div>
      <div className="row" style={{ gap: 12, paddingTop: 14, borderTop: "1px solid var(--line)", flexWrap: "wrap" }}>
        <Link href={`/rehearsals/${r.id}/report`} className="btn btn-p">
          Review evidence →
        </Link>
        <Link href="/approvals" className="btn">
          Open approvals
        </Link>
        {next ? (
          <>
            <span className="muted" style={{ fontSize: 13, marginLeft: "auto" }}>
              next · <span className="mono">{next.rehearsal.name}</span>
            </span>
            <span className={compactChip(next.rehearsal.status, next.rehearsal.risk).cls}>
              {compactChip(next.rehearsal.status, next.rehearsal.risk).label}
            </span>
          </>
        ) : (
          <span className="muted" style={{ fontSize: 13, marginLeft: "auto" }}>nothing else queued</span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ B · risk trend */

const CH = 230;

function RiskTrendTile({ points }: { points: Overview["risk_trend"] }) {
  const router = useRouter();
  const { ref, width } = useElementWidth<HTMLDivElement>(440);
  const W = Math.max(200, width);

  const sorted = useMemo(() => [...points].sort((a, b) => +new Date(a.at) - +new Date(b.at)), [points]);
  const geo = useMemo(() => {
    if (!sorted.length) return null;
    const t0 = +new Date(sorted[0].at);
    const t1 = +new Date(sorted[sorted.length - 1].at);
    const span = t1 - t0;
    const pad = sorted.length === 1 ? W / 2 : 0;
    let lastX = -Infinity;
    const pts = sorted.map((t, i) => {
      let x = sorted.length === 1 ? pad : span > 0 ? ((+new Date(t.at) - t0) / span) * W : (i / (sorted.length - 1)) * W;
      if (x <= lastX) x = lastX + 1;
      lastX = x;
      const y = CH - 2 * Math.max(0, Math.min(100, t.risk));
      return { x, y, t };
    });
    const line = sorted.length === 1 ? `M0 ${pts[0].y} L${W} ${pts[0].y}` : monotonePath(pts);
    const area = `${line} L${sorted.length === 1 ? W : pts[pts.length - 1].x} ${CH} L0 ${CH}Z`;
    const spikes = pts
      .filter((p) => p.t.risk > 60)
      .sort((a, b) => b.t.risk - a.t.risk)
      .slice(0, 3);
    return { pts, line, area, spikes };
  }, [sorted, W]);

  const days = useMemo(() => {
    const seen = new Map<string, number>();
    for (const t of sorted) if (!seen.has(dayKey(t.at))) seen.set(dayKey(t.at), startOfDay(t.at));
    return [...seen.values()];
  }, [sorted]);

  const aria = geo
    ? `Risk trend of ${sorted.length} rehearsals.${geo.spikes.length ? ` Spikes: ${geo.spikes.map((s) => `${s.t.name} at ${s.t.risk}`).join(", ")}.` : " No blocking spikes."}`
    : "No risk data this week";

  return (
    <div className="glass tile rise ov-b" style={{ gridColumn: "span 5", gridRow: "span 2", padding: "24px 26px 20px", gap: 10, animationDelay: ".08s" }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 className="h2" style={{ fontSize: 18, margin: 0 }}>Risk this week</h2>
        <span className="eyebrow">first attempt · 0–100</span>
      </div>
      <div ref={ref} style={{ flex: 1, minHeight: CH, position: "relative" }}>
        {!geo ? (
          <div className="col" style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center", gap: 10, textAlign: "center" }}>
            <span className="serif" style={{ fontSize: 26 }}>No rehearsals yet this week.</span>
            <Link href="/rehearsals/new" className="btn btn-sm">Rehearse a migration</Link>
          </div>
        ) : (
          <svg width="100%" height={CH} viewBox={`0 0 ${W} ${CH}`} role="img" aria-label={aria} style={{ display: "block", overflow: "visible" }}>
            <defs>
              <linearGradient id="rf" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#F49AC4" stopOpacity=".45" />
                <stop offset="1" stopColor="#F49AC4" stopOpacity="0" />
              </linearGradient>
            </defs>
            <g stroke="rgba(140,60,90,.12)">
              <line x1="0" y1="50" x2={W} y2="50" />
              <line x1="0" y1="110" x2={W} y2="110" />
              <line x1="0" y1="170" x2={W} y2="170" />
            </g>
            <path d={geo.area} fill="url(#rf)" />
            <path className="draw-slow" pathLength={1600} d={geo.line} fill="none" stroke="#C2306F" strokeWidth="2" />
            <g fontFamily="DM Mono" fontSize="10" fill="#65586A">
              <text x="2" y="46">90</text>
              <text x="2" y="106">60</text>
              <text x="2" y="166">30</text>
            </g>
            {geo.pts.map((p) => (
              <circle
                key={p.t.id}
                className="trend-pt"
                cx={p.x}
                cy={p.y}
                r={p.t.risk > 60 ? 4 : 3}
                fill={p.t.risk > 60 ? "#C2306F" : "#FFFFFF"}
                stroke="#C2306F"
                strokeWidth="1.5"
                tabIndex={0}
                role="link"
                aria-label={`${p.t.name}, risk ${p.t.risk}`}
                onClick={() => router.push(`/rehearsals/${p.t.id}/report`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    router.push(`/rehearsals/${p.t.id}/report`);
                  }
                }}
              >
                <title>{`${p.t.name} · risk ${p.t.risk}`}</title>
              </circle>
            ))}
            {geo.spikes.map((s) => {
              const label = `${shortName(s.t.name)} · ${pad2(s.t.risk)}`;
              const w = label.length * 6.4;
              const x = Math.max(24, Math.min(W - w - 2, s.x + 8));
              return (
                <text key={s.t.id} x={x} y={Math.max(12, s.y - 8)} fontFamily="DM Mono" fontSize="10.5" fill="#261F29" pointerEvents="none">
                  {label}
                </text>
              );
            })}
          </svg>
        )}
      </div>
      {days.length > 0 && (
        <div className="row eyebrow" style={{ justifyContent: days.length === 1 ? "center" : "space-between" }}>
          {days.map((d) => (
            <span key={d}>{dayLabel(d, false).replace(" · today", "")}</span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ timeline */

const EV_MAX = 83; // % — keeps the last label inside the tile, as in the design
const EV_GAP = 16; // % — minimum spacing so labels never collide

function TimelineTile({ recent }: { recent: RehearsalSummary[] }) {
  const items = recent.slice(-5);

  const layout = useMemo(() => {
    if (!items.length) return null;
    const d0 = startOfDay(items[0].created_at);
    const lastDay = startOfDay(items[items.length - 1].created_at);
    const nDays = Math.round((lastDay - d0) / 86400000) + 1;
    const d1 = d0 + nDays * 86400000;
    let lefts = items.map((r) => 2 + ((+new Date(r.created_at) - d0) / (d1 - d0)) * (EV_MAX + 15));
    // sweep forward to enforce spacing, then pull back if we ran past the edge
    for (let i = 1; i < lefts.length; i++) lefts[i] = Math.max(lefts[i], lefts[i - 1] + EV_GAP);
    if (lefts[lefts.length - 1] > EV_MAX) {
      lefts[lefts.length - 1] = EV_MAX;
      for (let i = lefts.length - 2; i >= 0; i--) lefts[i] = Math.min(lefts[i], lefts[i + 1] - EV_GAP);
      if (lefts[0] < 2) lefts = items.map((_, i) => (items.length === 1 ? 2 : 2 + (i * (EV_MAX - 2)) / (items.length - 1)));
    }
    const days = Array.from({ length: Math.min(nDays, 7) }, (_, i) => d0 + i * 86400000);
    return { lefts, days };
  }, [items]);

  return (
    <div className="glass tile rise" style={{ gridColumn: "span 12", padding: "22px 30px 18px", gap: 18, animationDelay: ".28s" }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 className="h2" style={{ fontSize: 18, margin: 0 }}>Recent rehearsals</h2>
        <span className="eyebrow">first-attempt risk · by time</span>
      </div>
      {!layout ? (
        <EmptyBlock
          title="No rehearsals yet"
          body="Rehearse your first migration against a sandbox copy of your database — it takes about half a minute."
          action={
            <Link href="/rehearsals/new" className="btn btn-p">
              + New rehearsal
            </Link>
          }
        />
      ) : (
        <div style={{ position: "relative", height: 124, overflow: "hidden" }}>
          <div style={{ position: "absolute", left: 0, right: 0, top: 6, height: 1, background: "var(--line2)" }} />
          <div className="row eyebrow" style={{ position: "absolute", left: 0, right: 0, top: 108, justifyContent: "space-between" }}>
            {layout.days.map((d) => (
              <span key={d}>{dayLabel(d)}</span>
            ))}
            <span />
          </div>
          {items.map((r, i) => {
            const c = compactChip(r.status, r.risk);
            const latest = i === items.length - 1;
            return (
              <Link key={r.id} href={rehearsalHref(r)} className="ev" style={{ left: `${layout.lefts[i]}%`, textDecoration: "none", color: "inherit" }}>
                <span
                  className={`pin${latest && (r.status === "blocked" || isLive(r.status)) ? " halo" : ""}`}
                  style={{ background: pinColor(r.status, r.risk) }}
                />
                <span className="mono ellipsis" style={{ fontSize: 12.5, maxWidth: 200 }}>{r.name}</span>
                <span className={c.cls}>{c.label}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ loading */

function BentoSkeleton() {
  return (
    <div className="bento" aria-busy="true" aria-label="Loading overview">
      <div className="glass tile ov-a" style={{ gridColumn: "span 7", gridRow: "span 2", padding: "28px 30px", gap: 18 }}>
        <Skeleton h={10} w={180} />
        <Skeleton h={26} w="55%" />
        <Skeleton h={28} w={220} />
        <div className="row" style={{ gap: 28, alignItems: "flex-end", marginTop: "auto" }}>
          <Skeleton h={92} w={120} />
          <div className="col" style={{ gap: 12, flex: 1 }}>
            <Skeleton h={16} w="80%" />
            <Skeleton h={6} />
          </div>
        </div>
      </div>
      <div className="glass tile ov-b" style={{ gridColumn: "span 5", gridRow: "span 2", padding: "24px 26px 20px" }}>
        <Skeleton h={18} w={140} />
        <Skeleton h={230} style={{ marginTop: 10 }} />
      </div>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="glass tile ov-m" style={{ gridColumn: "span 3" }}>
          <Skeleton h={10} w={130} />
          <Skeleton h={50} w={110} />
          <Skeleton h={12} w="70%" style={{ marginTop: "auto" }} />
        </div>
      ))}
      <div className="glass tile" style={{ gridColumn: "span 12", padding: "22px 30px 18px" }}>
        <Skeleton h={18} w={170} />
        <Skeleton h={90} />
      </div>
    </div>
  );
}
