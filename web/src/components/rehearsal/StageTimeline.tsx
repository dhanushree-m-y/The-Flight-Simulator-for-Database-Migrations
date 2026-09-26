"use client";

import type { CSSProperties } from "react";
import { fmtDuration } from "@/lib/format";
import type { Metrics, Stage, StageKey } from "@/lib/types";
import { STAGE_NAMES, STAGE_ORDER } from "./util";

type Pal = {
  pass: string;
  warn: string;
  fail: string;
  ink: string;
  nodeBg: string;
  run: string;
  warnInk: string;
  failInk: string;
  track: string;
  fill: string;
  pending: Record<StageKey, [string, string]>; // [border, glyph]
};

const LIGHT: Pal = {
  pass: "#F4B8CC",
  warn: "#F7C59F",
  fail: "#A8234F",
  ink: "var(--text)",
  nodeBg: "#FFFFFF",
  run: "#47705A",
  warnInk: "#A3552F",
  failInk: "#A8234F",
  track: "var(--line2)",
  fill: "linear-gradient(90deg,#F4B8CC,#F7C59F 45%,#BFD9B5)",
  pending: {
    provision: ["#F4B8CC", "#B8386E"],
    snapshot: ["#F4B8CC", "#B8386E"],
    migrate: ["#F7C59F", "#A3552F"],
    compare: ["#BFD9B5", "#47705A"],
    ai_checks: ["#CBB8F6", "#6A4FB8"],
    rollback: ["#BFD9B5", "#47705A"],
    report: ["#F4B8CC", "#B8386E"],
  },
};

const DARK: Pal = {
  pass: "#F08AB0",
  warn: "#EFA77E",
  fail: "#FF8FAE",
  ink: "#1D1520",
  nodeBg: "#1D1520",
  run: "#9CC99A",
  warnInk: "#EFA77E",
  failInk: "#FF8FAE",
  track: "rgba(255,226,245,.12)",
  fill: "linear-gradient(90deg,#F08AB0,#EFA77E 45%,#9CC99A)",
  pending: {
    provision: ["#F08AB0", "#F08AB0"],
    snapshot: ["#F08AB0", "#F08AB0"],
    migrate: ["#EFA77E", "#EFA77E"],
    compare: ["#9CC99A", "#9CC99A"],
    ai_checks: ["#B9A2F0", "#B9A2F0"],
    rollback: ["#9CC99A", "#9CC99A"],
    report: ["#F08AB0", "#F08AB0"],
  },
};

/** Progress (0–1) inside the running stage, from real metrics where the stage has a measurable unit of work. */
function stageFraction(s: Stage, m: Metrics, now: number): number | null {
  if (s.key === "compare" && m.rows_total > 0) return Math.min(1, m.rows_scanned / m.rows_total);
  if (s.key === "ai_checks" && m.checks_total > 0) return Math.min(1, m.checks_run / m.checks_total);
  if (s.started_at) return Math.min(0.9, (now - new Date(s.started_at).getTime()) / 8000);
  return null;
}

export function StageTimeline({ stages, metrics, dark, now }: { stages: Stage[]; metrics: Metrics; dark: boolean; now: number }) {
  const P = dark ? DARK : LIGHT;
  const byKey = new Map(stages.map((s) => [s.key, s]));
  const ordered: Stage[] = STAGE_ORDER.map(
    (k) => byKey.get(k) ?? { key: k, label: STAGE_NAMES[k].join(" "), status: "pending", started_at: null, duration_ms: null, detail: null },
  );
  // include any stage the API adds that we don't know about, at the end
  stages.forEach((s) => !STAGE_ORDER.includes(s.key) && ordered.push(s));
  const n = ordered.length;

  // how far the gradient fill reaches: last non-pending node, plus half a segment × progress while it runs
  let reach = -1;
  let frac = 0;
  ordered.forEach((s, i) => {
    if (s.status !== "pending") reach = i;
  });
  const running = ordered.find((s) => s.status === "running");
  if (running) frac = stageFraction(running, metrics, now) ?? 0.3;
  const firstPending = ordered.findIndex((s) => s.status === "pending");
  const span = 100 - 100 / n; // node centres run from half-a-cell to 100% − half-a-cell
  const inset = 50 / n;
  const fillPct = reach < 0 ? 0 : Math.min(span, (span * (reach + (running ? frac * 0.5 : 0))) / Math.max(1, n - 1));
  const doneCount = ordered.filter((s) => s.status !== "pending" && s.status !== "running").length;

  return (
    <div className="glass tl-scroll" style={{ padding: "26px 28px 22px" }}>
      <ol
        className="row"
        style={{ position: "relative", listStyle: "none", margin: 0, padding: 0, alignItems: "flex-start" }}
        aria-label={`Rehearsal stages · ${doneCount} of ${n} complete${running ? ` · ${STAGE_NAMES[running.key]?.join(" ") ?? running.label} running` : ""}`}
      >
        <li aria-hidden="true" style={{ position: "absolute", left: `${inset}%`, right: `${inset}%`, top: 16, height: 2, background: P.track }} />
        <li
          aria-hidden="true"
          className="grow-x tl-fill"
          style={{ position: "absolute", left: `${inset}%`, width: `${fillPct}%`, top: 16, height: 2, background: P.fill }}
        />
        {ordered.map((s, i) => {
          const name = STAGE_NAMES[s.key] ?? [s.label];
          let o: CSSProperties = {};
          let glyph = "○";
          let nmStyle: CSSProperties | undefined;
          let nmCls = "nm";
          let tm: string = "—";
          let tmStyle: CSSProperties | undefined;
          let pulse = false;
          switch (s.status) {
            case "passed":
              glyph = "✓";
              o = { background: P.pass, color: P.ink };
              tm = fmtDuration(s.duration_ms);
              break;
            case "warning":
              glyph = "△";
              o = { background: P.warn, color: P.ink };
              tm = s.detail || fmtDuration(s.duration_ms);
              tmStyle = { color: P.warnInk };
              break;
            case "failed":
              glyph = "✕";
              o = { background: P.fail, color: dark ? "#1D1520" : "#FFFFFF" };
              tm = s.detail || "failed";
              tmStyle = { color: P.failInk };
              break;
            case "running": {
              glyph = "◉";
              pulse = true;
              o = { background: P.nodeBg, borderColor: P.run, color: P.run, borderRadius: "50%" };
              nmStyle = { color: P.run };
              const f = stageFraction(s, metrics, now);
              tm =
                (s.key === "compare" || s.key === "ai_checks") && f != null
                  ? `${Math.round(f * 100)}%`
                  : s.started_at
                    ? fmtDuration(Math.max(0, now - new Date(s.started_at).getTime()))
                    : "running";
              tmStyle = { color: P.run };
              break;
            }
            case "skipped":
              glyph = "–";
              o = { background: P.nodeBg, border: `1px dashed ${P.track}`, color: "var(--text2)" };
              nmCls = "nm muted";
              tm = "skipped";
              break;
            default: {
              const [b, g] = P.pending[s.key] ?? ["var(--line2)", "var(--text2)"];
              o = { background: P.nodeBg, border: `1px dashed ${b}`, color: g };
              nmCls = "nm muted";
              tm = i === firstPending ? "queued" : "—";
            }
          }
          return (
            <li key={s.key} className="node" aria-current={s.status === "running" ? "step" : undefined} title={s.detail ?? undefined}>
              <span className={`o${pulse ? " pulse" : ""}`} style={o} aria-hidden="true">
                {glyph}
              </span>
              <span className={nmCls} style={nmStyle}>
                {name.map((w, j) => (
                  <span key={j}>
                    {j > 0 && <br />}
                    {w}
                  </span>
                ))}
                <span className="sr-only" style={srOnly}>
                  {` · ${s.status}`}
                </span>
              </span>
              <span className="tm tab" style={{ ...tmStyle, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {tm}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const srOnly: CSSProperties = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" };
