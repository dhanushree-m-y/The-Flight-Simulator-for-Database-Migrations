"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { EvidenceShell, plural } from "@/components/evidence/EvidenceShell";
import { EmptyBlock, ErrorBlock, LoadingBlock, SqlCode } from "@/components/ui";
import { IconSearch } from "@/components/icons";
import { useApi } from "@/lib/api";
import { fmtInt } from "@/lib/format";
import type { BrokenRows, Check, Rehearsal } from "@/lib/types";

type Cell = string | number | null;
type Row = Record<string, Cell>;

export default function BrokenRowsPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <EvidenceShell id={id} tab="rows" pg="rows">
      {(r) => (
        <Suspense fallback={<LoadingBlock lines={6} />}>
          <RowsExplorer r={r} />
        </Suspense>
      )}
    </EvidenceShell>
  );
}

const statusRank: Record<Check["status"], number> = { fail: 0, warn: 1, pass: 2 };

function RowsExplorer({ r }: { r: Rehearsal }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const checks = useMemo(
    () => r.checks.filter((c) => c.has_rows).sort((a, b) => statusRank[a.status] - statusRank[b.status] || b.affected_rows - a.affected_rows),
    [r.checks],
  );
  const wanted = params.get("check");
  const check = checks.find((c) => c.id === wanted) ?? checks[0] ?? null;

  const selectCheck = (c: Check) => router.replace(`${pathname}?check=${encodeURIComponent(c.id)}`, { scroll: false });

  if (!check) {
    return (
      <EmptyBlock
        title="No broken rows to explore."
        body={
          r.status === "running" || r.status === "queued"
            ? "The rehearsal is still running. Rows appear here as soon as a check finds evidence."
            : "None of this rehearsal’s checks produced row-level evidence — no data was lost, truncated or orphaned in the sandbox."
        }
        action={
          <Link className="btn btn-sm" href={`/rehearsals/${r.id}/report`}>
            Back to report
          </Link>
        }
      />
    );
  }

  return <CheckRows key={check.id} r={r} check={check} checks={checks} onSelect={selectCheck} />;
}

function CheckRows({ r, check, checks, onSelect }: { r: Rehearsal; check: Check; checks: Check[]; onSelect: (c: Check) => void }) {
  const { data, error, loading, reload } = useApi<BrokenRows>(`/api/rehearsals/${r.id}/checks/${check.id}/rows`);
  const [query, setQuery] = useState("");
  const [column, setColumn] = useState<string>("");
  const [onlyProblem, setOnlyProblem] = useState(false);
  const [sel, setSel] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const columns = useMemo(() => data?.columns ?? [], [data]);
  const highlight = useMemo(() => new Set(data?.highlight ?? []), [data]);
  const idCol = columns.find((c) => c.toLowerCase() === "id") ?? columns[0];
  const visibleCols = useMemo(
    () => (onlyProblem && highlight.size ? columns.filter((c) => c === idCol || highlight.has(c)) : columns),
    [columns, highlight, idCol, onlyProblem],
  );

  const rows = useMemo(() => {
    const all = (data?.rows ?? []) as Row[];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    const cols = column ? [column] : columns;
    return all.filter((row) => cols.some((c) => row[c] != null && String(row[c]).toLowerCase().includes(q)));
  }, [data, query, column, columns]);

  useEffect(() => setSel((s) => Math.min(s, Math.max(0, rows.length - 1))), [rows.length]);
  const selected = rows[sel] ?? null;

  const move = useCallback(
    (d: number) => {
      setSel((s) => {
        const n = Math.max(0, Math.min(rows.length - 1, s + d));
        listRef.current?.querySelector<HTMLElement>(`[data-i="${n}"]`)?.scrollIntoView({ block: "nearest" });
        return n;
      });
    },
    [rows.length],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "j") move(1);
      else if (k === "k") move(-1);
      else if (k === "d" && highlight.size) setOnlyProblem((v) => !v);
      else if (k === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      } else return;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, highlight.size]);

  const total = data?.total ?? check.affected_rows;
  const loaded = data?.rows.length ?? 0;

  const copyIds = async () => {
    if (!idCol || !rows.length) return;
    try {
      await navigator.clipboard.writeText(rows.map((row) => String(row[idCol] ?? "")).join("\n"));
      toast.success(`Copied ${fmtInt(rows.length)} row ${plural(rows.length, "ID")}`);
    } catch {
      toast.error("Clipboard is not available in this browser.");
    }
  };

  const exportCsv = () => {
    if (!rows.length) return;
    const esc = (v: Cell) => {
      const s = v == null ? "" : String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [columns.map(esc).join(","), ...rows.map((row) => columns.map((c) => esc(row[c] ?? null)).join(","))].join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${r.name}-v${r.version}-${check.key}-rows.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success(`Exported ${fmtInt(rows.length)} ${plural(rows.length, "row")}`, {
      description: loaded < total ? `The sandbox returned ${fmtInt(loaded)} of ${fmtInt(total)} rows; only loaded rows are exported.` : undefined,
    });
  };

  const scope = [check.table && check.column ? `${check.table}.${check.column}` : check.table, check.before && check.after ? `${check.before} → ${check.after}` : null]
    .filter(Boolean)
    .join(" · ");
  const template = visibleCols.map((c) => (c === idCol ? "minmax(72px,.5fr)" : "minmax(140px,1fr)")).join(" ");
  const minWidth = visibleCols.reduce((s, c) => s + (c === idCol ? 72 : 140) + 18, 40);

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end", gap: 20, flexWrap: "wrap" }}>
        <div className="col" style={{ gap: 10, minWidth: 0 }}>
          <span className="eyebrow">Broken row explorer{scope ? ` · ${scope}` : ""}</span>
          <h1 className="h1" style={{ margin: 0 }}>
            {fmtInt(total)} {plural(total, "row")} · {check.title}
          </h1>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn btn-sm" onClick={copyIds} disabled={!rows.length}>
            Copy row IDs
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={exportCsv}
            disabled={!rows.length}
            title={loaded < total ? `Exports the ${fmtInt(loaded)} rows loaded from the sandbox` : undefined}
          >
            Export {fmtInt(rows.length)} {plural(rows.length, "row")}
          </button>
        </div>
      </div>

      {checks.length > 1 && (
        <div className="ev-checks" role="tablist" aria-label="Checks with row evidence">
          {checks.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={c.id === check.id}
              className={`fc${c.id === check.id ? " on" : ""}`}
              onClick={() => onSelect(c)}
            >
              <span style={{ color: c.status === "fail" ? "#B8386E" : c.status === "warn" ? "#A3552F" : "#47705A" }} aria-hidden="true">
                {c.status === "fail" ? "✕" : c.status === "warn" ? "△" : "✓"}
              </span>
              {c.title} <i>· {fmtInt(c.affected_rows)}</i>
            </button>
          ))}
        </div>
      )}

      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <label className="search ev-search">
          <IconSearch />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${column || "all columns"}…`}
            aria-label="Search loaded rows"
          />
          {query ? (
            <button type="button" className="kbd" style={{ cursor: "pointer" }} onClick={() => setQuery("")} aria-label="Clear search">
              ✕
            </button>
          ) : (
            <span className="kbd">/</span>
          )}
        </label>
        <select className={`fc${column ? " on" : ""}`} value={column} onChange={(e) => setColumn(e.target.value)} aria-label="Search in column">
          <option value="">All columns</option>
          {columns.map((c) => (
            <option key={c} value={c}>
              {c}
              {highlight.has(c) ? " · problem" : ""}
            </option>
          ))}
        </select>
        {data && (
          <span className="fc on" aria-live="polite">
            {query ? `${fmtInt(rows.length)} of ${fmtInt(loaded)} match` : `${fmtInt(loaded)} loaded`}
          </span>
        )}
        {data?.masked && (
          <span className="st st-info" title="Sensitive columns are masked before rows leave the sandbox">
            ◌ values masked
          </span>
        )}
        {highlight.size > 0 && (
          <label className="row" style={{ gap: 10, marginLeft: "auto", font: "600 13px/1 'Manrope',sans-serif", cursor: "pointer" }}>
            <button
              type="button"
              role="switch"
              aria-checked={onlyProblem}
              className={`tg${onlyProblem ? " on" : ""}`}
              aria-label="Show only problem columns"
              onClick={() => setOnlyProblem((v) => !v)}
            />
            Show only problem columns <span className="kbd">D</span>
          </label>
        )}
      </div>

      <div className="ev-split">
        <div className="panel col" style={{ overflow: "hidden", minHeight: 360 }}>
          {loading && !data ? (
            <div style={{ padding: 20 }}>
              <LoadingBlock lines={7} />
            </div>
          ) : error && !data ? (
            <ErrorBlock error={error} onRetry={reload} />
          ) : !data || data.rows.length === 0 ? (
            <div className="state-box">
              <span className="h2">No rows returned.</span>
              <span className="muted">The check reported {fmtInt(check.affected_rows)} affected rows, but the sandbox returned no evidence rows.</span>
            </div>
          ) : (
            <div className="ev-grid" ref={listRef} style={{ maxHeight: "min(64vh, 720px)", overflowY: "auto" }} role="table" aria-label={`Rows flagged by ${check.title}`} aria-rowcount={rows.length + 1}>
              <div className="rr ev-head" role="row" style={{ gridTemplateColumns: template, minWidth }}>
                {visibleCols.map((c) => (
                  <span key={c} role="columnheader" style={highlight.has(c) ? { color: "#B8386E" } : undefined}>
                    {highlight.has(c) ? "✕ " : ""}
                    {c}
                  </span>
                ))}
              </div>
              {rows.length === 0 && (
                <div className="state-box muted" role="row">
                  <span role="cell">No loaded rows match “{query}”.</span>
                </div>
              )}
              {rows.map((row, i) => (
                <div
                  key={i}
                  data-i={i}
                  role="row"
                  tabIndex={i === sel ? 0 : -1}
                  aria-selected={i === sel}
                  className={`rr${i === sel ? " sel" : ""}`}
                  style={{ gridTemplateColumns: template, minWidth }}
                  onClick={() => setSel(i)}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      move(1);
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      move(-1);
                    }
                  }}
                  onFocus={() => setSel(i)}
                >
                  {visibleCols.map((c) => (
                    <span key={c} role="cell" title={row[c] == null ? "NULL" : String(row[c])} className={c === idCol && i !== sel ? "muted" : undefined}>
                      <CellValue v={row[c] ?? null} problem={highlight.has(c)} />
                    </span>
                  ))}
                </div>
              ))}
              <div className="rr" style={{ border: 0, color: "var(--text2)", cursor: "default", gridTemplateColumns: "minmax(0,1fr) auto", minWidth }}>
                <span>
                  {total > loaded ? `+ ${fmtInt(total - loaded)} more in the sandbox · showing the first ${fmtInt(loaded)}` : `${fmtInt(loaded)} of ${fmtInt(total)} rows`}
                </span>
                <span className="row" style={{ gap: 4 }}>
                  <span className="kbd">J</span>
                  <span className="kbd">K</span> move
                </span>
              </div>
            </div>
          )}
        </div>

        <aside className="col ev-sticky" style={{ gap: 18, position: "sticky", top: 16 }} aria-label="Row inspector and check explanation">
          {selected && <Inspector row={selected} idCol={idCol} columns={columns} highlight={highlight} masked={!!data?.masked} tableName={check.table} />}
          <Explanation check={check} />
        </aside>
      </div>
    </>
  );
}

function CellValue({ v, problem }: { v: Cell; problem: boolean }) {
  if (v == null) return <span className="muted" style={{ fontStyle: "italic" }}>NULL</span>;
  const s = typeof v === "number" ? fmtInt(v) : v;
  return problem ? <span className="cut">{s}</span> : <>{s}</>;
}

function Inspector({
  row,
  idCol,
  columns,
  highlight,
  masked,
  tableName,
}: {
  row: Row;
  idCol: string | undefined;
  columns: string[];
  highlight: Set<string>;
  masked: boolean;
  tableName: string | null;
}) {
  const rowId = idCol ? row[idCol] : null;
  const problemCols = columns.filter((c) => highlight.has(c));
  const first = problemCols[0];
  const fv = first ? row[first] : null;
  const big =
    fv == null
      ? { v: "NULL", unit: "" }
      : typeof fv === "number"
        ? { v: fmtInt(fv), unit: "" }
        : fv.length <= 10
          ? { v: fv, unit: "" }
          : { v: String(fv.length), unit: "chars" };

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(String(rowId ?? ""));
      toast.success(`Copied row ${rowId}`);
    } catch {
      toast.error("Clipboard is not available in this browser.");
    }
  };

  return (
    <div className="glass col" style={{ padding: 22, gap: 14 }}>
      <div className="row" style={{ justifyContent: "space-between", gap: 10 }}>
        <span className="eyebrow">Row {rowId ?? "—"} · inspect</span>
        {rowId != null && (
          <button type="button" className="btn btn-sm" onClick={copyId}>
            Copy ID
          </button>
        )}
      </div>
      {first && (
        <>
          <span className="serif" style={{ fontSize: 52, lineHeight: 0.9, wordBreak: "break-all" }}>
            {big.v} {big.unit && <span style={{ fontSize: 22, color: "var(--text2)" }}>{big.unit}</span>}
          </span>
          <span className="eyebrow">
            {tableName ? `${tableName}.` : ""}
            {first} · problem value
          </span>
        </>
      )}
      <div className="col" style={{ gap: 6 }}>
        {problemCols.map((c) => (
          <div key={c} className="col" style={{ gap: 6 }}>
            <span className="eyebrow">{c}</span>
            <span
              className="mono"
              style={{ fontSize: 12, lineHeight: 1.6, wordBreak: "break-all", background: "#FFFFFF", borderRadius: 10, padding: "10px 12px", border: "1px solid var(--line)" }}
            >
              <CellValue v={row[c] ?? null} problem />
            </span>
          </div>
        ))}
      </div>
      <div className="col">
        {columns
          .filter((c) => !highlight.has(c))
          .map((c) => (
            <div key={c} className="kv">
              <span>{c}</span>
              <span style={{ textAlign: "right", wordBreak: "break-all" }}>{row[c] == null ? <span className="muted">NULL</span> : String(row[c])}</span>
            </div>
          ))}
      </div>
      {masked && (
        <span style={{ font: "400 12px/1.45 'Manrope',sans-serif", color: "var(--text2)" }}>
          Sensitive values are masked before rows leave the sandbox. Production data never reaches this page.
        </span>
      )}
    </div>
  );
}

function Explanation({ check }: { check: Check }) {
  const tone = check.status === "fail" ? "st st-block" : check.status === "warn" ? "st st-review" : "st st-safe";
  return (
    <div className="panel col" style={{ padding: "18px 20px", gap: 12 }}>
      <div className="row" style={{ justifyContent: "space-between", gap: 10 }}>
        <span className="eyebrow">Why these rows break</span>
        <span className={tone}>{check.status === "fail" ? "✕ fail" : check.status === "warn" ? "△ warn" : "✓ pass"}</span>
      </div>
      <span className="h3">{check.title}</span>
      {check.explanation && <span style={{ font: "400 13.5px/1.55 'Manrope',sans-serif", color: "var(--text2)" }}>{check.explanation}</span>}
      {(check.before || check.after) && (
        <div className="row mono" style={{ gap: 10, fontSize: 12.5, flexWrap: "wrap" }}>
          <span style={{ padding: "6px 9px", borderRadius: 8, background: "#FBE3EC", color: "#B8386E" }}>{check.before ?? "—"}</span>
          <span aria-label="becomes">→</span>
          <span style={{ padding: "6px 9px", borderRadius: 8, background: "#E6F2DF", color: "#47705A" }}>{check.after ?? "—"}</span>
        </div>
      )}
      {check.sql && (
        <div className="col" style={{ gap: 6 }}>
          <span className="eyebrow">Evidence query</span>
          <SqlCode sql={check.sql} style={{ fontSize: 11.5 }} />
        </div>
      )}
      <span className="mono muted" style={{ fontSize: 11 }}>
        {check.key}
        {check.group ? ` · ${check.group}` : ""}
      </span>
    </div>
  );
}
