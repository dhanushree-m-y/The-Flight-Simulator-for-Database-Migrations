"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { TopBar } from "@/components/shell/AppShell";
import { useShell } from "@/components/shell/ShellContext";
import { EmptyBlock, ErrorBlock, LoadingBlock, Skeleton } from "@/components/ui";
import { SqlEditor } from "@/components/rehearsals/SqlEditor";
import { api, useApi } from "@/lib/api";
import { fmtBytes, fmtInt } from "@/lib/format";
import type { Connection, Rehearsal, SchemaTable, StaticHint } from "@/lib/types";
import "@/components/rehearsals/screens.css";

/* ------------------------------------------------------------------ helpers */

/** Editor presets for the hostel demo database. Table names may differ in a real schema — they're examples. */
const EXAMPLES: { key: string; label: string; up: string; down: string }[] = [
  {
    key: "capacity",
    label: "Room capacity check",
    up: "-- room_capacity_check\n-- example · adjust table/column names to your schema\nALTER TABLE rooms\n  ADD CONSTRAINT rooms_capacity_check CHECK (occupied <= capacity);\n",
    down: "ALTER TABLE rooms DROP CONSTRAINT rooms_capacity_check;\n",
  },
  {
    key: "phone",
    label: "Unique student phone",
    up: "-- students_phone_unique\n-- example · adjust table/column names to your schema\nALTER TABLE students\n  ADD CONSTRAINT students_phone_key UNIQUE (phone);\n",
    down: "ALTER TABLE students DROP CONSTRAINT students_phone_key;\n",
  },
  {
    key: "mess",
    label: "Add mess plan column",
    up: "-- students_mess_plan\n-- example · adjust table/column names to your schema\nALTER TABLE students\n  ADD COLUMN mess_plan text NOT NULL DEFAULT 'veg';\n",
    down: "ALTER TABLE students DROP COLUMN mess_plan;\n",
  },
];

const slug = (s: string) =>
  s
    .trim()
    .replace(/\.sql$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_")
    .slice(0, 80);

function timestampName() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `migration_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

/** Name from the first comment line ("-- 004_room_capacity.sql · abc123" → "004_room_capacity"). */
function deriveName(sql: string): string | null {
  for (const raw of sql.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^--\s*(.+)$/.exec(line);
    if (!m) return null;
    const s = slug(m[1].split(/\s[·|—-]\s/)[0]);
    return s.length >= 3 ? s : null;
  }
  return null;
}

/** Split into statements, ignoring comment-only chunks. */
function sqlStats(sql: string) {
  const body = sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const statements = body.split(";").filter((s) => s.trim()).length;
  const ddl = /\b(ALTER|CREATE|DROP|RENAME|TRUNCATE)\b/i.test(body);
  const dml = /\b(UPDATE|INSERT|DELETE)\b/i.test(body);
  const concurrent = /\bCONCURRENTLY\b/i.test(body);
  const kind = ddl && dml ? "DDL + DML" : ddl ? "DDL" : dml ? "DML" : "query";
  return { statements, kind, transactional: !concurrent };
}

/** Tables the SQL names (ALTER TABLE x, UPDATE x, REFERENCES x, …), lower-cased without schema/quotes. */
function touchedTables(sql: string): Set<string> {
  const out = new Set<string>();
  const re = /\b(?:ALTER\s+TABLE(?:\s+IF\s+EXISTS)?(?:\s+ONLY)?|UPDATE|INSERT\s+INTO|DELETE\s+FROM|REFERENCES|TRUNCATE(?:\s+TABLE)?|DROP\s+TABLE(?:\s+IF\s+EXISTS)?|ON|FROM|JOIN)\s+("?[\w.]+"?)/gi;
  let m: RegExpExecArray | null;
  const body = sql.replace(/--[^\n]*/g, "");
  while ((m = re.exec(body))) {
    const name = m[1].replace(/"/g, "").split(".").pop()!.toLowerCase();
    if (name) out.add(name);
  }
  return out;
}

const HINT_CHIP: Record<StaticHint["level"], string> = { danger: "st st-block", warn: "st st-review", info: "st st-info" };
const HINT_ICON: Record<StaticHint["level"], string> = { danger: "✕", warn: "△", info: "ⓘ" };
const HINT_RANK: Record<StaticHint["level"], number> = { danger: 0, warn: 1, info: 2 };

/* ------------------------------------------------------------------ page */

export default function NewRehearsalPage() {
  return (
    <Suspense
      fallback={
        <>
          <TopBar crumbs={["Rehearsals", "New rehearsal"]} env={{ kind: "sandbox", id: "created on start" }} />
          <div className="pg-new page" style={{ paddingTop: 38 }}>
            <LoadingBlock lines={6} />
          </div>
        </>
      }
    >
      <NewRehearsal />
    </Suspense>
  );
}

function NewRehearsal() {
  const router = useRouter();
  const params = useSearchParams();
  const { dark } = useShell();
  const parentId = params.get("parent");
  const wantConn = params.get("connection");

  const conns = useApi<Connection[]>("/api/connections");
  const parent = useApi<Rehearsal>(parentId ? `/api/rehearsals/${parentId}` : null);

  const [connId, setConnId] = useState<string | null>(null);
  const [sql, setSql] = useState("");
  const [down, setDown] = useState("");
  const [showDown, setShowDown] = useState(false);
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [tab, setTab] = useState<"write" | "upload">("write");
  const [aiChecks, setAiChecks] = useState(true);
  const [rollback, setRollback] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
  }, []);

  // Default connection: ?connection=, else the first one.
  useEffect(() => {
    if (connId || !conns.data?.length) return;
    setConnId(conns.data.find((c) => c.id === wantConn)?.id ?? conns.data[0].id);
  }, [conns.data, connId, wantConn]);

  // Re-rehearsal: prefill from the parent version once.
  const prefilled = useRef(false);
  useEffect(() => {
    const p = parent.data;
    if (!p || prefilled.current) return;
    prefilled.current = true;
    setSql(p.up_sql);
    setDown(p.down_sql ?? "");
    setShowDown(!!p.down_sql);
    setName(p.name);
    setNameTouched(true);
    setConnId(p.connection_id);
    toast(`Loaded ${p.name} · V${p.version}`, { description: "Edit the SQL and rehearse it again as the next version." });
  }, [parent.data]);

  const conn = conns.data?.find((c) => c.id === connId) ?? null;
  const schema = useApi<SchemaTable[]>(connId ? `/api/connections/${connId}/schema` : null);

  const updateSql = useCallback(
    (v: string) => {
      setSql(v);
      if (!nameTouched) setName(deriveName(v) ?? "");
    },
    [nameTouched],
  );

  /* ---------- live static analysis (debounced) ---------- */
  const [hints, setHints] = useState<StaticHint[] | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeFailed, setAnalyzeFailed] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    const id = ++seq.current;
    if (!connId || !sql.trim()) {
      setHints(null);
      setAnalyzing(false);
      setAnalyzeFailed(false);
      return;
    }
    setAnalyzing(true);
    const t = setTimeout(async () => {
      try {
        const res = await api<StaticHint[]>("/api/analyze", { method: "POST", json: { sql, connection_id: connId } });
        if (id !== seq.current) return;
        setHints([...res].sort((a, b) => HINT_RANK[a.level] - HINT_RANK[b.level] || (a.line ?? 0) - (b.line ?? 0)));
        setAnalyzeFailed(false);
      } catch {
        if (id !== seq.current) return;
        setAnalyzeFailed(true);
      } finally {
        if (id === seq.current) setAnalyzing(false);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [sql, connId]);

  const stats = useMemo(() => sqlStats(sql), [sql]);
  const touched = useMemo(() => touchedTables(sql), [sql]);
  const warnCount = hints?.filter((h) => h.level !== "info").length ?? 0;

  /* ---------- submit ---------- */
  const missing = !conn ? "Pick a database to rehearse against." : !sql.trim() ? "Write or upload a migration first." : null;
  const canSubmit = !missing && !submitting;

  const submitRef = useRef<() => void>(() => undefined);
  const inFlight = useRef(false);
  const submit = async () => {
    if (inFlight.current) return;
    if (missing) {
      toast.error(missing);
      return;
    }
    const finalName = slug(name) || deriveName(sql) || timestampName();
    inFlight.current = true;
    setSubmitting(true);
    try {
      const r = await api<Rehearsal>("/api/rehearsals", {
        method: "POST",
        json: {
          connection_id: conn!.id,
          name: finalName,
          up_sql: sql,
          down_sql: down.trim() ? down : null,
          parent_id: parentId ?? null,
          options: { ai_checks: aiChecks, rollback },
        },
      });
      toast.success("Rehearsal started", { description: `${r.name} · V${r.version} — spinning up an isolated sandbox.` });
      router.push(`/rehearsals/${r.id}`);
    } catch (e) {
      toast.error("Couldn’t start the rehearsal", { description: (e as Error).message });
      inFlight.current = false;
      setSubmitting(false);
    }
  };
  submitRef.current = submit;
  const fireSubmit = useCallback(() => submitRef.current(), []);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        submitRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ---------- examples + upload ---------- */
  const updateSqlFresh = (v: string) => {
    setSql(v);
    setName(deriveName(v) ?? "");
  };
  const loadExample = (ex: (typeof EXAMPLES)[number]) => {
    setTab("write");
    setNameTouched(false);
    updateSqlFresh(ex.up);
    setDown(ex.down);
    setShowDown(true);
    toast(`Example loaded · ${ex.label}`, { description: "Table and column names may differ in your database — check the schema panel." });
  };

  const readFile = async (file: File | undefined | null) => {
    if (!file) return;
    if (file.size > 1_000_000) {
      toast.error("That file is over 1 MB — is it really a migration?");
      return;
    }
    const text = await file.text();
    setSql(text);
    setName(slug(file.name) || deriveName(text) || "");
    setNameTouched(true);
    setTab("write");
    toast.success(`Loaded ${file.name}`);
  };

  /* ---------- step state ---------- */
  const step = !conn ? 1 : !sql.trim() ? 2 : 4;
  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    (el?.querySelector("button, input, textarea, [tabindex]") as HTMLElement | null)?.focus({ preventScroll: true });
  };

  const submitKbd = isMac ? "⌘↵" : "Ctrl ↵";

  return (
    <>
      <TopBar crumbs={[<Link key="r" href="/rehearsals" style={{ textDecoration: "none" }}>Rehearsals</Link>, "New rehearsal"]} env={{ kind: "sandbox", id: "created on start" }} />
      <div className="pg-new page">
        <div className="nr-grid">
          {/* ---------------- steps ---------------- */}
          <nav className="col nr-steps" aria-label="Rehearsal setup steps">
            <h1 className="h1" style={{ fontSize: 40, paddingBottom: 18, margin: 0 }}>
              {parent.data ? `Rehearse V${parent.data.version + 1}` : "New rehearsal"}
            </h1>
            <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
              <li>
                <button type="button" className="stp" aria-current={step === 1 ? "step" : undefined} onClick={() => scrollTo("nr-db")}>
                  <span className="n" style={step === 1 ? { color: "#B8386E" } : undefined}>01</span>
                  <span className="col" style={{ gap: 4, minWidth: 0 }}>
                    <span className="h3" style={step === 1 ? { color: "#B8386E" } : undefined}>Database</span>
                    {conn ? (
                      <>
                        <span className="mono muted" style={{ fontSize: 12 }}>
                          {conn.name} · {conn.engine}
                          <br />
                          {fmtBytes(conn.size_bytes)} · {fmtInt(conn.rows)} rows
                        </span>
                        {conn.read_only ? (
                          <span className="st st-safe" style={{ alignSelf: "flex-start", marginTop: 4 }}>✓ read-only verified</span>
                        ) : (
                          <span className="st st-review" style={{ alignSelf: "flex-start", marginTop: 4 }}>△ write access</span>
                        )}
                      </>
                    ) : (
                      <span className="mono muted" style={{ fontSize: 12 }}>{conns.loading ? "loading…" : "choose a connection"}</span>
                    )}
                  </span>
                </button>
              </li>
              <li>
                <button type="button" className="stp" aria-current={step === 2 ? "step" : undefined} onClick={() => scrollTo("nr-sql")}>
                  <span className="n" style={step === 2 ? { color: "#B8386E" } : undefined}>02</span>
                  <span className="col" style={{ gap: 4, minWidth: 0 }}>
                    <span className="h3" style={step === 2 ? { color: "#B8386E" } : undefined}>Migration</span>
                    <span className="mono muted ellipsis" style={{ fontSize: 12 }}>
                      {sql.trim() ? `${slug(name) || deriveName(sql) || "unnamed"} · ${stats.statements} stmt` : "write, upload or pick an example"}
                    </span>
                  </span>
                </button>
              </li>
              <li>
                <button type="button" className="stp" onClick={() => scrollTo("nr-checks")}>
                  <span className="n">03</span>
                  <span className="col" style={{ gap: 4 }}>
                    <span className="h3">Configure</span>
                    <span className="mono muted" style={{ fontSize: 12 }}>{Number(aiChecks) + Number(rollback)} of 2 optional checks</span>
                  </span>
                </button>
              </li>
              <li>
                <button type="button" className="stp" style={{ borderBottom: 0 }} aria-current={step === 4 ? "step" : undefined} onClick={() => scrollTo("nr-preflight")}>
                  <span className="n" style={step === 4 ? { color: "#B8386E" } : undefined}>04</span>
                  <span className="col" style={{ gap: 4 }}>
                    <span className="h3" style={step === 4 ? { color: "#B8386E" } : undefined}>Pre-flight</span>
                    <span className="mono" style={{ fontSize: 12, color: warnCount ? "#A3552F" : "var(--text2)" }}>
                      {!sql.trim() || !conn
                        ? "waiting for SQL"
                        : analyzing && !hints
                          ? "reading your SQL…"
                          : analyzeFailed && !hints
                            ? "static read unavailable"
                            : warnCount
                              ? `${warnCount} preliminary warning${warnCount > 1 ? "s" : ""}`
                              : "no static warnings"}
                    </span>
                  </span>
                </button>
              </li>
            </ol>
          </nav>

          {/* ---------------- centre: database + SQL ---------------- */}
          <div className="col" style={{ gap: 16, minWidth: 0 }}>
            <section id="nr-db" className="col" style={{ gap: 10 }} aria-labelledby="nr-db-h">
              <span id="nr-db-h" className="eyebrow">01 · Database to rehearse against</span>
              {conns.error && !conns.data ? (
                <ErrorBlock error={conns.error} onRetry={conns.reload} />
              ) : !conns.data ? (
                <div className="conn-grid" aria-busy="true">
                  {[0, 1].map((i) => (
                    <div key={i} className="panel conn" style={{ cursor: "default" }}>
                      <Skeleton h={14} w="60%" />
                      <Skeleton h={11} w="80%" />
                      <Skeleton h={22} w={110} />
                    </div>
                  ))}
                </div>
              ) : conns.data.length === 0 ? (
                <EmptyBlock
                  title="No databases connected yet."
                  body="Connect a read-only Postgres URL first — DryRun copies it into a sandbox and never writes to it."
                  action={<Link href="/databases" className="btn btn-p">Connect a database</Link>}
                />
              ) : (
                <ConnectionPicker conns={conns.data} value={connId} onChange={setConnId} />
              )}
            </section>

            <label className="col" style={{ gap: 8 }}>
              <span className="eyebrow">Migration name</span>
              <input
                className="inp"
                value={name}
                placeholder={deriveName(sql) ?? "migration_yyyymmdd_hhmm"}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameTouched(e.target.value.trim() !== "");
                }}
                onBlur={() => name && setName(slug(name))}
                spellCheck={false}
                autoComplete="off"
              />
            </label>

            <div className="row" style={{ gap: 12, flexWrap: "wrap", justifyContent: "space-between" }}>
              <div className="row" role="tablist" aria-label="Migration source" style={{ gap: 4, padding: 4, borderRadius: 12, background: "rgba(238,231,255,.6)", alignSelf: "flex-start" }}>
                <button type="button" role="tab" aria-selected={tab === "write"} className={`tabb${tab === "write" ? " on" : ""}`} onClick={() => setTab("write")}>
                  Write SQL
                </button>
                <button type="button" role="tab" aria-selected={tab === "upload"} className={`tabb${tab === "upload" ? " on" : ""}`} onClick={() => setTab("upload")}>
                  Upload migration
                </button>
              </div>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }} aria-label="Example migrations">
                <span className="eyebrow" style={{ marginRight: 4 }}>Examples</span>
                {EXAMPLES.map((ex) => (
                  <button key={ex.key} type="button" className="btn btn-sm" onClick={() => loadExample(ex)} title={ex.up.split("\n").slice(2).join(" ").trim()}>
                    {ex.label}
                  </button>
                ))}
              </div>
            </div>

            <div id="nr-sql" role="tabpanel">
              {tab === "write" ? (
                <SqlEditor
                  label="Migration SQL (up)"
                  value={sql}
                  onChange={updateSql}
                  onSubmit={fireSubmit}
                  hints={hints ?? undefined}
                  dark={dark}
                  height={300}
                  placeholder={"-- 004_room_capacity.sql\nALTER TABLE rooms ADD CONSTRAINT …"}
                />
              ) : (
                <UploadDrop onFile={readFile} />
              )}
            </div>

            <div className="row" style={{ gap: 18, font: "400 12px/1.2 'DM Mono',monospace", color: "var(--text2)", flexWrap: "wrap" }}>
              {sql.trim() ? (
                <>
                  <span>
                    {stats.statements} statement{stats.statements === 1 ? "" : "s"} · {stats.kind} · {stats.transactional ? "transactional" : "non-transactional (CONCURRENTLY)"}
                  </span>
                  {analyzing && (
                    <span className="row" style={{ gap: 6, color: "#6A4FB8" }}>
                      <span className="dot breathe" style={{ background: "#7758C8" }} /> pre-flight…
                    </span>
                  )}
                </>
              ) : (
                <span>PostgreSQL · runs inside a transaction on the sandbox</span>
              )}
              <span style={{ marginLeft: "auto" }}>
                <span className="kbd">{isMac ? "⌘" : "Ctrl"}</span> <span className="kbd">↵</span> start
              </span>
            </div>

            {hints && hints.length > 0 && (
              <ul className="row" style={{ gap: 8, flexWrap: "wrap", listStyle: "none" }} aria-label="Static hints">
                {hints.map((h, i) => (
                  <li key={i} className={`${HINT_CHIP[h.level]} hint`} style={{ textTransform: "none", letterSpacing: 0, fontSize: 11.5, height: "auto", minHeight: 26, padding: "5px 10px", whiteSpace: "normal", lineHeight: 1.35 }}>
                    <span aria-hidden="true">{HINT_ICON[h.level]}</span>
                    {h.line != null && <b style={{ fontWeight: 600 }}>L{h.line}</b>}
                    <span>{h.message}</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="col" style={{ gap: 10 }}>
              <button
                type="button"
                className="btn btn-sm"
                style={{ alignSelf: "flex-start" }}
                aria-expanded={showDown}
                aria-controls="nr-down"
                onClick={() => setShowDown((s) => !s)}
              >
                {showDown ? "− Hide rollback SQL" : "+ Add rollback (down) SQL"} <span className="muted" style={{ fontWeight: 500 }}>optional</span>
              </button>
              {showDown && (
                <div id="nr-down" className="col" style={{ gap: 8 }}>
                  <SqlEditor
                    label="Rollback SQL (down)"
                    value={down}
                    onChange={setDown}
                    onSubmit={fireSubmit}
                    dark={dark}
                    height={150}
                    placeholder="-- how to undo this migration"
                  />
                  <span className="mono muted" style={{ fontSize: 11.5 }}>
                    {down.trim() ? "Used for the rollback test — the sandbox is checksummed before and after." : "Leave empty and the agent drafts a down migration for the rollback test."}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* ---------------- right: checks, pre-flight, schema, CTA ---------------- */}
          <div className="col" style={{ gap: 18, minWidth: 0 }}>
            <div id="nr-checks" className="glass" style={{ padding: "18px 20px" }}>
              <span className="eyebrow">Checks</span>
              <div className="opt">
                <Toggle on={aiChecks} onChange={setAiChecks} label="AI safety checks" />
                AI safety checks<span style={{ color: "#6A4FB8" }}>◇ migration-specific</span>
              </div>
              <div className="opt" style={{ border: 0 }}>
                <Toggle on={rollback} onChange={setRollback} label="Rollback verification" />
                Rollback verification<span>{rollback && !down.trim() ? "AI drafts down SQL" : "hash compare"}</span>
              </div>
              <span className="mono muted" style={{ fontSize: 11, display: "block", paddingTop: 6 }}>
                Data, constraint and lock checks always run.
              </span>
            </div>

            <PreflightCard
              hints={hints}
              analyzing={analyzing}
              failed={analyzeFailed}
              ready={!!conn && !!sql.trim()}
            />

            <SchemaPanel conn={conn} schema={schema} touched={touched} />

            <div className="col cta" style={{ gap: 10, marginTop: "auto" }}>
              <span className="serif" style={{ fontSize: 24, lineHeight: 1.2, fontStyle: "italic" }}>
                Nothing touches production until it survives here.
              </span>
              <button
                type="button"
                className="btn btn-p btn-lg"
                style={{ height: 56, fontSize: 15 }}
                onClick={submit}
                disabled={!canSubmit}
                aria-keyshortcuts="Control+Enter Meta+Enter"
                title={missing ?? undefined}
              >
                {submitting ? "Starting sandbox…" : "Start rehearsal"}{" "}
                <span className="kbd" style={{ background: "transparent", color: "#FFFFFF", borderColor: "rgba(255,255,255,.5)" }}>
                  {submitKbd}
                </span>
              </button>
              <span className="mono muted" style={{ fontSize: 11.5, textAlign: "center" }}>
                {missing ?? `new isolated sandbox · zero writes to ${conn?.name ?? "production"}`}
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ pieces */

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`tg${on ? " on" : ""}`}
      aria-label={`${label}, ${on ? "on" : "off"}`}
      onClick={() => onChange(!on)}
    />
  );
}

function ConnectionPicker({ conns, value, onChange }: { conns: Connection[]; value: string | null; onChange: (id: string) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + conns.length) % conns.length;
    onChange(conns[n].id);
    refs.current[n]?.focus();
  };
  return (
    <div className="conn-grid" role="radiogroup" aria-label="Database">
      {conns.map((c, i) => {
        const sel = c.id === value;
        return (
          <button
            key={c.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={sel}
            tabIndex={sel || (!value && i === 0) ? 0 : -1}
            className="panel conn"
            onClick={() => onChange(c.id)}
            onKeyDown={(e) => onKey(e, i)}
          >
            <span className="row" style={{ gap: 8, width: "100%" }}>
              <span
                title={`health: ${c.health}`}
                aria-label={`health ${c.health}`}
                style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: c.health === "ok" ? "#47705A" : c.health === "degraded" ? "#C56F45" : "#A8234F" }}
              />
              <span className="mono ellipsis" style={{ fontSize: 14, fontWeight: 500, color: "var(--text)" }}>{c.name}</span>
              {sel && <span style={{ marginLeft: "auto", color: "#B8386E", fontWeight: 700 }} aria-hidden="true">✓</span>}
            </span>
            <span className="mono muted ellipsis" style={{ fontSize: 11.5, width: "100%" }}>
              {c.engine} · {c.database} · {c.tables == null ? "—" : c.tables} tables · {fmtBytes(c.size_bytes)}
            </span>
            <span className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              {c.environment === "production" ? (
                <span className="env env-prod" style={{ height: 24, fontSize: 10.5, padding: "0 8px" }}>⛨ PRODUCTION</span>
              ) : (
                <span className="st st-info">staging</span>
              )}
              {c.read_only ? <span className="st st-safe">✓ read-only</span> : <span className="st st-review">△ read-write</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function UploadDrop({ onFile }: { onFile: (f: File | null | undefined) => void }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    onFile(e.dataTransfer.files?.[0]);
  };
  return (
    <div
      className={`drop panel${over ? " over" : ""}`}
      role="button"
      tabIndex={0}
      aria-label="Upload a .sql migration file"
      onClick={() => input.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          input.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      style={{ minHeight: 300, justifyContent: "center" }}
    >
      <svg width="28" height="28" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
        <path d="M8 11V2.5M4.5 6L8 2.5 11.5 6M2.5 10.5v3h11v-3" />
      </svg>
      <span className="h3">Drop a migration file</span>
      <span className="muted" style={{ fontSize: 13 }}>
        <span className="mono">.sql</span> · up to 1 MB · or click to browse
      </span>
      <input
        ref={input}
        type="file"
        accept=".sql,text/plain,application/sql"
        hidden
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function PreflightCard({ hints, analyzing, failed, ready }: { hints: StaticHint[] | null; analyzing: boolean; failed: boolean; ready: boolean }) {
  if (!ready) {
    return (
      <div id="nr-preflight" className="glass col" style={{ padding: "18px 20px", gap: 8 }}>
        <span className="st st-info" style={{ alignSelf: "flex-start" }}>○ Pre-flight</span>
        <span className="muted" style={{ fontSize: 13.5, lineHeight: 1.5 }}>
          As you type, DryRun reads the SQL for obvious risks — locks, rewrites, destructive changes — before anything runs.
        </span>
      </div>
    );
  }
  if (!hints) {
    return (
      <div id="nr-preflight" className="glass col" style={{ padding: "18px 20px", gap: 10 }} aria-busy={analyzing}>
        <span className="st st-info" style={{ alignSelf: "flex-start" }}>{failed && !analyzing ? "! Pre-flight" : "◌ Pre-flight"}</span>
        {failed && !analyzing ? (
          <span className="muted" style={{ fontSize: 13.5, lineHeight: 1.5 }}>
            The static read is unavailable right now. You can still start — the rehearsal measures everything for real.
          </span>
        ) : (
          <>
            <Skeleton h={14} w="70%" />
            <Skeleton h={12} w="90%" />
          </>
        )}
      </div>
    );
  }
  const worst = hints.find((h) => h.level !== "info");
  if (!worst) {
    return (
      <div id="nr-preflight" className="glass col" style={{ padding: "18px 20px", gap: 8, background: "rgba(230,242,223,.7)", borderColor: "rgba(71,112,90,.3)" }}>
        <div className="row" style={{ gap: 10 }}>
          <span className="st st-safe">✓ Pre-flight</span>
          <span className="eyebrow" style={{ color: "#47705A" }}>preliminary</span>
        </div>
        <span className="h3">No static warnings</span>
        <span style={{ font: "400 13.5px/1.5 'Manrope',sans-serif" }}>
          Nothing risky in the SQL itself{hints.length ? ` (${hints.length} note${hints.length > 1 ? "s" : ""})` : ""}. The rehearsal will still measure locks, data and rollback on a real copy.
        </span>
      </div>
    );
  }
  const danger = worst.level === "danger";
  const others = hints.filter((h) => h !== worst && h.level !== "info").length;
  return (
    <div
      id="nr-preflight"
      className="glass"
      role="status"
      style={{
        padding: "18px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        background: danger ? "rgba(251,227,236,.7)" : "rgba(255,228,204,.55)",
        borderColor: danger ? "rgba(168,35,79,.3)" : "rgba(197,111,69,.3)",
      }}
    >
      <div className="row" style={{ gap: 10 }}>
        <span className={danger ? "st st-block" : "st st-review"}>{danger ? "✕ Pre-flight" : "△ Pre-flight"}</span>
        <span className="eyebrow" style={{ color: danger ? "#A8234F" : "#A3552F" }}>preliminary</span>
      </div>
      <span className="h3">{worst.message}</span>
      <span style={{ font: "400 13.5px/1.5 'Manrope',sans-serif" }}>
        {worst.line != null ? (
          <>
            Line <span className="mono">{worst.line}</span>.{" "}
          </>
        ) : null}
        Read from the SQL only — the rehearsal will measure it.
        {others > 0 && ` ${others} more warning${others > 1 ? "s" : ""} below the editor.`}
      </span>
    </div>
  );
}

function SchemaPanel({
  conn,
  schema,
  touched,
}: {
  conn: Connection | null;
  schema: ReturnType<typeof useApi<SchemaTable[]>>;
  touched: Set<string>;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const tables = useMemo(() => {
    const list = [...(schema.data ?? [])];
    return list.sort((a, b) => Number(touched.has(b.name.toLowerCase())) - Number(touched.has(a.name.toLowerCase())) || a.name.localeCompare(b.name));
  }, [schema.data, touched]);

  return (
    <section className="glass col" style={{ padding: "18px 20px", gap: 10 }} aria-labelledby="nr-schema-h">
      <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
        <span id="nr-schema-h" className="eyebrow">Schema{conn ? ` · ${conn.database}` : ""}</span>
        {schema.data && <span className="mono muted" style={{ fontSize: 11 }}>{schema.data.length} tables</span>}
      </div>
      {!conn ? (
        <span className="muted" style={{ fontSize: 13 }}>Pick a database to browse its tables.</span>
      ) : schema.error && !schema.data ? (
        <div className="col" style={{ gap: 8, alignItems: "flex-start" }}>
          <span className="muted" style={{ fontSize: 13 }}>Couldn’t read the schema: {schema.error.message}</span>
          <button type="button" className="btn btn-sm" onClick={schema.reload}>Retry</button>
        </div>
      ) : !schema.data || schema.loading ? (
        <div className="col" style={{ gap: 10 }} aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} h={14} w={`${80 - i * 12}%`} />
          ))}
        </div>
      ) : tables.length === 0 ? (
        <span className="muted" style={{ fontSize: 13 }}>No tables found in this database.</span>
      ) : (
        <div className="schema-list">
          {tables.map((t) => {
            const hit = touched.has(t.name.toLowerCase());
            const isOpen = open === t.name;
            return (
              <div key={t.name}>
                <button type="button" className="schema-t" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : t.name)}>
                  <span aria-hidden="true" style={{ color: "var(--text2)", width: 8 }}>{isOpen ? "▾" : "▸"}</span>
                  <span className="ellipsis">{t.name}</span>
                  {hit && <span className="st st-ai" style={{ height: 20, padding: "0 7px", fontSize: 9.5 }}>touched</span>}
                  <span className="muted" style={{ marginLeft: "auto", fontSize: 11 }}>{fmtInt(t.rows)} rows</span>
                </button>
                {isOpen && (
                  <div className="schema-cols">
                    {t.columns.map((c) => (
                      <span key={c.name} className="row" style={{ gap: 8 }}>
                        <span style={{ color: "var(--text)" }}>{c.name}</span>
                        <span>{c.type}</span>
                        {!c.nullable && <span style={{ color: "#6A4FB8" }}>not null</span>}
                      </span>
                    ))}
                    {t.references.length > 0 && <span>→ references {t.references.join(", ")}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
