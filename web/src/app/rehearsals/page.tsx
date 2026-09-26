"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { TopBar } from "@/components/shell/AppShell";
import { EmptyBlock, ErrorBlock, HeroBand } from "@/components/ui";
import { RehearsalTable, RehearsalTableSkeleton } from "@/components/rehearsals/RehearsalTable";
import { isLive } from "@/components/rehearsals/util";
import { useApi } from "@/lib/api";
import type { RehearsalStatus, RehearsalSummary } from "@/lib/types";
import "@/components/rehearsals/screens.css";

type Filter = "all" | "live" | "passed" | "warning" | "blocked" | "failed";

const FILTERS: { key: Filter; label: string; match: (s: RehearsalStatus) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "live", label: "◉ Running", match: isLive },
  { key: "passed", label: "✓ Safe", match: (s) => s === "passed" },
  { key: "warning", label: "△ Review", match: (s) => s === "warning" },
  { key: "blocked", label: "✕ Blocked", match: (s) => s === "blocked" },
  { key: "failed", label: "! Errored", match: (s) => s === "failed" || s === "cancelled" },
];

export default function RehearsalsPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  // Poll faster while something is in flight so statuses settle without a refresh.
  const [anyLive, setAnyLive] = useState(false);
  const list = useApi<RehearsalSummary[]>("/api/rehearsals?limit=200", { pollMs: anyLive ? 4000 : 20000 });
  const rows = list.data;

  const live = !!rows?.some((r) => isLive(r.status));
  if (live !== anyLive) setAnyLive(live);

  const counts = useMemo(() => {
    const c = Object.fromEntries(FILTERS.map((f) => [f.key, 0])) as Record<Filter, number>;
    for (const r of rows ?? []) for (const f of FILTERS) if (f.match(r.status)) c[f.key]++;
    return c;
  }, [rows]);

  const visible = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter)!;
    const needle = q.trim().toLowerCase();
    return (rows ?? []).filter(
      (r) =>
        f.match(r.status) &&
        (!needle ||
          r.name.toLowerCase().includes(needle) ||
          r.connection_name.toLowerCase().includes(needle) ||
          r.created_by.name.toLowerCase().includes(needle) ||
          (r.headline ?? "").toLowerCase().includes(needle)),
    );
  }, [rows, filter, q]);

  const newBtn = (
    <Link href="/rehearsals/new" className="btn btn-lg btn-p btn-spark" aria-keyshortcuts="N">
      + New rehearsal{" "}
      <span className="kbd" style={{ background: "transparent", color: "#FFFFFF", borderColor: "rgba(255,255,255,.5)" }}>
        N
      </span>
    </Link>
  );

  return (
    <>
      <TopBar crumbs={["Rehearsals"]} env={{ kind: "org" }} />
      <div className="pg-rehearsals page">
        <HeroBand eyebrow="Rehearsals" title="Every change, rehearsed first." right={newBtn} />

        <div className="row" style={{ gap: 14, flexWrap: "wrap", justifyContent: "space-between" }}>
          <div className="rh-pills" role="group" aria-label="Filter by status">
            {FILTERS.map((f) => (
              <button key={f.key} type="button" className="rh-pill" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
                {f.label}
                {rows && <span className="ct">{counts[f.key]}</span>}
              </button>
            ))}
          </div>
          <label className="row" style={{ gap: 8, flex: "0 1 280px" }}>
            <span className="sr-only">Search rehearsals</span>
            <input
              className="inp rh-search"
              type="search"
              placeholder="Search name, database, author…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
        </div>

        {list.error && !rows ? (
          <ErrorBlock error={list.error} onRetry={list.reload} />
        ) : !rows ? (
          <div className="glass" style={{ overflow: "hidden" }}>
            <RehearsalTableSkeleton rows={8} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyBlock
            title="No rehearsals yet."
            body="Pick a database, paste a migration, and DryRun replays it on an isolated sandbox copy — production is never touched."
            action={
              <Link href="/rehearsals/new" className="btn btn-p">
                + New rehearsal
              </Link>
            }
          />
        ) : visible.length === 0 ? (
          <EmptyBlock
            title="Nothing matches."
            body={q ? `No rehearsals match “${q}” in this view.` : "No rehearsals with this status yet."}
            action={
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  setFilter("all");
                  setQ("");
                }}
              >
                Clear filters
              </button>
            }
          />
        ) : (
          <div className="glass rise" style={{ overflow: "hidden" }}>
            <RehearsalTable rows={visible} />
            <div className="row mono muted" style={{ fontSize: 11.5, padding: "12px 18px", borderTop: "1px solid var(--line)", gap: 12 }}>
              <span>
                {visible.length} of {rows.length} rehearsals
              </span>
              {live && (
                <span className="row" style={{ gap: 6, marginLeft: "auto" }}>
                  <span className="dot breathe" style={{ background: "#7758C8" }} /> live — refreshing every 4s
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
