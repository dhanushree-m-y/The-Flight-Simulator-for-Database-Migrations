"use client";

import type { TableImpact } from "@/lib/types";

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * "Being inspected" mini-map: changed table(s) on the left (pink, breathing ring while live),
 * tables that depend on them on the right (peach, animated flow), unchanged neighbours in white.
 */
export function ImpactMiniMap({ impact, live, dark }: { impact: TableImpact[]; live: boolean; dark: boolean }) {
  const changed = impact.filter((t) => t.status === "changed").slice(0, 2);
  const changedNames = new Set(changed.map((t) => t.name));
  const related = (t: TableImpact) => t.references.some((r) => changedNames.has(r)) || changed.some((c) => c.references.includes(t.name));
  const affected = impact.filter((t) => t.status === "affected");
  const unchanged = impact.filter((t) => t.status === "unchanged");
  const right = [...affected, ...unchanged.filter(related), ...unchanged.filter((t) => !related(t))].slice(0, 3);
  const hidden = impact.filter((t) => !changedNames.has(t.name) && !right.includes(t));

  const C = dark
    ? { chFill: "#3E2433", chStroke: "#F08AB0", chText: "#F08AB0", afFill: "#3A271F", afStroke: "#EFA77E", afText: "#EFA77E", unFill: "#2A1F2F", unStroke: "rgba(255,226,245,.2)", unText: "#BBA9BE", edge: "rgba(255,226,245,.18)" }
    : { chFill: "#FFD7E5", chStroke: "#D94F87", chText: "#B8386E", afFill: "#FFE4CC", afStroke: "#C56F45", afText: "#A3552F", unFill: "#FFFFFF", unStroke: "rgba(76,54,78,.2)", unText: "#756A78", edge: "rgba(76,54,78,.18)" };

  const leftY = changed.length === 2 ? [30, 104] : [52];
  const rightY = right.length === 1 ? [54] : right.length === 2 ? [30, 112] : [10, 66, 122];

  const label = [
    changed.length ? `${changed.map((t) => t.name).join(", ")} ${changed.length > 1 ? "are" : "is"} being changed` : "no table changed yet",
    affected.length ? `${affected.map((t) => t.name).join(", ")} depend${affected.length === 1 ? "s" : ""} on it` : null,
    unchanged.length ? `${unchanged.length} unchanged` : null,
  ]
    .filter(Boolean)
    .join("; ");

  if (!impact.length) {
    return (
      <div className="col" style={{ height: 190, alignItems: "center", justifyContent: "center", gap: 8 }}>
        <span className="skel" style={{ width: 92, height: 44, borderRadius: 12 }} aria-hidden="true" />
        <span className="mono muted" style={{ fontSize: 11 }}>{live ? "mapping dependencies…" : "no impact data"}</span>
      </div>
    );
  }

  return (
    <svg width="100%" height="190" viewBox="0 0 300 190" role="img" aria-label={label}>
      {changed.map((c, ci) =>
        right.map((t, ri) => {
          const y1 = leftY[ci] + 22;
          const y2 = rightY[ri] + 20;
          const isAff = t.status === "affected" && (related(t) || changed.length === 1);
          return (
            <path
              key={`${c.name}-${t.name}`}
              d={`M110 ${y1} C150 ${y1} 150 ${y2} 190 ${y2}`}
              fill="none"
              stroke={isAff ? (dark ? "#EFA77E" : "#F7C59F") : C.edge}
              strokeWidth={isAff ? 1.5 : 1.2}
              className={isAff && live ? "flow" : undefined}
            />
          );
        }),
      )}
      {right.length > 1 && (
        <path
          d={`M282 ${rightY[0] + 20} C300 ${(rightY[0] + rightY[right.length - 1]) / 2} 300 ${(rightY[0] + rightY[right.length - 1]) / 2} 282 ${rightY[right.length - 1] + 20}`}
          fill="none"
          stroke={C.edge}
          strokeWidth="1.2"
        />
      )}
      {changed.map((t, i) => (
        <g key={t.name}>
          <title>{`${t.name} · ${t.rows.toLocaleString("en-IN")} rows · changed${t.note ? ` · ${t.note}` : ""}`}</title>
          <rect x="18" y={leftY[i]} width="92" height="44" rx="12" fill={C.chFill} stroke={C.chStroke} strokeWidth="2" />
          <text x="64" y={leftY[i] + 27} textAnchor="middle" fontFamily="DM Mono" fontSize="13" fill={C.chText}>
            {clip(t.name, 11)}
          </text>
          {i === 0 && <circle cx="64" cy={leftY[i] + 22} r="40" fill="none" stroke={C.chStroke} strokeOpacity=".25" className={live ? "breathe" : undefined} />}
        </g>
      ))}
      {!changed.length && (
        <text x="18" y="80" fontFamily="DM Mono" fontSize="11" fill={C.unText}>
          waiting for the migration…
        </text>
      )}
      {right.map((t, i) => {
        const aff = t.status === "affected";
        return (
          <g key={t.name}>
            <title>{`${t.name} · ${t.rows.toLocaleString("en-IN")} rows · ${t.status}${t.note ? ` · ${t.note}` : ""}`}</title>
            <rect x="190" y={rightY[i]} width="92" height="40" rx="12" fill={aff ? C.afFill : C.unFill} stroke={aff ? C.afStroke : C.unStroke} />
            <text x="236" y={rightY[i] + 25} textAnchor="middle" fontFamily="DM Mono" fontSize="12" fill={aff ? C.afText : C.unText}>
              {clip(t.name, 11)}
            </text>
          </g>
        );
      })}
      {hidden.length > 0 && (
        <text x="18" y="182" fontFamily="DM Mono" fontSize="10" fill={C.unText}>
          {clip(hidden.map((t) => t.name).join(", "), 34)} · {hidden.every((t) => t.status === "unchanged") ? "unchanged · " : ""}not drawn
        </text>
      )}
    </svg>
  );
}
