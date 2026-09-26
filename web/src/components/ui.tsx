"use client";

import type { CSSProperties, ReactNode } from "react";
import { riskColor, statusChip } from "@/lib/format";
import type { RehearsalStatus } from "@/lib/types";

export function StatusChip({ status }: { status: RehearsalStatus }) {
  const c = statusChip(status);
  return <span className={c.cls}>{c.label}</span>;
}

/** Big serif risk number, coloured by band. */
export function RiskNumber({ risk, size = 112 }: { risk: number | null; size?: number }) {
  return (
    <span className="serif tab" style={{ fontSize: size, lineHeight: 0.82, color: riskColor(risk) }}>
      {risk == null ? "—" : String(risk).padStart(2, "0")}
    </span>
  );
}

export function Skeleton({ h = 18, w = "100%", style }: { h?: number; w?: number | string; style?: CSSProperties }) {
  return <div className="skel" style={{ height: h, width: w, ...style }} />;
}

export function LoadingBlock({ lines = 4 }: { lines?: number }) {
  return (
    <div className="glass col" style={{ padding: 24, gap: 12 }} aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} w={`${90 - i * 12}%`} />
      ))}
    </div>
  );
}

export function ErrorBlock({ error, onRetry }: { error: Error | null; onRetry?: () => void }) {
  return (
    <div className="glass state-box" role="alert">
      <span className="st st-block">✕ Couldn’t load</span>
      <span style={{ font: "500 15px/1.4 'Manrope',sans-serif", maxWidth: 520 }}>{error?.message || "Something went wrong."}</span>
      <span className="muted" style={{ fontSize: 13 }}>Production was not modified.</span>
      {onRetry && (
        <button type="button" className="btn btn-sm" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyBlock({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="glass state-box">
      <span className="h2">{title}</span>
      {body && <span className="muted" style={{ maxWidth: 520 }}>{body}</span>}
      {action}
    </div>
  );
}

/** Read-only SQL block with line numbers, in the design's `.code` style. Lines can be marked added/removed. */
export function SqlCode({ sql, marks, style }: { sql: string; marks?: Record<number, "add" | "del">; style?: CSSProperties }) {
  const lines = sql.replace(/\s+$/, "").split("\n");
  return (
    <div className="code" style={style}>
      <div className="ln">{lines.map((_, i) => `${i + 1}\n`).join("")}</div>
      <div className="src" style={{ overflowX: "auto" }}>
        {lines.map((l, i) => {
          const m = marks?.[i + 1];
          return (
            <span key={i} className={m === "add" ? "dl-add" : m === "del" ? "dl-del" : undefined} style={m ? undefined : { display: "block" }}>
              {highlight(l)}
              {"\n"}
            </span>
          );
        })}
      </div>
    </div>
  );
}

const KW = /\b(ALTER|TABLE|ADD|DROP|COLUMN|CONSTRAINT|UNIQUE|CHECK|NOT|NULL|DEFAULT|CREATE|INDEX|CONCURRENTLY|ON|UPDATE|SET|WHERE|DELETE|FROM|INSERT|INTO|VALUES|SELECT|AND|OR|TYPE|USING|BEGIN|COMMIT|IF|EXISTS|PRIMARY|KEY|REFERENCES|FOREIGN|RENAME|TO|AS|IN|IS|JOIN|GROUP|BY|HAVING|ORDER|LIMIT|WITH|VARCHAR|INTEGER|NUMERIC|TEXT|BOOLEAN|TIMESTAMP)\b/gi;

function highlight(line: string): ReactNode {
  if (/^\s*--/.test(line)) return <span className="c">{line}</span>;
  const out: ReactNode[] = [];
  let last = 0;
  const re = new RegExp(`(${KW.source})|('(?:[^']|'')*')|(\\b\\d+(?:\\.\\d+)?\\b)`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m.index > last) out.push(line.slice(last, m.index));
    const cls = m[1] ? "k" : m[2] ? "s" : "n";
    out.push(
      <span key={m.index} className={cls}>
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

/** Horizontal risk composition bar (data loss / constraint / lock / rollback …). */
export function RiskBar({ parts }: { parts: { label: string; points: number; kind: string }[] }) {
  const colors: Record<string, string> = {
    data_loss: "#F4B8CC",
    constraint: "#F7C59F",
    lock: "#CBB8F6",
    rollback: "#E6D9E5",
    policy: "#F49AC4",
    ai: "#BFD9B5",
    other: "#E6D9E5",
  };
  const total = parts.reduce((s, p) => s + p.points, 0);
  return (
    <div className="row" style={{ gap: 3, height: 6, width: "100%" }} aria-label={`Risk parts: ${parts.map((p) => `${p.label} ${p.points}`).join(", ")}`}>
      {parts.map((p, i) => (
        <div key={i} title={`${p.label} · ${p.points}`} style={{ flex: p.points, height: "100%", borderRadius: 3, background: colors[p.kind] ?? "#E6D9E5" }} />
      ))}
      {total < 100 && <div style={{ flex: 100 - total }} />}
    </div>
  );
}

/** The sunset hero band used at the top of bloom pages. */
export function HeroBand({ eyebrow, title, children, right }: { eyebrow: ReactNode; title: ReactNode; children?: ReactNode; right?: ReactNode }) {
  return (
    <div className="bloom hero-band">
      <div className="dots" aria-hidden="true" />
      <div className="dots2" aria-hidden="true" />
      <div className="cols" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end", position: "relative", gap: 24, flexWrap: "wrap" }}>
        <div className="col" style={{ gap: 14 }}>
          <span className="b-rule" style={{ width: 110 }} />
          <span className="eyebrow" style={{ color: "#FFF7F2" }}>{eyebrow}</span>
          <span className="display" style={{ maxWidth: 900 }}>{title}</span>
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}
