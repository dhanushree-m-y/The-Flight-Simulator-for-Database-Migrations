"use client";

import Link from "next/link";
import "./evidence.css";

export type EvidenceTab = "report" | "rows" | "impact" | "fix" | "lineage" | "rollback";

const TABS: { key: EvidenceTab; label: string }[] = [
  { key: "report", label: "Report" },
  { key: "rows", label: "Broken rows" },
  { key: "impact", label: "Impact" },
  { key: "fix", label: "AI fix" },
  { key: "lineage", label: "Lineage" },
  { key: "rollback", label: "Rollback" },
];

export const EVIDENCE_LABEL: Record<EvidenceTab, string> = Object.fromEntries(TABS.map((t) => [t.key, t.label])) as Record<EvidenceTab, string>;

/** Sub-navigation between the evidence screens of one rehearsal. */
export function EvidenceNav({ id, active }: { id: string; active: EvidenceTab }) {
  return (
    <nav className="ev-nav" aria-label="Rehearsal evidence">
      {TABS.map((t) => (
        <Link key={t.key} href={`/rehearsals/${id}/${t.key}`} aria-current={t.key === active ? "page" : undefined}>
          {t.key === "fix" && <span aria-hidden="true" style={{ color: "#6A4FB8" }}>◇</span>}
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
