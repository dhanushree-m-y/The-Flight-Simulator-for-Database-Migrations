"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { EvidenceShell, VerdictChip, plural, shortHash, useReducedMotion } from "@/components/evidence/EvidenceShell";
import { EmptyBlock, SqlCode } from "@/components/ui";
import { fmtInt, fmtTime } from "@/lib/format";
import type { Rehearsal, RollbackResult } from "@/lib/types";

const DONE_AT = 4.6;

export default function RollbackPage() {
  const { id } = useParams<{ id: string }>();
  const [replayKey, setReplayKey] = useState(0);
  return (
    <EvidenceShell
      id={id}
      tab="rollback"
      pg="rollback"
      right={(r) => (
        <>
          {r?.rollback && r.rollback.status !== "skipped" && (
            <button type="button" className="btn btn-sm" onClick={() => setReplayKey((k) => k + 1)}>
              ↺ Replay
            </button>
          )}
          {r && <VerdictChip r={r} />}
        </>
      )}
    >
      {(r) => (r.rollback && r.rollback.status !== "skipped" ? <Proof key={replayKey} r={r} rb={r.rollback} /> : <NoProof r={r} rb={r.rollback} />)}
    </EvidenceShell>
  );
}

function NoProof({ r, rb }: { r: Rehearsal; rb: RollbackResult | null }) {
  const live = r.status === "running" || r.status === "queued";
  const title = rb?.status === "skipped" ? "Nothing to roll back." : live ? "Rollback proof comes last." : "No rollback was recorded.";
  const body =
    rb?.message ??
    (rb?.status === "skipped"
      ? r.error
        ? `The migration failed in the sandbox (${r.error}), so it never changed anything the down migration could undo.`
        : "The rollback step was skipped for this rehearsal."
      : live
        ? "DryRun runs the down migration after the checks and compares every table against the before snapshot. This page fills in when that step finishes."
        : "This rehearsal finished without a rollback step — usually because no down migration was provided and none could be generated.");
  return (
    <>
      <div className="col" style={{ gap: 10 }}>
        <span className="eyebrow">Rollback proof · {rb?.status ?? (live ? "pending" : "not run")}</span>
        <h1 className="h1" style={{ margin: 0 }}>
          {title}
        </h1>
      </div>
      <EmptyBlock
        title={rb?.status === "skipped" ? "Rollback skipped" : live ? "Waiting for the rollback step" : "No proof"}
        body={body}
        action={
          <Link className="btn btn-sm" href={`/rehearsals/${r.id}/report`}>
            Back to report
          </Link>
        }
      />
      {rb?.down_sql && <DownSql rb={rb} />}
    </>
  );
}

function useReplay() {
  const reduce = useReducedMotion();
  const [t, setT] = useState(0);
  const raf = useRef(0);
  const run = useCallback(() => {
    cancelAnimationFrame(raf.current);
    const t0 = performance.now();
    const tick = () => {
      const s = (performance.now() - t0) / 1000;
      setT(Math.min(s, DONE_AT));
      if (s < DONE_AT) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, []);
  useEffect(() => {
    if (reduce) {
      setT(DONE_AT);
      return;
    }
    run();
    return () => cancelAnimationFrame(raf.current);
  }, [reduce, run]);
  return t;
}

const STATIONS = [
  { label: "Before snapshot", bg: "#BFD9B5" },
  { label: "Migration", bg: "#F7C59F" },
  { label: "After snapshot", bg: "#CBB8F6" },
  { label: "Checks", bg: "#CBB8F6" },
  { label: "Down migration", bg: "#F4B8CC" },
];

function Proof({ r, rb }: { r: Rehearsal; rb: RollbackResult }) {
  const t = useReplay();
  const ease = 1 - Math.pow(1 - Math.min(1, t / 2.6), 3);
  const markX = 90 - ease * 80;
  const done = t >= DONE_AT;
  const shown = (at: number) => t >= at;

  const tables = rb.tables;
  const before = tables.reduce((s, x) => s + x.rows_before, 0);
  const after = tables.reduce((s, x) => s + x.rows_after, 0);
  const countsOk = tables.every((x) => x.rows_before === x.rows_after);
  const hashOk = tables.every((x) => x.checksum_before === x.checksum_after);
  const identicalTables = tables.filter((x) => x.identical).length;
  const ok = rb.identical && rb.status === "passed";
  const pct = tables.length ? Math.floor((identicalTables / tables.length) * 100) : ok ? 100 : 0;
  const targetHash = tables[0]?.checksum_before;

  const headline = t < 2.6 ? "Rolling back…" : !done ? "Verifying original state…" : ok ? "Back exactly where we started." : "The rollback did not restore the original state.";
  const phase = t < 2.6 ? "running down migration" : !done ? "comparing hashes" : ok ? "state restored" : "state differs";

  const checks = [
    { at: 2.9, label: `Row counts · ${tables.length} ${plural(tables.length, "table")}`, ok: countsOk, value: `${fmtInt(after)} / ${fmtInt(before)}` },
    { at: 3.4, label: "Tables · identical after rollback", ok: identicalTables === tables.length, value: `${identicalTables} / ${tables.length}` },
    { at: 3.9, label: "Data · row-level hash", ok: hashOk, value: hashOk ? "MATCH" : "MISMATCH" },
    { at: 4.4, label: "Verdict", ok, value: ok ? "IDENTICAL" : "DIFFERS" },
  ];

  const logs = r.logs.filter((l) => /rollback|down|hash|restore/i.test(`${l.source} ${l.message}`)).slice(-6);

  return (
    <>
      <div className="col" style={{ gap: 10 }} aria-live="polite">
        <span className="eyebrow">Rollback proof · {rb.down_sql_source === "ai" ? "AI-generated down migration" : rb.down_sql_source === "user" ? "engineer’s down migration" : "down migration"}</span>
        <h1 className="h1" style={{ margin: 0 }}>
          {headline}
        </h1>
      </div>

      <div className="glass" style={{ padding: "26px 30px 22px" }}>
        <div className="row" style={{ position: "relative", alignItems: "flex-start" }}>
          <div style={{ position: "absolute", left: "6%", right: "6%", top: 14, height: 2, background: "linear-gradient(90deg,#BFD9B5,#CBB8F6 50%,#F4B8CC)" }} />
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              top: 3,
              left: `${markX.toFixed(1)}%`,
              width: 24,
              height: 24,
              marginLeft: -12,
              borderRadius: "50%",
              background: ok || !done ? "#47705A" : "#A8234F",
              boxShadow: `0 0 0 7px ${ok || !done ? "rgba(71,112,90,.16)" : "rgba(168,35,79,.16)"}`,
              zIndex: 2,
            }}
          />
          {STATIONS.map((s, i) => (
            <div key={s.label} className="stn">
              <i style={{ background: s.bg }}>{i + 1}</i>
              <span style={{ textAlign: "center" }}>{s.label}</span>
            </div>
          ))}
        </div>
        <div className="row mono" style={{ justifyContent: "space-between", gap: 12, paddingTop: 14, fontSize: 11, color: "var(--text2)", flexWrap: "wrap" }}>
          <span>← target state · {shortHash(targetHash)}</span>
          <span>{phase}</span>
          <span>current state →</span>
        </div>
      </div>

      <div className="ev-rb2">
        <div className="panel" style={{ padding: "10px 24px" }}>
          {checks.map((c, i) => {
            const v = shown(c.at);
            return (
              <div key={c.label} className="vr" style={i === checks.length - 1 ? { border: 0 } : undefined}>
                <span style={{ color: !v ? "#B3A5B6" : c.ok ? "#47705A" : "#A8234F" }} aria-hidden="true">
                  {!v ? "○" : c.ok ? "✓" : "✕"}
                </span>
                <span>{c.label}</span>
                <span className="mono" style={{ fontSize: 12.5, color: v && !c.ok ? "#A8234F" : undefined }}>
                  {v ? c.value : "…"}
                </span>
              </div>
            );
          })}

          <div className="scroll-x" style={{ margin: "6px 0 10px" }}>
            <table style={{ width: "100%", minWidth: 480, borderCollapse: "collapse", font: "400 12px/1.3 'DM Mono',monospace" }}>
              <caption className="eyebrow" style={{ textAlign: "left", padding: "10px 0" }}>
                Per-table proof
              </caption>
              <thead>
                <tr className="eyebrow" style={{ textAlign: "left" }}>
                  <th style={{ padding: "8px 8px 8px 0", fontWeight: 500 }}>Table</th>
                  <th style={{ padding: 8, fontWeight: 500, textAlign: "right" }}>Rows before</th>
                  <th style={{ padding: 8, fontWeight: 500, textAlign: "right" }}>Rows after</th>
                  <th style={{ padding: 8, fontWeight: 500 }}>Checksum before</th>
                  <th style={{ padding: 8, fontWeight: 500 }}>Checksum after</th>
                  <th style={{ padding: "8px 0 8px 8px", fontWeight: 500, textAlign: "center" }}>Match</th>
                </tr>
              </thead>
              <tbody>
                {tables.map((x) => (
                  <tr key={x.table} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ padding: "9px 8px 9px 0", fontSize: 12.5 }}>{x.table}</td>
                    <td style={{ padding: 8, textAlign: "right" }}>{fmtInt(x.rows_before)}</td>
                    <td style={{ padding: 8, textAlign: "right", color: x.rows_after !== x.rows_before ? "#A8234F" : undefined }}>{fmtInt(x.rows_after)}</td>
                    <td style={{ padding: 8 }} title={x.checksum_before}>
                      {shortHash(x.checksum_before)}
                    </td>
                    <td style={{ padding: 8, color: x.checksum_after !== x.checksum_before ? "#A8234F" : undefined }} title={x.checksum_after}>
                      {shortHash(x.checksum_after)}
                    </td>
                    <td style={{ padding: "8px 0 8px 8px", textAlign: "center", color: x.identical ? "#47705A" : "#A8234F" }} aria-label={x.identical ? "identical" : "differs"}>
                      {x.identical ? "✓" : "✕"}
                    </td>
                  </tr>
                ))}
                {tables.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted" style={{ padding: "12px 0" }}>
                      No tables were compared.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {logs.length > 0 && (
            <div className="console" style={{ padding: "12px 16px", margin: "6px 0 14px", whiteSpace: "pre-wrap", fontSize: 11.5, wordBreak: "break-word" }}>
              {logs.map((l, i) => (
                <div key={i}>
                  <span className="t">{fmtTime(l.ts)}</span>
                  {"  "}
                  {l.source.padEnd(20, " ")}
                  <span className={l.level === "error" ? "e" : l.level === "warn" ? "w" : l.level === "ai" ? "a" : undefined}>{l.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {done ? <VerdictCard r={r} rb={rb} ok={ok} pct={pct} before={before} after={after} countsOk={countsOk} hashOk={hashOk} identicalTables={identicalTables} /> : <div className="glass state-box muted" style={{ minHeight: 320 }} aria-busy="true">Comparing the restored sandbox with the before snapshot…</div>}
      </div>

      <DownSql rb={rb} />
    </>
  );
}

function VerdictCard({
  r,
  rb,
  ok,
  pct,
  before,
  after,
  countsOk,
  hashOk,
  identicalTables,
}: {
  r: Rehearsal;
  rb: RollbackResult;
  ok: boolean;
  pct: number;
  before: number;
  after: number;
  countsOk: boolean;
  hashOk: boolean;
  identicalTables: number;
}) {
  const green = "#47705A";
  const red = "#A8234F";
  const ink = ok ? green : red;
  const tile = (label: string, pass: boolean) => (
    <div className="m" style={pass ? undefined : { borderColor: "rgba(168,35,79,.25)" }}>
      <span className="eyebrow">{label}</span>
      <span className="mono" style={{ color: pass ? green : red, fontSize: 14 }}>
        {pass ? "✓ MATCH" : "✕ DIFFERS"}
      </span>
    </div>
  );
  const allHashes = rb.tables.length > 0 && hashOk;
  return (
    <div
      className="glass rise"
      role="status"
      style={{
        position: "relative",
        padding: "28px 30px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        background: ok ? "rgba(230,242,223,.62)" : "rgba(255,215,229,.55)",
        borderColor: ok ? "rgba(71,112,90,.3)" : "rgba(168,35,79,.3)",
        boxShadow: ok ? "0 1px 0 rgba(255,255,255,.9) inset,0 20px 44px rgba(71,112,90,.14)" : "0 1px 0 rgba(255,255,255,.9) inset,0 20px 44px rgba(168,35,79,.14)",
      }}
    >
      {ok && (
        <div aria-hidden="true" style={{ position: "absolute", right: 34, top: 64, width: 120, height: 120 }}>
          <div className="burst" style={{ position: "absolute", inset: 0 }}>
            <i style={{ "--dx": "-70px", "--dy": "-40px", animationIterationCount: 2 } as CSSProperties}>✦</i>
            <i style={{ "--dx": "60px", "--dy": "-52px", animationDelay: ".08s", color: "#F49AC4", animationIterationCount: 2 } as CSSProperties}>✦</i>
            <i style={{ "--dx": "74px", "--dy": "14px", animationDelay: ".12s", color: "#47705A", animationIterationCount: 2 } as CSSProperties}>•</i>
            <i style={{ "--dx": "-76px", "--dy": "22px", animationDelay: ".05s", color: "#CBB8F6", animationIterationCount: 2 } as CSSProperties}>✦</i>
            <i style={{ "--dx": "-24px", "--dy": "62px", animationDelay: ".15s", animationIterationCount: 2 } as CSSProperties}>✦</i>
            <i style={{ "--dx": "40px", "--dy": "58px", animationDelay: ".1s", color: "#BFD9B5", animationIterationCount: 2 } as CSSProperties}>✦</i>
          </div>
          <svg width="120" height="120" viewBox="-23 -23 46 46" style={{ position: "absolute", inset: 0, filter: "drop-shadow(0 0 14px rgba(232,69,143,.4))" }}>
            {[0, 72, 144, 216, 288].map((rot, i) => (
              <g key={rot} transform={rot ? `rotate(${rot})` : undefined}>
                <ellipse className="petal" cx="0" cy="-10" rx="7.5" ry="10.5" fill={i % 2 ? "#EC5A95" : "#E8458F"} style={{ animationDelay: `${0.05 + i * 0.15}s` }} />
              </g>
            ))}
            <circle r="6" fill="#F7A8CB" />
            <circle r="3" fill="#FFFFFF" />
          </svg>
        </div>
      )}
      <div className="row" style={{ justifyContent: "space-between", gap: 10 }}>
        <span className="eyebrow" style={{ color: ink }}>
          {ok ? "Rollback verified" : rb.status === "failed" ? "Rollback failed" : "Rollback mismatch"}
        </span>
        <span className={ok ? "st st-safe" : "st st-block"}>{ok ? "✓ identical" : "✕ differs"}</span>
      </div>
      <div className="row" style={{ alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <span className="serif" style={{ fontSize: 120, lineHeight: 0.78, color: ink }}>
          {pct}%
        </span>
        <span style={{ font: "500 11px/1.4 'DM Mono',monospace", letterSpacing: ".16em", paddingBottom: 10 }}>{ok ? "IDENTICAL" : `OF TABLES IDENTICAL · ${identicalTables}/${rb.tables.length}`}</span>
      </div>
      <span style={{ font: "500 15px/1.4 'Manrope',sans-serif" }}>
        {fmtInt(after)} / {fmtInt(before)} rows restored
      </span>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 10 }}>
        {tile("Row counts", countsOk)}
        {tile("Data hash", hashOk)}
        {tile("Tables", identicalTables === rb.tables.length)}
      </div>
      <div className="row" style={{ gap: 10, padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,.7)" }}>
        <span className="eyebrow">Hash</span>
        <span className="mono" style={{ fontSize: 14, marginLeft: "auto", color: allHashes ? undefined : red }}>
          {rb.tables.length ? `${shortHash(rb.tables[0].checksum_after)} ${allHashes ? "✓" : "✕"}` : "—"}
        </span>
      </div>
      {rb.message && <span style={{ font: "400 13px/1.5 'Manrope',sans-serif" }}>{rb.message}</span>}
      <span style={{ font: "400 12.5px/1.5 'Manrope',sans-serif", color: "var(--text2)" }}>
        {ok
          ? `Undo is proven inside the sandbox. It does not make V${r.version} safe to apply${r.status === "blocked" ? " — the report still says do not apply." : " on its own; the report’s verdict still stands."}`
          : "The down migration did not return the sandbox to its original state. Fix the down SQL before this migration can be approved."}
      </span>
    </div>
  );
}

function DownSql({ rb }: { rb: RollbackResult }) {
  if (!rb.down_sql) return null;
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <span className="h2" style={{ fontSize: 24 }}>
          Down migration
        </span>
        {rb.down_sql_source === "ai" ? (
          <span className="st st-ai">◇ AI-generated</span>
        ) : rb.down_sql_source === "user" ? (
          <span className="st st-info">written by engineer</span>
        ) : null}
        <span className="mono muted" style={{ fontSize: 11.5, marginLeft: "auto" }}>
          ran in the sandbox only
        </span>
      </div>
      <SqlCode sql={rb.down_sql} />
    </div>
  );
}
