"use client";

import Link from "next/link";
import { fmtDateTime, fmtDuration, pad2, riskColor, timeAgo } from "@/lib/format";
import type { RehearsalSummary } from "@/lib/types";
import { StatusChip, Skeleton } from "@/components/ui";
import { isLive, rehearsalHref } from "./util";

const COLS = "minmax(0,2.4fr) minmax(0,1.2fr) 124px 64px 84px minmax(0,1.1fr) 92px";

/** Glass table of rehearsals in the design's .tr/.th language. Whole rows are links. */
export function RehearsalTable({ rows, compact = false }: { rows: RehearsalSummary[]; compact?: boolean }) {
  return (
    <div className="rh-table">
      <div className="tr th rh-row" aria-hidden="true" style={{ gridTemplateColumns: COLS }}>
        <span>Migration</span>
        <span className="rh-c-db">Database</span>
        <span>Status</span>
        <span style={{ textAlign: "right" }}>Risk</span>
        <span className="rh-c-dur" style={{ textAlign: "right" }}>Time</span>
        <span className="rh-c-by">Created by</span>
        <span style={{ textAlign: "right" }}>When</span>
      </div>
      {rows.map((r, i) => (
        <Link
          key={r.id}
          href={rehearsalHref(r)}
          className="tr rh-row rh-link"
          style={{ gridTemplateColumns: COLS, textDecoration: "none", color: "inherit", borderBottom: i === rows.length - 1 ? 0 : undefined }}
          aria-label={`${r.name} version ${r.version}, ${r.status}${r.risk != null ? `, risk ${r.risk}` : ""}`}
        >
          <span className="col" style={{ gap: 4, minWidth: 0 }}>
            <span className="row" style={{ gap: 8, minWidth: 0 }}>
              <span className="mono ellipsis" style={{ fontSize: 13.5, fontWeight: 500 }}>{r.name}</span>
              <span className="mono muted" style={{ fontSize: 11.5, flexShrink: 0 }}>V{r.version}</span>
            </span>
            {!compact && r.headline && (
              <span className="muted ellipsis" style={{ fontSize: 12.5 }}>{r.headline}</span>
            )}
          </span>
          <span className="mono ellipsis rh-c-db" style={{ fontSize: 12.5 }}>{r.connection_name}</span>
          <span>
            <StatusChip status={r.status} />
          </span>
          <span className="serif tab" style={{ fontSize: 30, lineHeight: 1, textAlign: "right", color: r.risk == null ? "var(--text2)" : riskColor(r.risk) }}>
            {r.risk == null ? (isLive(r.status) ? "··" : "—") : pad2(r.risk)}
          </span>
          <span className="mono muted rh-c-dur" style={{ fontSize: 12, textAlign: "right" }}>
            {isLive(r.status) ? "running" : fmtDuration(r.duration_ms)}
          </span>
          <span className="row rh-c-by" style={{ gap: 8, minWidth: 0 }}>
            <span className="avatar" style={{ width: 24, height: 24, fontSize: 10, flexShrink: 0 }} aria-hidden="true">{r.created_by.initials}</span>
            <span className="ellipsis" style={{ fontSize: 13 }}>{r.created_by.name}</span>
          </span>
          <span className="mono muted" style={{ fontSize: 12, textAlign: "right" }} title={fmtDateTime(r.created_at)}>
            {timeAgo(r.created_at)}
          </span>
        </Link>
      ))}
    </div>
  );
}

export function RehearsalTableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading rehearsals">
      <div className="tr th rh-row" style={{ gridTemplateColumns: COLS }}>
        <Skeleton h={10} w={90} />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="tr rh-row" style={{ gridTemplateColumns: COLS }}>
          <Skeleton h={14} w={`${70 - (i % 3) * 12}%`} />
          <Skeleton h={12} w="70%" />
          <Skeleton h={22} w={86} style={{ borderRadius: 999 }} />
          <Skeleton h={22} w={36} style={{ justifySelf: "end" }} />
          <Skeleton h={12} w={44} style={{ justifySelf: "end" }} />
          <Skeleton h={12} w="60%" />
          <Skeleton h={12} w={56} style={{ justifySelf: "end" }} />
        </div>
      ))}
    </div>
  );
}
