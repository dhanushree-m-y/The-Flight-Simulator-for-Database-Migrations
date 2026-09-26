"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { TopBar } from "@/components/shell/AppShell";
import { ErrorBlock, LoadingBlock } from "@/components/ui";
import { useApi } from "@/lib/api";
import { pad2, statusChip } from "@/lib/format";
import type { Rehearsal, RehearsalStatus } from "@/lib/types";
import { EVIDENCE_LABEL, EvidenceNav, type EvidenceTab } from "./EvidenceNav";

const LIVE: RehearsalStatus[] = ["queued", "running"];

/** Loads one rehearsal; keeps polling while it is still queued/running so evidence fills in. */
export function useRehearsal(id: string | undefined) {
  const [live, setLive] = useState(false);
  const res = useApi<Rehearsal>(id ? `/api/rehearsals/${id}` : null, { pollMs: live ? 3000 : undefined });
  const status = res.data?.status;
  useEffect(() => {
    setLive(!!status && LIVE.includes(status));
  }, [status]);
  return res;
}

/** "✕ Blocked · 94" — the status chip with the risk score appended. */
export function VerdictChip({ r }: { r: Pick<Rehearsal, "status" | "risk"> }) {
  const c = statusChip(r.status);
  return (
    <span className={c.cls}>
      {c.label}
      {r.risk != null ? ` · ${pad2(r.risk)}` : ""}
    </span>
  );
}

/**
 * Frame shared by the evidence screens: top bar (crumbs + sandbox chip), the page wrapper,
 * the evidence sub-nav and the loading / error states for the rehearsal itself.
 */
export function EvidenceShell({
  id,
  tab,
  pg,
  right,
  children,
}: {
  id: string;
  tab: EvidenceTab;
  pg: string;
  right?: (r: Rehearsal | null) => ReactNode;
  children: (r: Rehearsal, reload: () => void) => ReactNode;
}) {
  const { data: r, error, loading, reload } = useRehearsal(id);

  useEffect(() => {
    if (r) document.title = `${EVIDENCE_LABEL[tab]} · ${r.name} V${r.version} — DryRun`;
  }, [r, tab]);

  return (
    <>
      <TopBar
        crumbs={[
          <Link key="r" href="/rehearsals" className="ev-crumb">
            Rehearsals
          </Link>,
          r ? (
            <Link key="n" href={`/rehearsals/${id}/report`} className="ev-crumb">
              {r.name} · V{r.version}
            </Link>
          ) : (
            <span key="n">…</span>
          ),
          EVIDENCE_LABEL[tab],
        ]}
        env={{ kind: "sandbox", id: r?.sandbox?.id ?? null }}
        right={right ? right(r) : r ? <VerdictChip r={r} /> : null}
      />
      <div className={`pg-${pg} page`} style={{ paddingTop: 26, gap: 22 }}>
        <EvidenceNav id={id} active={tab} />
        {!r && loading ? (
          <LoadingBlock lines={6} />
        ) : !r ? (
          <ErrorBlock error={error ?? new Error("Rehearsal not found.")} onRetry={reload} />
        ) : (
          children(r, reload)
        )}
      </div>
    </>
  );
}

/** Tracks an element's content-box width (for hand-laid-out SVG graphs). Returns a callback ref. */
export function useElementWidth(fallback = 900) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    if (!el) return;
    setW(el.clientWidth || fallback);
    const ro = new ResizeObserver((entries) => {
      const cw = entries[0]?.contentRect.width;
      if (cw) setW(cw);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, fallback]);
  return [setEl, w] as const;
}

/** Prefers-reduced-motion as a boolean. */
export function useReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    setReduce(mq.matches);
    const on = () => setReduce(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduce;
}

/** "8b93…41c" */
export const shortHash = (h: string | null | undefined) => (!h ? "—" : h.length <= 10 ? h : `${h.slice(0, 4)}…${h.slice(-3)}`);

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
/** 1 → "One", 14 → "14" (for sentence-style headlines). */
export const numWord = (n: number) => WORDS[n] ?? String(n);
export const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);
