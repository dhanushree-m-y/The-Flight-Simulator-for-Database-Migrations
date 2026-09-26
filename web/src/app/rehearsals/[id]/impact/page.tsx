"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { EvidenceShell, numWord, plural, useElementWidth } from "@/components/evidence/EvidenceShell";
import { EmptyBlock } from "@/components/ui";
import { fmtInt } from "@/lib/format";
import type { Check, Rehearsal, TableImpact } from "@/lib/types";

export default function ImpactPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <EvidenceShell id={id} tab="impact" pg="impact">
      {(r) => <ImpactMap r={r} />}
    </EvidenceShell>
  );
}

const NODE_W = 168;
const NODE_H = 84;
const ROW_GAP = 116;
const LEGEND = 56;

const TONE = {
  changed: { bg: "#FFD7E5", ink: "#B8386E", edge: "#D94F87", border: (on: boolean) => `${on ? 2 : 1}px solid #D94F87`, glyph: "✕ ", tag: "Directly changed" },
  affected: { bg: "#FFE4CC", ink: "#A3552F", edge: "#C56F45", border: (on: boolean) => (on ? "2px solid #C56F45" : "1px dashed #C56F45"), glyph: "△ ", tag: "Indirectly affected" },
  unchanged: { bg: "rgba(255,255,255,.86)", ink: "var(--text)", edge: "#7758C8", border: (on: boolean) => (on ? "2px solid #7758C8" : "1px solid rgba(76,54,78,.2)"), glyph: "", tag: "Unchanged" },
} as const;

type Placed = TableImpact & { x: number; y: number };

function layout(tables: TableImpact[], width: number) {
  const groups = (["changed", "affected", "unchanged"] as const)
    .map((s) => tables.filter((t) => t.status === s))
    .filter((g) => g.length);
  // Put affected tables that point at a changed table first, unchanged ones by size.
  const changedNames = new Set(tables.filter((t) => t.status === "changed").map((t) => t.name));
  for (const g of groups) g.sort((a, b) => Number(b.references.some((x) => changedNames.has(x))) - Number(a.references.some((x) => changedNames.has(x))) || b.rows - a.rows);

  const narrow = width < 600;
  if (narrow) {
    const flat = groups.flat();
    const placed: Placed[] = flat.map((t, i) => ({ ...t, x: 20, y: 28 + i * ROW_GAP }));
    return { placed, height: Math.max(420, 28 + flat.length * ROW_GAP + LEGEND + 40) };
  }
  const maxCount = Math.max(...groups.map((g) => g.length));
  const height = Math.max(560, 60 + maxCount * ROW_GAP + LEGEND + 30);
  const pad = Math.min(100, width * 0.08);
  const span = width - pad * 2 - NODE_W;
  const placed: Placed[] = [];
  groups.forEach((g, gi) => {
    const x = groups.length === 1 ? (width - NODE_W) / 2 : pad + (span * gi) / (groups.length - 1);
    const colH = g.length * ROW_GAP - (ROW_GAP - NODE_H);
    const stagger = gi % 2 === 1 ? -36 : 24; // an organic, hand-drawn feel like the design
    const top = Math.max(24, (height - LEGEND - colH) / 2 + (g.length < maxCount ? stagger : 0));
    g.forEach((t, i) => placed.push({ ...t, x, y: top + i * ROW_GAP }));
  });
  return { placed, height };
}

function edgePath(a: Placed, b: Placed) {
  const ay = a.y + NODE_H / 2;
  const by = b.y + NODE_H / 2;
  if (Math.abs(a.x - b.x) < 4) {
    const x = a.x + NODE_W;
    const bulge = 70 + Math.abs(ay - by) * 0.15;
    return { d: `M${x} ${ay} C${x + bulge} ${ay} ${x + bulge} ${by} ${x} ${by}`, lx: x + bulge * 0.6, ly: (ay + by) / 2 };
  }
  const leftToRight = b.x > a.x;
  const x1 = leftToRight ? a.x + NODE_W : a.x;
  const x2 = leftToRight ? b.x : b.x + NODE_W;
  const mx = (x1 + x2) / 2;
  return { d: `M${x1} ${ay} C${mx} ${ay} ${mx} ${by} ${x2} ${by}`, lx: mx, ly: (ay + by) / 2 - 8 };
}

function issuesFor(checks: Check[], table: string) {
  const related = checks.filter((c) => c.table === table);
  const issues = related.filter((c) => c.status !== "pass").reduce((s, c) => s + c.affected_rows, 0);
  return { related, issues };
}

function ImpactMap({ r }: { r: Rehearsal }) {
  const tables = r.impact;
  const [boxRef, width] = useElementWidth(786);
  const [selName, setSelName] = useState<string | null>(null);

  const { placed, height } = useMemo(() => layout(tables, width), [tables, width]);
  const byName = useMemo(() => new Map(placed.map((p) => [p.name, p])), [placed]);
  const edges = useMemo(
    () => placed.flatMap((t) => t.references.filter((ref) => ref !== t.name && byName.has(ref)).map((ref) => ({ from: t, to: byName.get(ref)! }))),
    [placed, byName],
  );

  if (!tables.length) {
    return (
      <EmptyBlock
        title="No impact map yet."
        body={r.status === "running" || r.status === "queued" ? "The map appears once the sandbox has compared the before and after snapshots." : "This rehearsal did not record any table-level impact."}
        action={
          <Link className="btn btn-sm" href={`/rehearsals/${r.id}/report`}>
            Back to report
          </Link>
        }
      />
    );
  }

  const selected = tables.find((t) => t.name === selName) ?? tables.find((t) => t.status === "changed") ?? tables[0];
  const inbound = tables.filter((t) => t.references.includes(selected.name)).map((t) => t.name);
  const connected = new Set([selected.name, ...selected.references, ...inbound]);
  const changed = tables.filter((t) => t.status === "changed").length;
  const affected = tables.filter((t) => t.status === "affected").length;
  const totalRows = tables.reduce((s, t) => s + t.rows, 0);
  const { related, issues } = issuesFor(r.checks, selected.name);

  const headline =
    changed === 0
      ? "No table changed shape."
      : `${numWord(changed)} changed ${plural(changed, "table")}. ` +
        (affected === 0 ? `Nothing depends on ${changed === 1 ? "it" : "them"}.` : `${numWord(affected)} that ${affected === 1 ? "depends" : "depend"} on ${changed === 1 ? "it" : "them"}.`);

  return (
    <>
      <div className="col" style={{ gap: 10 }}>
        <span className="eyebrow">
          Database impact map · {r.connection_name} snapshot · {tables.length} {plural(tables.length, "table")} · {fmtInt(totalRows)} rows
        </span>
        <h1 className="h1" style={{ margin: 0 }}>
          {headline}
        </h1>
      </div>

      <div className="ev-split">
        <div ref={boxRef} className="glass grid-bg" style={{ position: "relative", overflow: "hidden", height }} role="group" aria-label="Table relationship graph">
          <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} style={{ position: "absolute", inset: 0 }} aria-hidden="true">
            {edges.map(({ from, to }) => {
              const on = from.name === selected.name || to.name === selected.name;
              const other = from.name === selected.name ? to : from;
              const { d, lx, ly } = edgePath(from, to);
              const stroke = on ? TONE[other.status].edge : "rgba(76,54,78,.18)";
              return (
                <g key={`${from.name}->${to.name}`}>
                  <path d={d} fill="none" stroke={stroke} strokeWidth={on ? 2.4 : 1.2} className={on && (from.status === "changed" || to.status === "changed") ? "flow" : undefined} />
                  {(on || edges.length <= 6) && (
                    <text x={lx} y={ly} textAnchor="middle" fontFamily="DM Mono" fontSize="10" fill={on ? "#756A78" : "#B3A5B6"}>
                      {from.name} → {to.name}
                    </text>
                  )}
                </g>
              );
            })}
            <g fontFamily="DM Mono" fontSize="9" fill="#B3A5B6">
              <text x="12" y="18">x 000</text>
              <text x={width - 56} y="18">x {String(Math.round(width)).padStart(3, "0")}</text>
            </g>
          </svg>

          {placed.map((t) => {
            const tone = TONE[t.status];
            const on = t.name === selected.name;
            const via = t.references.filter((x) => tables.find((y) => y.name === x)?.status === "changed");
            const { issues: n } = issuesFor(r.checks, t.name);
            return (
              <button
                key={t.name}
                type="button"
                className={`nd${on && t.status === "changed" ? " halo" : ""}`}
                aria-pressed={on}
                onClick={() => setSelName(t.name)}
                style={{ left: t.x, top: t.y, background: tone.bg, border: tone.border(on), opacity: connected.has(t.name) ? 1 : 0.45, zIndex: on ? 2 : 1 }}
              >
                <b style={{ color: tone.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
                  {tone.glyph}
                  {t.name}
                </b>
                <span>{t.status === "changed" ? "DIRECT · schema changed" : t.status === "affected" ? `INDIRECT${via.length ? ` · via ${via.join(", ")}` : ""}` : "UNCHANGED"}</span>
                <span>
                  {fmtInt(t.rows)} rows{n > 0 ? ` · ${fmtInt(n)} ${plural(n, "issue")}` : ""}
                </span>
              </button>
            );
          })}

          <div className="row" style={{ position: "absolute", left: 20, bottom: 18, gap: 16, flexWrap: "wrap", font: "400 11px/1 'DM Mono',monospace", color: "var(--text2)" }}>
            <span className="row" style={{ gap: 6 }}>
              <i style={{ width: 14, height: 14, borderRadius: 4, background: "#FFD7E5", border: "2px solid #D94F87" }} />
              directly changed
            </span>
            <span className="row" style={{ gap: 6 }}>
              <i style={{ width: 14, height: 14, borderRadius: 4, background: "#FFE4CC", border: "1px dashed #C56F45" }} />
              indirectly affected
            </span>
            <span className="row" style={{ gap: 6 }}>
              <i style={{ width: 14, height: 14, borderRadius: 4, background: "#FFFFFF", border: "1px solid var(--line2)" }} />
              unchanged
            </span>
            <span>click a table</span>
          </div>
        </div>

        <aside className="col ev-sticky" style={{ gap: 18, position: "sticky", top: 16 }} aria-live="polite" aria-label="Selected table">
          <div className="glass" style={{ padding: "22px 24px", display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="eyebrow">Selected table</span>
            <span className="mono" style={{ fontSize: 24, wordBreak: "break-all" }}>
              {selected.name}
            </span>
            <div className="row" style={{ gap: 28, padding: "10px 0 6px" }}>
              <div className="col" style={{ gap: 4 }}>
                <span className="eyebrow">Rows</span>
                <span className="num" style={{ fontSize: 34 }}>
                  {fmtInt(selected.rows)}
                </span>
              </div>
              <div className="col" style={{ gap: 4 }}>
                <span className="eyebrow">Issues</span>
                <span className="num" style={{ fontSize: 34, color: issues > 0 ? (selected.status === "changed" ? "#A8234F" : "#A3552F") : "#47705A" }}>
                  {fmtInt(issues)}
                </span>
              </div>
            </div>
            <div className="kv">
              <span>Change</span>
              <span style={{ color: TONE[selected.status].ink }}>{TONE[selected.status].tag}</span>
            </div>
            <div className="kv">
              <span>References</span>
              <span style={{ textAlign: "right" }}>{selected.references.length ? selected.references.join(", ") : "none"}</span>
            </div>
            <div className="kv">
              <span>Referenced by</span>
              <span style={{ textAlign: "right" }}>{inbound.length ? inbound.join(", ") : "none"}</span>
            </div>
            {selected.note && <p style={{ margin: "8px 0 0", font: "400 13px/1.55 'Manrope',sans-serif", color: "var(--text2)" }}>{selected.note}</p>}
          </div>

          <div className="panel" style={{ padding: "18px 20px" }}>
            <span className="eyebrow">Related checks · {related.length}</span>
            {related.length === 0 && (
              <div className="bl" style={{ color: "var(--text2)", borderBottom: 0 }}>
                <span>◌</span>
                <span>No checks reference this table.</span>
                <span />
              </div>
            )}
            {related.map((c, i) => (
              <div key={c.id} className="bl" style={i === related.length - 1 ? { borderBottom: 0 } : undefined}>
                <span style={{ color: c.status === "fail" ? "#A8234F" : c.status === "warn" ? "#A3552F" : "#47705A" }} aria-label={c.status}>
                  {c.status === "fail" ? "✕" : c.status === "warn" ? "△" : "✓"}
                </span>
                {c.has_rows ? <Link href={`/rehearsals/${r.id}/rows?check=${encodeURIComponent(c.id)}`}>{c.title}</Link> : <span>{c.title}</span>}
                <span className="mono" style={{ fontSize: 11.5 }}>
                  {c.affected_rows > 0 ? fmtInt(c.affected_rows) : c.column ?? ""}
                </span>
              </div>
            ))}
            {(selected.references.length > 0 || inbound.length > 0) && (
              <div className="row" style={{ gap: 6, flexWrap: "wrap", paddingTop: 12 }}>
                {[...new Set([...selected.references, ...inbound])].map((n) => (
                  <button key={n} type="button" className="st st-info" style={{ border: 0, cursor: "pointer" }} onClick={() => setSelName(n)}>
                    {n}
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
