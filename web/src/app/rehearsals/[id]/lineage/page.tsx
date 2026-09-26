"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { EvidenceShell, plural, useElementWidth } from "@/components/evidence/EvidenceShell";
import { diffLines, unifiedDiff } from "@/components/evidence/diff";
import { EmptyBlock, ErrorBlock, LoadingBlock, SqlCode, StatusChip } from "@/components/ui";
import { useApi } from "@/lib/api";
import { fmtDuration, pad2, riskBand, riskColor, statusChip } from "@/lib/format";
import type { Rehearsal, RehearsalSummary, RiskPart } from "@/lib/types";

export default function LineagePage() {
  const { id } = useParams<{ id: string }>();
  const lineage = useApi<RehearsalSummary[]>(`/api/rehearsals/${id}/lineage`);
  const versions = useMemo(() => [...(lineage.data ?? [])].sort((a, b) => a.version - b.version), [lineage.data]);
  const latest = versions[versions.length - 1];

  return (
    <EvidenceShell
      id={id}
      tab="lineage"
      pg="lineage"
      right={() =>
        latest ? (
          <span className={statusChip(latest.status).cls}>
            latest V{latest.version} · {statusChip(latest.status).label.replace(/^\S+\s/, "").toLowerCase()}
            {latest.risk != null ? ` · ${pad2(latest.risk)}` : ""}
          </span>
        ) : null
      }
    >
      {(r) =>
        lineage.loading && !lineage.data ? (
          <LoadingBlock lines={8} />
        ) : lineage.error && !lineage.data ? (
          <ErrorBlock error={lineage.error} onRetry={lineage.reload} />
        ) : (
          <Lineage r={r} versions={versions.length ? versions : [r]} />
        )
      }
    </EvidenceShell>
  );
}

const CHART_H = 420;
const CARD_W = 210;
const CARD_H = 124;
const DOT: Record<ReturnType<typeof riskBand>, string> = { block: "#D94F87", review: "#F7C59F", safe: "#47705A" };
const yOf = (risk: number | null) => 400 - Math.max(0, Math.min(100, risk ?? 50)) * 3.5;

function Lineage({ r, versions }: { r: Rehearsal; versions: RehearsalSummary[] }) {
  const [chartRef, width] = useElementWidth(1148);
  const n = versions.length;
  const latest = versions[n - 1];
  const first = versions[0];
  const [pairTo, setPairTo] = useState(() => {
    const cur = versions.findIndex((v) => v.id === r.id);
    return Math.max(1, cur > 0 ? cur : n - 1);
  });

  const x0 = Math.min(150, width * 0.12);
  const x1 = Math.max(x0 + 1, width - CARD_W - 60);
  const pts = versions.map((v, i) => ({ v, x: n === 1 ? width * 0.3 : x0 + ((x1 - x0) * i) / (n - 1), y: yOf(v.risk) }));
  const roomy = n <= 1 || (x1 - x0) / (n - 1) >= CARD_W + 24;

  const path = pts
    .map((p, i) => {
      if (i === 0) return `M${p.x} ${p.y}`;
      const q = pts[i - 1];
      const dx = (p.x - q.x) / 2;
      return `C${q.x + dx} ${q.y} ${p.x - dx} ${p.y} ${p.x} ${p.y}`;
    })
    .join(" ");

  const endAt = latest.finished_at ?? latest.created_at;
  const spanMs = new Date(endAt).getTime() - new Date(first.created_at).getTime();
  const improved = first.risk != null && latest.risk != null ? first.risk - latest.risk : null;
  const headline =
    n === 1
      ? "One version so far."
      : improved == null
        ? "Every version, rehearsed in its own sandbox."
        : improved > 0
          ? "Risk, engineered out of the migration."
          : improved === 0
            ? "Same risk across versions."
            : "Risk went up between versions.";

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end", gap: 20, flexWrap: "wrap" }}>
        <div className="col" style={{ gap: 10 }}>
          <span className="eyebrow">
            Rehearsal lineage · {n} {plural(n, "version")} · {n} {plural(n, "sandbox", "sandboxes")}
            {n > 1 && spanMs > 0 ? ` · ${fmtDuration(spanMs)}` : ""}
          </span>
          <h1 className="h1" style={{ margin: 0 }}>
            {headline}
          </h1>
        </div>
        <Link href={`/rehearsals/${latest.id}/report`} className="btn btn-p">
          Open V{latest.version} report
        </Link>
      </div>

      <div ref={chartRef} className="glass grid-bg" style={{ position: "relative", height: CHART_H, overflow: "hidden" }} role="list" aria-label="Versions">
        <svg width="100%" height="100%" viewBox={`0 0 ${width} ${CHART_H}`} style={{ position: "absolute", inset: 0 }} aria-hidden="true">
          <rect x="0" y="0" width={width} height={yOf(60)} fill="rgba(255,215,229,.35)" />
          <g stroke="rgba(76,54,78,.1)" strokeDasharray="2 6">
            <line x1="0" y1={yOf(60)} x2={width} y2={yOf(60)} />
            <line x1="0" y1={yOf(30)} x2={width} y2={yOf(30)} />
          </g>
          <g fontFamily="DM Mono" fontSize="10" fill="#9C8FA0">
            <text x="12" y={yOf(60) - 4}>
              60 · block above
            </text>
            <text x="12" y={yOf(30) - 4}>
              30 · safe below
            </text>
            <text x="12" y="410">
              0
            </text>
          </g>
          <defs>
            <linearGradient id="lin-grad" x1="0" x2="1" y1="0" y2="0">
              {pts.map((p, i) => (
                <stop key={p.v.id} offset={n === 1 ? 0 : i / (n - 1)} stopColor={DOT[riskBand(p.v.risk)]} />
              ))}
            </linearGradient>
          </defs>
          {n > 1 && (
            <>
              <path className="draw-slow" d={path} fill="none" stroke="url(#lin-grad)" strokeWidth="3" />
              <path d={path} fill="none" stroke="#FFFFFF" strokeWidth="3" className="flow" opacity=".6" />
            </>
          )}
          {pts.slice(1).map((p, i) => {
            const q = pts[i];
            if (p.v.risk == null || q.v.risk == null) return null;
            const d = p.v.risk - q.v.risk;
            return (
              <text key={p.v.id} x={(p.x + q.x) / 2} y={(p.y + q.y) / 2 - 14} textAnchor="middle" fontFamily="DM Mono" fontSize="10.5" fill={d < 0 ? "#6A4FB8" : d > 0 ? "#B8386E" : "#756A78"}>
                V{p.v.version} · {d < 0 ? `−${-d}` : d > 0 ? `+${d}` : "±0"}
              </text>
            );
          })}
          {pts.map((p) => (
            <circle key={p.v.id} cx={p.x} cy={p.y} r="9" fill={p.v.risk == null ? "#FFFFFF" : DOT[riskBand(p.v.risk)]} stroke={p.v.risk == null ? "#B3A5B6" : "#FFFFFF"} strokeWidth="3" />
          ))}
        </svg>

        {pts.map((p, i) => {
          const showCard = roomy || i === 0 || i === n - 1 || p.v.id === r.id;
          let left = p.x + 22;
          let top = p.y + 20;
          if (left + CARD_W > width - 8) left = p.x - 22 - CARD_W;
          if (top + CARD_H > CHART_H - 8) top = p.y - 20 - CARD_H;
          const band = riskBand(p.v.risk);
          const current = p.v.id === r.id;
          if (!showCard)
            return (
              <Link key={p.v.id} href={`/rehearsals/${p.v.id}/report`} role="listitem" className="mono" style={{ position: "absolute", left: p.x - 20, top: p.y + 14, fontSize: 11, color: riskColor(p.v.risk), textDecoration: "none" }}>
                V{p.v.version} · {p.v.risk == null ? "—" : pad2(p.v.risk)}
              </Link>
            );
          return (
            <Link
              key={p.v.id}
              href={`/rehearsals/${p.v.id}/report`}
              role="listitem"
              className="glass vc"
              aria-current={current ? "page" : undefined}
              aria-label={`V${p.v.version}, ${p.v.status}, risk ${p.v.risk ?? "unknown"}. Open report.`}
              style={{
                left,
                top,
                zIndex: current ? 2 : 1,
                borderColor: current ? "rgba(119,88,200,.55)" : band === "safe" ? "rgba(71,112,90,.35)" : band === "review" ? "rgba(119,88,200,.3)" : undefined,
              }}
            >
              <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                <span className="eyebrow">
                  V{p.v.version} · {i === 0 ? "original" : p.v.created_by.name}
                </span>
                <StatusChip status={p.v.status} />
              </div>
              <span className="serif" style={{ fontSize: 64, lineHeight: 0.9, color: riskColor(p.v.risk) }}>
                {p.v.risk == null ? "—" : pad2(p.v.risk)}
              </span>
              <span className="mono muted" style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.v.headline ?? undefined}>
                {p.v.headline ?? (current ? "this rehearsal" : "open report →")}
              </span>
            </Link>
          );
        })}
      </div>

      {n > 1 ? (
        <Compare versions={versions} to={Math.min(pairTo, n - 1)} onPick={setPairTo} />
      ) : (
        <EmptyBlock
          title="No later versions yet."
          body="When the AI drafts a fix — or you edit and re-rehearse — each version gets its own sandbox and appears on this line."
          action={
            <Link href={`/rehearsals/${r.id}/fix`} className="btn btn-ai">
              ◇ Ask the agent for a fix
            </Link>
          }
        />
      )}
    </>
  );
}

function Compare({ versions, to, onPick }: { versions: RehearsalSummary[]; to: number; onPick: (i: number) => void }) {
  const a = versions[to - 1];
  const b = versions[to];
  const ra = useApi<Rehearsal>(`/api/rehearsals/${a.id}`);
  const rb = useApi<Rehearsal>(`/api/rehearsals/${b.id}`);
  const ready = ra.data && rb.data && ra.data.id === a.id && rb.data.id === b.id;

  const diff = useMemo(() => (ready ? unifiedDiff(diffLines(ra.data!.up_sql, rb.data!.up_sql)) : null), [ready, ra.data, rb.data]);

  return (
    <div className="col" style={{ gap: 14 }}>
      {versions.length > 2 && (
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }} role="tablist" aria-label="Compare versions">
          {versions.slice(1).map((v, i) => (
            <button key={v.id} type="button" role="tab" aria-selected={i + 1 === to} className={`pair${i + 1 === to ? " on" : ""}`} onClick={() => onPick(i + 1)}>
              V{versions[i].version} → V{v.version}
            </button>
          ))}
        </div>
      )}
      <div className="ev-lin2">
        <div className="col" style={{ gap: 10, minWidth: 0 }}>
          <div className="row" style={{ gap: 10 }}>
            <span className="h2" style={{ fontSize: 24 }}>
              What changed · V{a.version} → V{b.version}
            </span>
            {diff && (
              <span className="mono" style={{ marginLeft: "auto", fontSize: 12 }}>
                <span style={{ color: "#47705A" }}>+{diff.added}</span> <span style={{ color: "#B8386E" }}>−{diff.removed}</span>
              </span>
            )}
          </div>
          {ra.error || rb.error ? (
            <ErrorBlock error={ra.error ?? rb.error} onRetry={() => (ra.error ? ra.reload() : rb.reload())} />
          ) : !diff ? (
            <LoadingBlock lines={5} />
          ) : diff.added + diff.removed === 0 ? (
            <div className="panel state-box muted">The migration SQL is identical — only the environment or data changed.</div>
          ) : (
            <SqlCode sql={diff.text} marks={diff.marks} style={{ maxHeight: 420, overflowY: "auto" }} />
          )}
        </div>
        <div className="panel" style={{ padding: "12px 22px" }}>
          <div className="row" style={{ padding: "6px 0" }}>
            <span className="eyebrow">Risk contributions</span>
            <span className="eyebrow" style={{ marginLeft: "auto" }}>
              V{a.version} · V{b.version}
            </span>
          </div>
          {!ready ? (
            <div style={{ paddingBottom: 12 }}>
              <LoadingBlock lines={4} />
            </div>
          ) : (
            <Contributions a={ra.data!.risk_parts} b={rb.data!.risk_parts} />
          )}
          <Link href={`/rehearsals/${b.id}/report`} className="btn btn-sm" style={{ margin: "12px 0 6px" }}>
            Open V{b.version} report →
          </Link>
        </div>
      </div>
    </div>
  );
}

const BAR: Record<RiskPart["kind"], string> = {
  data_loss: "#F4B8CC",
  constraint: "#F7C59F",
  lock: "#CBB8F6",
  rollback: "#F7C59F",
  policy: "#F7C59F",
  ai: "#CBB8F6",
  other: "#E6D9E5",
};

function Contributions({ a, b }: { a: RiskPart[]; b: RiskPart[] }) {
  const labels = [...new Set([...a.map((p) => p.label), ...b.map((p) => p.label)])];
  if (!labels.length) return <div className="muted" style={{ padding: "12px 0", fontSize: 13 }}>Neither version recorded any risk contributions.</div>;
  const rows = labels
    .map((label) => {
      const pa = a.find((p) => p.label === label);
      const pb = b.find((p) => p.label === label);
      return { label, kind: (pb ?? pa)!.kind, va: pa?.points ?? 0, vb: pb?.points ?? 0 };
    })
    .sort((x, y) => Math.max(y.va, y.vb) - Math.max(x.va, x.vb));
  return (
    <>
      {rows.map((row, i) => (
        <div key={row.label} className="dl" style={i === rows.length - 1 ? { border: 0 } : undefined}>
          <span>{row.label}</span>
          <div style={{ height: 6, borderRadius: 3, background: BAR[row.kind], width: `${Math.max(2, Math.max(row.va, row.vb))}%` }} />
          <code className="muted">{row.va ? `+${row.va}` : "0"}</code>
          <code style={{ color: row.vb === 0 ? "#47705A" : row.vb > row.va ? "#B8386E" : undefined }}>{row.vb ? `+${row.vb}` : "0"}</code>
        </div>
      ))}
    </>
  );
}
