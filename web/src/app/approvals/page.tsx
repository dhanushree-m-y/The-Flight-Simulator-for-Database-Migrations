"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { TopBar } from "@/components/shell/AppShell";
import { useShell } from "@/components/shell/ShellContext";
import { useApi } from "@/lib/api";
import { fmtDateTime, riskBand, riskColor, timeAgo } from "@/lib/format";
import type { Approval, ApprovalStatus } from "@/lib/types";
import { ApprovalChip, EmptyState, FailState, LoadState, PageHead, PermissionNote, canApprove, useNow } from "@/components/admin/kit";

type Filter = "all" | "open" | "done" | "rejected";
const FILTERS: { key: Filter; label: string; match: (s: ApprovalStatus) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "open", label: "Awaiting", match: (s) => s === "pending" },
  { key: "done", label: "Approved", match: (s) => s === "approved" || s === "applied" || s === "apply_failed" || s === "restored" },
  { key: "rejected", label: "Rejected", match: (s) => s === "rejected" },
];

const bandChip = (r: number | null) => {
  const b = riskBand(r);
  return b === "safe" ? <span className="st st-safe">✓ safe</span> : b === "review" ? <span className="st st-review">△ review</span> : <span className="st st-block">✕ blocked</span>;
};

export default function ApprovalsPage() {
  const { me } = useShell();
  const { data, error, loading, reload } = useApi<Approval[]>("/api/approvals", { pollMs: 15000 });
  const [filter, setFilter] = useState<Filter>("all");
  useNow(30000);

  const { pending, history } = useMemo(() => {
    const list = [...(data ?? [])].sort((a, b) => +new Date(b.requested_at) - +new Date(a.requested_at));
    return { pending: list.filter((a) => a.status === "pending"), history: list.filter((a) => a.status !== "pending") };
  }, [data]);

  const f = FILTERS.find((x) => x.key === filter)!;
  const showPending = filter === "all" || filter === "open";
  const shownHistory = history.filter((a) => f.match(a.status));
  const mine = pending.filter((a) => a.requested_by.id === me?.id).length;

  return (
    <div className="pg-approvals page">
      <TopBar crumbs={["Approvals"]} />
      <PageHead
        eyebrow={
          data
            ? `Approvals · ${pending.length} awaiting · ${history.length} decided · production changes need a second person`
            : "Approvals · production changes need a second person"
        }
        title="Nothing reaches production without a second pair of eyes."
        right={
          <div className="glass tabs" role="tablist" aria-label="Filter approvals">
            {FILTERS.map((x) => (
              <button key={x.key} type="button" role="tab" aria-selected={filter === x.key} className="tabb" onClick={() => setFilter(x.key)}>
                {x.label}
                {x.key === "open" && pending.length > 0 ? ` · ${pending.length}` : ""}
              </button>
            ))}
          </div>
        }
      />

      {loading && !data ? (
        <LoadState title="Loading approval requests…" steps={["Fetching change requests", "Checking who can approve", "Ordering by urgency"]} />
      ) : error && !data ? (
        <FailState title="Couldn’t load approvals." error={error} onRetry={reload} />
      ) : data && data.length === 0 ? (
        <EmptyState
          eyebrow="Empty · nothing to approve"
          title="No production change requests yet."
          body="When a rehearsal passes, an engineer can request approval to apply it to production. It will show up here for an approver who didn’t request it."
          action={
            <Link href="/rehearsals" className="btn btn-p">
              Browse rehearsals
            </Link>
          }
        />
      ) : (
        <>
          {me && !canApprove(me) && pending.length > 0 && (
            <PermissionNote>
              You’re signed in as <b>{me.role}</b>. You can inspect every request, but only an approver or admin who didn’t request the change can approve it.
            </PermissionNote>
          )}
          {me && canApprove(me) && mine > 0 && (
            <PermissionNote tone="sod">
              △ Policy SOD-1: {mine === 1 ? "one request is" : `${mine} requests are`} yours — a different approver has to decide {mine === 1 ? "it" : "them"}.
            </PermissionNote>
          )}

          {showPending && (
            <section className="col" style={{ gap: 14 }} aria-labelledby="ap-pending">
              <span id="ap-pending" className="eyebrow">Awaiting approval · {pending.length}</span>
              {pending.length === 0 ? (
                <div className="glass adm-sb" style={{ padding: "18px 22px" }}>
                  <span className="row" style={{ gap: 10, font: "600 14px/1.3 'Manrope',sans-serif" }}>
                    <span className="st st-safe">✓ clear</span>Nothing is waiting on a decision.
                  </span>
                </div>
              ) : (
                <div className="pend">
                  {pending.map((a, i) => (
                    <Link key={a.id} href={`/approvals/${a.id}`} className={`glass pcard rise${i < 3 ? ` rise-${i + 2}` : ""}`} aria-label={`Review ${a.rehearsal.name} version ${a.rehearsal.version} for ${a.rehearsal.connection_name}`}>
                      <div className="row" style={{ justifyContent: "space-between", gap: 10 }}>
                        <span className="env env-prod" style={{ height: 28 }}>⛨ {a.rehearsal.connection_name}</span>
                        <span className="mono muted" style={{ fontSize: 11 }}>{timeAgo(a.requested_at)}</span>
                      </div>
                      <div className="row" style={{ gap: 14, alignItems: "flex-end" }}>
                        <span className="serif tab" style={{ fontSize: 52, lineHeight: 0.85, color: riskColor(a.rehearsal.risk) }}>
                          {a.rehearsal.risk == null ? "—" : String(a.rehearsal.risk).padStart(2, "0")}
                        </span>
                        <div className="col" style={{ gap: 6, minWidth: 0 }}>
                          {bandChip(a.rehearsal.risk)}
                          <span className="mono" style={{ fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {a.rehearsal.name} · V{a.rehearsal.version}
                          </span>
                        </div>
                      </div>
                      {a.rehearsal.headline && <span style={{ font: "400 13px/1.5 'Manrope',sans-serif", color: "var(--text2)" }}>{a.rehearsal.headline}</span>}
                      <div className="row" style={{ gap: 8, marginTop: "auto", paddingTop: 4, borderTop: "1px solid var(--line)" }}>
                        <span className="mono muted" style={{ fontSize: 11.5, paddingTop: 10 }}>
                          {a.checklist.filter((c) => c.ok).length}/{a.checklist.length} checks · by {a.requested_by.id === me?.id ? "you" : a.requested_by.name}
                        </span>
                        <span className="btn btn-sm" style={{ marginLeft: "auto", marginTop: 10 }}>Review →</span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          )}

          {filter !== "open" && (
            <section className="col" style={{ gap: 14 }} aria-labelledby="ap-history">
              <span id="ap-history" className="eyebrow">History · {shownHistory.length}</span>
              {shownHistory.length === 0 ? (
                <div className="glass adm-sb" style={{ padding: "18px 22px" }}>
                  <span className="muted">No decided requests{filter !== "all" ? " match this filter" : " yet"}.</span>
                </div>
              ) : (
                <div className="panel col" style={{ overflow: "hidden" }}>
                  <div className="ap hd">
                    <span>MIGRATION</span>
                    <span className="c-db">DATABASE</span>
                    <span className="c-risk">RISK</span>
                    <span className="c-req">REQUESTED → DECIDED</span>
                    <span className="c-when">WHEN</span>
                    <span>RESULT</span>
                    <span className="c-go" aria-hidden="true" />
                  </div>
                  {shownHistory.map((a) => (
                    <Link key={a.id} href={`/approvals/${a.id}`} className="ap">
                      <span className="col" style={{ gap: 3, minWidth: 0 }}>
                        <span className="mono" style={{ fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {a.rehearsal.name} · V{a.rehearsal.version}
                        </span>
                        <span className="muted" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {a.comment ? `“${a.comment}”` : a.rehearsal.headline ?? "—"}
                        </span>
                      </span>
                      <span className="mono c-db" style={{ fontSize: 11.5, color: "#A8234F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        ⛨ {a.rehearsal.connection_name}
                      </span>
                      <span className="serif tab c-risk" style={{ fontSize: 28, lineHeight: 1, color: riskColor(a.rehearsal.risk) }}>
                        {a.rehearsal.risk == null ? "—" : String(a.rehearsal.risk).padStart(2, "0")}
                      </span>
                      <span className="c-req" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {a.requested_by.name} → {a.decided_by?.name ?? "—"}
                      </span>
                      <span className="mono muted c-when" style={{ fontSize: 11.5 }}>
                        {fmtDateTime(a.decided_at ?? a.requested_at)}
                      </span>
                      <span>
                        <ApprovalChip status={a.status} />
                      </span>
                      <span className="muted c-go" aria-hidden="true">→</span>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          )}
          {error && data && (
            <span className="adm-err" role="status">
              ✕ Live refresh failed ({error.message}). Showing the last loaded list.
            </span>
          )}
        </>
      )}
    </div>
  );
}
