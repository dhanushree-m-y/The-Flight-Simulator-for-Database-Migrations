"use client";

import { useId, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { TopBar } from "@/components/shell/AppShell";
import { useShell } from "@/components/shell/ShellContext";
import { api, useApi } from "@/lib/api";
import { fmtBytes, fmtInt, timeAgo } from "@/lib/format";
import type { Connection, SchemaTable } from "@/lib/types";
import { EmptyState, FailState, LoadState, Modal, PageHead, PermissionNote, canEngineer, errMsg, useNow } from "@/components/admin/kit";

const BAR = ["#F4B8CC", "#F7C59F", "#CBB8F6", "#BFD9B5", "#F49AC4", "#E6D9E5"];
const READER_SQL = `CREATE ROLE dryrun_reader LOGIN;
GRANT SELECT ON ALL TABLES
  IN SCHEMA public TO dryrun_reader;`;

function Health({ c }: { c: Connection }) {
  const look =
    c.health === "ok" ? { color: "#47705A", label: "connected", breathe: true } : c.health === "degraded" ? { color: "#A3552F", label: "degraded", breathe: false } : { color: "#A8234F", label: "unreachable", breathe: false };
  return (
    <span className="row mono" style={{ gap: 6, fontSize: 11, color: look.color, whiteSpace: "nowrap" }}>
      <span className={`dot${look.breathe ? " breathe" : ""}`} aria-hidden="true" />
      {look.label}
    </span>
  );
}

const EnvChip = ({ c }: { c: Connection }) =>
  c.environment === "production" ? (
    <span className="env env-prod" style={{ height: 28, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis" }}>⛨ {c.name}</span>
  ) : (
    <span className="env env-org" style={{ height: 28, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</span>
  );

const Access = ({ c }: { c: Connection }) =>
  c.read_only ? <span className="st st-safe" style={{ justifySelf: "start" }}>✓ read only</span> : <span className="st st-review" style={{ justifySelf: "start" }}>△ can write</span>;

export default function DatabasesPage() {
  const { me } = useShell();
  const { data, error, loading, reload, setData } = useApi<Connection[]>("/api/connections", { pollMs: 30000 });
  const [selId, setSelId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  useNow(30000);

  const list = useMemo(() => [...(data ?? [])].sort((a, b) => (a.environment === b.environment ? a.name.localeCompare(b.name) : a.environment === "production" ? -1 : 1)), [data]);
  const sel = list.find((c) => c.id === selId) ?? list[0] ?? null;
  const may = canEngineer(me);
  const upsert = (c: Connection) => setData((l) => (l ? (l.some((x) => x.id === c.id) ? l.map((x) => (x.id === c.id ? c : x)) : [...l, c]) : [c]));
  const readOnlyCount = list.filter((c) => c.read_only).length;

  const addBtn = (
    <button type="button" className="btn btn-p" onClick={() => setAdding(true)} disabled={!may} title={may ? undefined : "Viewers can’t add databases"}>
      + Add database
    </button>
  );

  return (
    <div className="pg-databases page">
      <TopBar crumbs={["Databases"]} />
      <PageHead
        eyebrow={data ? `Databases · ${list.length} connected · ${readOnlyCount === list.length ? "read-only rehearsal access" : `${readOnlyCount} of ${list.length} read-only`}` : "Databases · read-only rehearsal access"}
        title="We only ever read. Production is changed through approvals."
        right={addBtn}
      />
      {!may && me && <PermissionNote>You’re signed in as a viewer: you can inspect every connection and schema. Ask an engineer to add or test a database.</PermissionNote>}

      {loading && !data ? (
        <LoadState title="Checking database connections…" steps={["Loading connections", "Reading health checks", "Loading schema previews"]} />
      ) : error && !data ? (
        <FailState title="Couldn’t load databases." error={error} onRetry={reload} />
      ) : list.length === 0 ? (
        <EmptyState
          eyebrow="Empty · first visit"
          title="No databases connected yet."
          body="Connect a Postgres database with a read-only login. DryRun copies it into a TrueForge sandbox for every rehearsal and never writes to it directly."
          action={addBtn}
        />
      ) : (
        <>
          <div className="panel col" style={{ overflow: "hidden" }}>
            <div className="db" style={{ font: "500 10.5px/1 'DM Mono',monospace", letterSpacing: ".14em", color: "var(--text2)" }} aria-hidden="true">
              <span>DATABASE</span>
              <span className="c-engine">ENGINE</span>
              <span className="c-size">SIZE</span>
              <span className="c-rows">ROWS</span>
              <span>ACCESS</span>
              <span className="c-last">LAST CHECKED</span>
            </div>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }} aria-label="Connected databases">
              {list.map((c, i) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className={`db${sel?.id === c.id ? " sel" : ""}`}
                    aria-pressed={sel?.id === c.id}
                    onClick={() => setSelId(c.id)}
                    style={i === list.length - 1 ? { borderBottom: 0 } : undefined}
                    aria-label={`${c.name}, ${c.environment}, ${c.health}, ${c.read_only ? "read only" : "can write"}`}
                  >
                    <span className="row" style={{ gap: 10, minWidth: 0, flexWrap: "wrap" }}>
                      <EnvChip c={c} />
                      <Health c={c} />
                    </span>
                    <span className="mono c-engine" style={{ fontSize: 12 }}>{c.engine}</span>
                    <span className="mono c-size">{fmtBytes(c.size_bytes)}</span>
                    <span className="mono c-rows">{fmtInt(c.rows)}</span>
                    <Access c={c} />
                    <span className="muted c-last">{timeAgo(c.last_checked_at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {sel && (
            <div className="adm-grid">
              <SchemaPanel key={sel.id} conn={sel} may={may} onTested={upsert} />
              <AccessPanel conn={sel} may={may} onAdd={() => setAdding(true)} />
            </div>
          )}
        </>
      )}

      <AddDrawer
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={(c) => {
          upsert(c);
          setSelId(c.id);
        }}
      />
    </div>
  );
}

function SchemaPanel({ conn, may, onTested }: { conn: Connection; may: boolean; onTested: (c: Connection) => void }) {
  const { data, error, loading, reload } = useApi<SchemaTable[]>(`/api/connections/${conn.id}/schema`);
  const [open, setOpen] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testErr, setTestErr] = useState<string | null>(null);
  const tables = useMemo(() => [...(data ?? [])].sort((a, b) => b.rows - a.rows), [data]);
  const max = Math.max(1, ...tables.map((t) => t.rows));

  async function test() {
    setTesting(true);
    setTestErr(null);
    try {
      const c = await api<Connection>(`/api/connections/${conn.id}/test`, { method: "POST" });
      onTested(c);
      if (c.health === "ok") toast.success(`${c.name} · connection ok`);
      else toast.warning(`${c.name} · ${c.health}`);
      reload();
    } catch (e) {
      setTestErr(errMsg(e));
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className="glass col" style={{ padding: "22px 24px", gap: 10, minWidth: 0 }} aria-label={`${conn.name} schema`}>
      <div className="row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <span className="eyebrow">{conn.name} · tables</span>
        <span className="mono muted" style={{ fontSize: 11 }}>checked {timeAgo(conn.last_checked_at)}</span>
      </div>
      {loading && !data ? (
        <div className="col" style={{ gap: 10, padding: "6px 0" }} aria-busy="true">
          {[80, 64, 52, 40].map((w) => <div key={w} className="adm-shim" style={{ width: `${w}%` }} />)}
        </div>
      ) : error && !data ? (
        <div className="adm-err" role="alert">✕ Couldn’t read the schema: {error.message}. <button type="button" className="btn btn-sm" onClick={reload}>Retry</button></div>
      ) : tables.length === 0 ? (
        <span className="muted" style={{ fontSize: 13 }}>No tables found in the public schema.</span>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: 360, overflow: "auto" }}>
          {tables.map((t, i) => (
            <li key={t.name}>
              <button type="button" className="tb" aria-expanded={open === t.name} onClick={() => setOpen((o) => (o === t.name ? null : t.name))}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</span>
                <span aria-hidden="true" style={{ display: "block", height: 8, borderRadius: 4, background: BAR[i % BAR.length], width: `${Math.max(2, (t.rows / max) * 100)}%` }} className="grow-x" />
                <span style={{ textAlign: "right" }}>{fmtInt(t.rows)}</span>
              </button>
              {open === t.name && (
                <div className="cols-list">
                  {t.columns.map((c) => (
                    <div key={c.name} style={{ display: "contents" }}>
                      <span style={{ color: "var(--text)" }}>{c.name}</span>
                      <span>{c.type}</span>
                      <span>{c.nullable ? "null" : "not null"}</span>
                    </div>
                  ))}
                  {t.references.length > 0 && <span style={{ gridColumn: "1 / -1", color: "#6A4FB8" }}>→ references {t.references.join(", ")}</span>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="rule" style={{ margin: "6px 0" }} />
      <div className="kv"><span>Host</span><span style={{ overflowWrap: "anywhere", textAlign: "right" }}>{conn.host}</span></div>
      <div className="kv"><span>Database</span><span>{conn.database}</span></div>
      <div className="kv"><span>Engine · tables</span><span>{conn.engine} · {fmtInt(conn.tables)}</span></div>
      <div className="kv"><span>INSERT · UPDATE · DELETE · DDL</span>{conn.read_only ? <span style={{ color: "#47705A" }}>✓ denied</span> : <span style={{ color: "#A3552F" }}>△ allowed</span>}</div>
      <div className="kv"><span>Secret</span><span className="muted">stored · never shown again</span></div>
      <div className="row" style={{ gap: 10, paddingTop: 6, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-sm" onClick={test} disabled={!may || testing}>
          {testing ? "Testing…" : "Test connection"}
        </button>
        {testErr && <span className="adm-err" role="alert">✕ {testErr}</span>}
      </div>
    </section>
  );
}

function AccessPanel({ conn, may, onAdd }: { conn: Connection; may: boolean; onAdd: () => void }) {
  const steps = [
    { ok: conn.read_only, label: conn.read_only ? "Read-only login" : "Login can write — replace it" },
    { ok: true, label: "Secret stored server-side" },
    { ok: true, label: "Rehearsals run on a TrueForge sandbox copy" },
    { ok: true, label: "Production changes only via approvals" },
  ];
  return (
    <section className="glass col" style={{ padding: "22px 24px", gap: 14, borderColor: "rgba(119,88,200,.25)", minWidth: 0 }} aria-label="Access">
      <div className="row" style={{ justifyContent: "space-between", gap: 10 }}>
        <span className="h2" style={{ fontSize: 26 }}>How DryRun connects</span>
        <span className="mono muted" style={{ fontSize: 11 }}>{conn.environment}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,190px) minmax(0,1fr)", gap: 20 }}>
        <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {steps.map((s) => (
            <li key={s.label} className="ws">
              <i style={s.ok ? { background: "#E6F2DF", color: "#47705A" } : { background: "#FFE4CC", color: "#A3552F" }} aria-hidden="true">{s.ok ? "✓" : "△"}</i>
              {s.ok ? s.label : <b style={{ color: "#A3552F" }}>{s.label}</b>}
            </li>
          ))}
        </ol>
        <div className="col" style={{ gap: 10, minWidth: 0 }}>
          {conn.read_only ? (
            <span style={{ font: "600 14px/1.4 'Manrope',sans-serif" }}>
              <span className="mono">{conn.name}</span> uses a read-only login.
            </span>
          ) : (
            <span style={{ font: "600 14px/1.4 'Manrope',sans-serif" }}>
              The login for <span className="mono">{conn.name}</span> can write.
            </span>
          )}
          <span style={{ font: "400 13px/1.5 'Manrope',sans-serif", color: "var(--text2)" }}>
            DryRun recommends read-only credentials for rehearsal access. {conn.read_only ? "To add another database, create a login like this:" : "Run once, then add the database again with the new login:"}
          </span>
          <div className="sqlbox"><span className="k">CREATE ROLE</span> dryrun_reader <span className="k">LOGIN</span>;{"\n"}<span className="k">GRANT SELECT ON ALL TABLES</span>{"\n"}  <span className="k">IN SCHEMA</span> public <span className="k">TO</span> dryrun_reader;</div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => navigator.clipboard?.writeText(READER_SQL).then(() => toast("SQL copied"), () => toast.error("Clipboard unavailable"))}
            >
              Copy SQL
            </button>
            {!conn.read_only && (
              <button type="button" className="btn btn-sm btn-p" onClick={onAdd} disabled={!may}>
                Use new credentials
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

type Phase = "form" | "saving" | "testing" | "done";

function AddDrawer({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (c: Connection) => void }) {
  const uid = useId();
  const [name, setName] = useState("");
  const [dsn, setDsn] = useState("");
  const [envName, setEnvName] = useState<Connection["environment"]>("staging");
  const [phase, setPhase] = useState<Phase>("form");
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<Connection | null>(null);
  const [touched, setTouched] = useState(false);

  const nameErr = !name.trim() ? "Give it a name your team recognises, e.g. hostel-prod." : !/^[a-z0-9][a-z0-9._-]{1,62}$/i.test(name.trim()) ? "Use letters, numbers, dot, dash or underscore." : null;
  const dsnErr = !dsn.trim() ? "Paste a Postgres connection string." : !/^postgres(ql)?:\/\//i.test(dsn.trim()) ? "It should start with postgres:// or postgresql://" : null;

  const reset = () => {
    setName("");
    setDsn("");
    setEnvName("staging");
    setPhase("form");
    setErr(null);
    setResult(null);
    setTouched(false);
  };
  const close = () => {
    if (phase === "saving" || phase === "testing") return;
    reset();
    onClose();
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (nameErr || dsnErr) return;
    setErr(null);
    setPhase("saving");
    let created: Connection;
    try {
      created = await api<Connection>("/api/connections", { method: "POST", json: { name: name.trim(), dsn: dsn.trim(), environment: envName } });
    } catch (e2) {
      setErr(errMsg(e2));
      setPhase("form");
      return;
    }
    setDsn(""); // the secret leaves the browser once; never keep it around
    onCreated(created);
    setResult(created);
    setPhase("testing");
    try {
      const tested = await api<Connection>(`/api/connections/${created.id}/test`, { method: "POST" });
      onCreated(tested);
      setResult(tested);
    } catch (e3) {
      setErr(`Saved, but the connection test failed: ${errMsg(e3)}`);
    }
    setPhase("done");
  }

  const step = phase === "form" ? 0 : phase === "saving" ? 1 : phase === "testing" ? 2 : 3;
  const steps = ["Connection details", "Save secret", "Test connection", "Ready to rehearse"];

  return (
    <Modal open={open} onClose={close} label="Add database" drawer>
      <div className="row" style={{ justifyContent: "space-between", gap: 10 }}>
        <span className="h2" style={{ fontSize: 26 }}>Add database</span>
        <button type="button" className="btn btn-sm" onClick={close} disabled={phase === "saving" || phase === "testing"}>Close</button>
      </div>
      <ol style={{ listStyle: "none", margin: 0, padding: 0 }} aria-label="Progress">
        {steps.map((s, i) => {
          const done = i < step || (phase === "done" && i === 3);
          const cur = i === step && phase !== "done";
          return (
            <li key={s} className="ws" aria-current={cur ? "step" : undefined} style={!done && !cur ? { color: "var(--text2)" } : undefined}>
              <i
                aria-hidden="true"
                className={cur && i > 0 ? "breathe" : undefined}
                style={done ? { background: "#E6F2DF", color: "#47705A" } : cur ? { background: "#EEE7FF", color: "#6A4FB8" } : { border: "1px dashed var(--line2)" }}
              >
                {done ? "✓" : i + 1}
              </i>
              {cur ? <b>{s}</b> : s}
            </li>
          );
        })}
      </ol>

      {phase === "form" || phase === "saving" ? (
        <form className="col" style={{ gap: 14 }} onSubmit={submit} noValidate>
          <div className="adm-field">
            <label htmlFor={`${uid}-n`}>Name</label>
            <input id={`${uid}-n`} className="inp mono" value={name} onChange={(e) => setName(e.target.value)} placeholder="hostel-prod" autoComplete="off" aria-invalid={touched && !!nameErr} aria-describedby={`${uid}-ne`} disabled={phase === "saving"} />
            {touched && nameErr && <span id={`${uid}-ne`} className="adm-err">{nameErr}</span>}
          </div>
          <div className="adm-field">
            <label htmlFor={`${uid}-d`}>Connection string (DSN)</label>
            <input
              id={`${uid}-d`}
              type="password"
              className="inp mono"
              value={dsn}
              onChange={(e) => setDsn(e.target.value)}
              placeholder="postgresql://dryrun_reader:••••@host:5432/db"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={touched && !!dsnErr}
              aria-describedby={`${uid}-dh`}
              disabled={phase === "saving"}
            />
            <span id={`${uid}-dh`} className="hint">🔒 Stored server-side, never displayed again. Use a read-only login.</span>
            {touched && dsnErr && <span className="adm-err">{dsnErr}</span>}
          </div>
          <div className="adm-field">
            <label htmlFor={`${uid}-e`}>Environment</label>
            <select id={`${uid}-e`} className="inp" value={envName} onChange={(e) => setEnvName(e.target.value as Connection["environment"])} disabled={phase === "saving"}>
              <option value="staging">Staging</option>
              <option value="production">Production</option>
            </select>
            <span className="hint">
              {envName === "production" ? "⛨ Production: rehearsals still run on a sandbox copy; changes need an approver." : "Staging databases can be rehearsed against without an approval gate."}
            </span>
          </div>
          {err && <div className="adm-err" role="alert">✕ {err}</div>}
          <div className="row" style={{ gap: 10, paddingTop: 4 }}>
            <button type="submit" className="btn btn-p" disabled={phase === "saving"}>
              {phase === "saving" ? "Saving…" : "Save & test connection"}
            </button>
            <button type="button" className="btn" onClick={close} disabled={phase === "saving"}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className="col" style={{ gap: 14 }} role="status" aria-live="polite">
          {phase === "testing" ? (
            <>
              <span className="serif" style={{ fontSize: 28, lineHeight: 1.1 }}>Testing {result?.name}…</span>
              <div className="adm-indet" aria-hidden="true"><i /></div>
            </>
          ) : result ? (
            <>
              <span className="serif" style={{ fontSize: 28, lineHeight: 1.1 }}>
                {result.health === "ok" ? `${result.name} is connected.` : result.health === "degraded" ? `${result.name} is slow to respond.` : `${result.name} is unreachable.`}
              </span>
              <div className="col">
                <div className="kv"><span>Health</span><Health c={result} /></div>
                <div className="kv"><span>Engine</span><span>{result.engine}</span></div>
                <div className="kv"><span>Host</span><span style={{ overflowWrap: "anywhere" }}>{result.host}</span></div>
                <div className="kv"><span>Tables · rows</span><span>{fmtInt(result.tables)} · {fmtInt(result.rows)}</span></div>
                <div className="kv"><span>Access</span><Access c={result} /></div>
              </div>
              {!result.read_only && (
                <PermissionNote tone="sod">This login can write. DryRun will only read, but a read-only role is strongly recommended.</PermissionNote>
              )}
              {err && <div className="adm-err" role="alert">✕ {err}</div>}
              <div className="row" style={{ gap: 10 }}>
                <button type="button" className="btn btn-p" onClick={close}>Done</button>
              </div>
            </>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
