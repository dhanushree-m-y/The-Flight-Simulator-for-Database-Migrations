"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { TopBar } from "@/components/shell/AppShell";
import { api, useApi } from "@/lib/api";
import { fmtInt, fmtTime } from "@/lib/format";
import type { AuditEvent, AuditVerify } from "@/lib/types";
import { EmptyState, FailState, LoadState, PageHead, download, errMsg, shortHash } from "@/components/admin/kit";

/** Dot colour per action family (design 15). */
function dotColor(action: string): string {
  const a = action.toLowerCase();
  if (a.includes("restore") || a.includes("fail") || a.includes("broken")) return "#A8234F";
  if (a.startsWith("apply") || a.includes("backup") || a.includes("production") || a.includes("executed")) return "#47705A";
  if (a.startsWith("approval")) return a.includes("request") ? "#F7C59F" : "#7758C8";
  if (a.startsWith("ai") || a.includes("fix")) return "#CBB8F6";
  if (a.startsWith("rehearsal")) return "#F4B8CC";
  if (a.startsWith("connection") || a.startsWith("database")) return "#BFD9B5";
  return "#E6D9E5";
}

const human = (action: string) => {
  const s = action.replace(/[._]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

function when(ts: string) {
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return fmtTime(ts);
  const days = (today.getTime() - d.getTime()) / 86400000;
  if (days < 6) return d.toLocaleDateString("en-GB", { weekday: "short" });
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

const fullTs = (ts: string) => {
  const d = new Date(ts);
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
};

const actorName = (e: AuditEvent) => e.actor?.name ?? (e.action.startsWith("ai") ? "◇ DryRun AI" : "DryRun Agent");

type LinkState = "ok" | "bad" | "unknown";

export default function AuditPage() {
  const [action, setAction] = useState("");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<number | null>(null);
  const [full, setFull] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [known, setKnown] = useState<string[]>([]);
  const search = useRef<HTMLInputElement>(null);

  const path = `/api/audit?limit=200${action ? `&action=${encodeURIComponent(action)}` : ""}`;
  const { data, error, loading, reload } = useApi<AuditEvent[]>(path, { pollMs: 20000 });
  const verify = useApi<AuditVerify>("/api/audit/verify");
  const [verifiedAt, setVerifiedAt] = useState<Date | null>(null);

  useEffect(() => {
    if (verify.data && !verifiedAt) setVerifiedAt(new Date());
  }, [verify.data, verifiedAt]);

  // Remember every action we've seen so the filter keeps its options while filtered server-side.
  useEffect(() => {
    if (!data) return;
    setKnown((k) => {
      const next = new Set(k);
      data.forEach((e) => next.add(e.action));
      return next.size === k.length ? k : [...next].sort();
    });
  }, [data]);

  // "/" focuses the filter, as in the design.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !(t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const byId = useMemo(() => new Map((data ?? []).map((e) => [e.id, e])), [data]);
  const events = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return [...(data ?? [])]
      .sort((a, b) => b.id - a.id)
      .filter(
        (e) =>
          !needle ||
          [actorName(e), e.actor?.email ?? "", e.action, e.target ?? "", e.hash, String(e.id)].some((s) => s.toLowerCase().includes(needle)),
      );
  }, [data, q]);

  const brokenAt = verify.data && !verify.data.ok ? verify.data.broken_at : null;
  const linkOf = (e: AuditEvent): LinkState => {
    if (brokenAt != null && e.id === brokenAt) return "bad";
    const prev = byId.get(e.id - 1);
    if (!prev) return "unknown";
    return prev.hash === e.prev_hash ? "ok" : "bad";
  };

  const selected = (sel != null ? byId.get(sel) : undefined) ?? events[0] ?? null;
  const prevEv = selected ? byId.get(selected.id - 1) : undefined;
  const nextEv = selected ? byId.get(selected.id + 1) : undefined;

  async function reverify() {
    setVerifying(true);
    try {
      const v = await api<AuditVerify>("/api/audit/verify");
      verify.setData(v);
      setVerifiedAt(new Date());
      if (v.ok) toast.success(`History verified · all ${fmtInt(v.events)} links checked`);
      else toast.error(`Chain broken at event #${v.broken_at}`);
    } catch (e) {
      toast.error(`Couldn’t verify: ${errMsg(e)}`);
    } finally {
      setVerifying(false);
    }
  }

  function exportAs(kind: "json" | "csv") {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    if (kind === "json") {
      download(`dryrun-audit-${stamp}.json`, JSON.stringify(events, null, 2), "application/json");
    } else {
      const esc = (v: unknown) => {
        const s = v == null ? "" : typeof v === "string" ? v : JSON.stringify(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const head = ["id", "ts", "actor", "actor_email", "action", "target", "prev_hash", "hash", "detail"];
      const rows = events.map((e) => [e.id, e.ts, actorName(e), e.actor?.email ?? "", e.action, e.target ?? "", e.prev_hash, e.hash, e.detail].map(esc).join(","));
      download(`dryrun-audit-${stamp}.csv`, [head.join(","), ...rows].join("\n"), "text/csv");
    }
    toast(`Exported ${events.length} events as ${kind.toUpperCase()}`);
  }

  const v = verify.data;
  const banner = (
    <div
      className="glass row"
      role="status"
      aria-live="polite"
      style={{
        gap: 14,
        padding: "14px 18px",
        ...(v && !v.ok ? { background: "rgba(251,227,236,.85)", borderColor: "rgba(168,35,79,.4)" } : { background: "rgba(230,242,223,.75)", borderColor: "rgba(71,112,90,.3)" }),
      }}
    >
      <span
        style={{
          width: 34,
          height: 34,
          borderRadius: "50%",
          background: !v ? "#CBB8F6" : v.ok ? "#47705A" : "#A8234F",
          color: "#FFFFFF",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          font: "600 15px/1 'Manrope',sans-serif",
          flexShrink: 0,
        }}
        className={!v || verifying ? "breathe" : undefined}
        aria-hidden="true"
      >
        {!v ? "…" : v.ok ? "✓" : "✕"}
      </span>
      <div className="col" style={{ gap: 3 }}>
        <span style={{ font: "600 14px/1 'Manrope',sans-serif", color: v && !v.ok ? "#A8234F" : "#261F29" }}>
          {verify.error && !v ? "Couldn’t verify history" : !v ? "Verifying history…" : v.ok ? "History verified" : `Chain broken at #${v.broken_at}`}
        </span>
        <span className="mono muted" style={{ fontSize: 11 }}>
          {v ? `${v.ok ? "all" : "checked"} ${fmtInt(v.events)} links${verifiedAt ? ` · ${fmtTime(verifiedAt.toISOString())}` : ""}` : verify.error ? verify.error.message : "walking the hash chain"}
        </span>
      </div>
      <button type="button" className="btn btn-sm" onClick={reverify} disabled={verifying} style={{ marginLeft: 6 }}>
        {verifying ? "Verifying…" : "Verify again"}
      </button>
    </div>
  );

  return (
    <div className="pg-audit page">
      <TopBar crumbs={["Audit log"]} />
      <PageHead
        eyebrow={`Audit log · ${v ? fmtInt(v.events) : "…"} events · tamper-evident hash chain`}
        title="Every decision, in order, unaltered."
        right={banner}
      />

      <div className="glass filters" role="search">
        <label className="adm-sr" htmlFor="au-q">Filter by actor, target or hash</label>
        <input id="au-q" ref={search} className="inp" placeholder="Search actor, migration, hash…  ( / )" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: "1 1 260px", width: "auto" }} />
        <label className="adm-sr" htmlFor="au-a">Filter by action</label>
        <select id="au-a" className="inp" value={action} onChange={(e) => setAction(e.target.value)} style={{ flex: "0 1 240px", width: "auto" }}>
          <option value="">All actions</option>
          {known.map((a) => (
            <option key={a} value={a}>{human(a)}</option>
          ))}
        </select>
        <span className="mono muted" style={{ fontSize: 11.5 }}>{events.length} shown</span>
        <div className="row" style={{ gap: 8, marginLeft: "auto" }}>
          <button type="button" className="btn btn-sm" onClick={() => exportAs("json")} disabled={!events.length}>Export JSON</button>
          <button type="button" className="btn btn-sm" onClick={() => exportAs("csv")} disabled={!events.length}>Export CSV</button>
        </div>
      </div>

      {loading && !data ? (
        <LoadState title="Loading the audit chain…" steps={["Fetching the last 200 events", "Checking each link against the one before", "Verifying the full chain"]} />
      ) : error && !data ? (
        <FailState title="Couldn’t load the audit log." error={error} onRetry={reload} />
      ) : !data || data.length === 0 ? (
        <EmptyState
          eyebrow="Empty · nothing recorded yet"
          title={action ? `No “${human(action)}” events.` : "No events yet."}
          body={action ? "Try another action, or clear the filter." : "Every rehearsal, approval, production run and policy change is written here, each sealed with the hash of the one before."}
          action={action ? <button type="button" className="btn" onClick={() => setAction("")}>Clear filter</button> : undefined}
        />
      ) : (
        <div className="adm-grid">
          <div className="panel col" style={{ overflow: "hidden", position: "relative" }}>
            <div aria-hidden="true" style={{ position: "absolute", left: 30, top: 48, bottom: 0, width: 1, background: "linear-gradient(#BFD9B5,#CBB8F6,#F4B8CC)" }} />
            <div className="ev" style={{ font: "500 10.5px/1 'DM Mono',monospace", letterSpacing: ".14em", color: "var(--text2)", paddingTop: 15, paddingBottom: 15 }} aria-hidden="true">
              <span />
              <span className="c-when">WHEN</span>
              <span className="c-who">WHO</span>
              <span>WHAT</span>
              <span className="c-where">WHERE</span>
              <span>HASH</span>
            </div>
            {events.length === 0 ? (
              <div className="state-box muted">No events match “{q}”.</div>
            ) : (
              <ol style={{ listStyle: "none", margin: 0, padding: 0 }} aria-label="Audit events, newest first">
                {events.map((e, i) => {
                  const link = linkOf(e);
                  const isSel = selected?.id === e.id;
                  return (
                    <li key={e.id}>
                      <button
                        type="button"
                        className={`ev${isSel ? " sel" : ""}`}
                        aria-pressed={isSel}
                        onClick={() => setSel(e.id)}
                        style={i === events.length - 1 ? { borderBottom: 0 } : undefined}
                        aria-label={`Event ${e.id}: ${human(e.action)} by ${actorName(e)}, ${fullTs(e.ts)}${link === "bad" ? ", chain link broken" : ""}`}
                      >
                        <i className="lk" style={{ background: link === "bad" ? "#A8234F" : dotColor(e.action) }} />
                        <span className="mono c-when" title={fullTs(e.ts)}>{when(e.ts)}</span>
                        <span className="c-who" style={e.actor ? undefined : { color: "#6A4FB8" }}>{actorName(e)}</span>
                        <span>{human(e.action)}</span>
                        <span className="mono c-where" style={{ fontSize: 11.5, color: e.target ? "var(--text)" : "var(--text2)" }}>{e.target ?? "—"}</span>
                        <span className={`hchip${link === "bad" ? " bad" : ""}`}>
                          {link === "bad" ? "✕" : link === "ok" ? "⛓" : "·"} #{e.id} · {e.hash.slice(0, 6)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          <div className="col" style={{ gap: 18, position: "sticky", top: 16 }}>
            {selected && (
              <div className="glass" style={{ padding: "20px 22px" }} aria-live="polite">
                <div className="row" style={{ justifyContent: "space-between", gap: 10 }}>
                  <span className="eyebrow">Event #{selected.id}</span>
                  {(() => {
                    const l = linkOf(selected);
                    return l === "ok" ? <span className="st st-safe">✓ link valid</span> : l === "bad" ? <span className="st st-block">✕ link broken</span> : <span className="st st-info">prev not loaded</span>;
                  })()}
                </div>
                <div className="col" style={{ paddingTop: 10 }}>
                  <div className="hx"><span>Actor</span><span>{actorName(selected)}{selected.actor ? ` · ${selected.actor.role}` : ""}</span></div>
                  <div className="hx"><span>Action</span><span>{selected.action}</span></div>
                  <div className="hx"><span>Target</span><span>{selected.target ?? "—"}</span></div>
                  <div className="hx"><span>Time</span><span>{fullTs(selected.ts)}</span></div>
                  <div className="hx">
                    <span>Previous hash</span>
                    <span>
                      {prevEv ? (
                        <button type="button" className="hchip" onClick={() => setSel(prevEv.id)} title={`Go to event #${prevEv.id}`} style={{ height: "auto", minHeight: 22, padding: "3px 7px", whiteSpace: "normal", textAlign: "left", overflowWrap: "anywhere" }}>
                          ↑ #{prevEv.id} · {full ? selected.prev_hash : shortHash(selected.prev_hash)}
                        </button>
                      ) : full ? (
                        selected.prev_hash
                      ) : (
                        shortHash(selected.prev_hash)
                      )}
                    </span>
                  </div>
                  <div className="hx" style={{ border: 0 }}><span>Event hash</span><span>{full ? selected.hash : shortHash(selected.hash)}</span></div>
                </div>
                {Object.keys(selected.detail ?? {}).length > 0 && (
                  <details style={{ paddingTop: 8 }}>
                    <summary className="eyebrow" style={{ cursor: "pointer", padding: "6px 0" }}>Detail</summary>
                    <pre className="detail-json">{JSON.stringify(selected.detail, null, 2)}</pre>
                  </details>
                )}
                <div className="row" style={{ gap: 8, paddingTop: 12 }}>
                  <button type="button" className="btn btn-sm" aria-pressed={full} onClick={() => setFull((f) => !f)}>{full ? "Short hashes" : "Full hashes"}</button>
                  <button type="button" className="btn btn-sm" onClick={reverify} disabled={verifying}>Re-verify</button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => navigator.clipboard?.writeText(selected.hash).then(() => toast("Hash copied"), () => toast.error("Clipboard unavailable"))}
                  >
                    Copy hash
                  </button>
                </div>
              </div>
            )}
            <div className="panel" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
              <span className="eyebrow">How the chain works</span>
              {selected && (
                <div className="chain">
                  {prevEv && (
                    <>
                      <button type="button" onClick={() => setSel(prevEv.id)}>#{prevEv.id}<br />{prevEv.hash.slice(0, 4)}…</button>
                      <span className="muted" aria-hidden="true">→</span>
                    </>
                  )}
                  <button type="button" className="cur" aria-current="true">#{selected.id}<br />{selected.hash.slice(0, 4)}…</button>
                  {nextEv && (
                    <>
                      <span className="muted" aria-hidden="true">→</span>
                      <button type="button" onClick={() => setSel(nextEv.id)}>#{nextEv.id}<br />{nextEv.hash.slice(0, 4)}…</button>
                    </>
                  )}
                </div>
              )}
              <span style={{ font: "400 12.5px/1.5 'Manrope',sans-serif", color: "var(--text2)" }}>
                Each event stores the hash of the one before. Change any past event and every later link breaks — the badge above would turn red.
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
