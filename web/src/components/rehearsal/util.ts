"use client";

import { useEffect, useRef, useState } from "react";
import type { Check, Rehearsal, RehearsalStatus, StageKey } from "@/lib/types";

export const LIVE_STATUSES: RehearsalStatus[] = ["queued", "running"];
export const isLive = (s: RehearsalStatus | null | undefined) => !!s && LIVE_STATUSES.includes(s);

/** Short stage names used on the timeline (the design breaks "Production copy" over two lines). */
export const STAGE_NAMES: Record<StageKey, string[]> = {
  provision: ["Production", "copy"],
  snapshot: ["Snapshot"],
  migrate: ["Migration"],
  compare: ["Compare"],
  ai_checks: ["AI checks"],
  rollback: ["Rollback"],
  report: ["Report"],
};

export const STAGE_ORDER: StageKey[] = ["provision", "snapshot", "migrate", "compare", "ai_checks", "rollback", "report"];

/** What the verdict means for a human, per status. */
export function verdictOf(status: RehearsalStatus): { cls: string; label: string; short: string } {
  switch (status) {
    case "passed":
      return { cls: "st st-safe", label: "✓ Safe to apply", short: "safe" };
    case "warning":
      return { cls: "st st-review", label: "△ Needs review", short: "review" };
    case "blocked":
      return { cls: "st st-block", label: "✕ Do not apply", short: "blocked" };
    case "failed":
      return { cls: "st st-block", label: "! Rehearsal errored", short: "errored" };
    case "cancelled":
      return { cls: "st st-info", label: "— Cancelled", short: "cancelled" };
    case "running":
      return { cls: "st st-ai", label: "◉ Running", short: "running" };
    default:
      return { cls: "st st-info", label: "○ Queued", short: "queued" };
  }
}

/** Band colour as a theme-aware CSS variable (works in light glass and dark plum). */
export function bandVar(risk: number | null | undefined) {
  if (risk == null) return "var(--text2)";
  return risk <= 30 ? "var(--green)" : risk <= 60 ? "var(--peach-ink)" : "var(--danger)";
}

export const issuesOf = (checks: Check[]) => checks.filter((c) => c.status !== "pass");

export const GROUP_LABEL: Record<Check["group"], string> = {
  data: "Data integrity",
  constraint: "Constraints",
  performance: "Performance & locks",
  ai: "AI checks",
};

export function checkChip(c: Check): { cls: string; label: string } {
  if (c.status === "fail") return { cls: "st st-block", label: "✕ Fail" };
  if (c.status === "warn") return { cls: "st st-review", label: "△ Warn" };
  return { cls: "st st-safe", label: "✓ Pass" };
}

/** Find a log timestamp that mentions a check (used for "Issue discovered · 14:32:14"). */
export function checkSeenAt(r: Rehearsal, c: Check): string | null {
  const hit = r.logs.find((l) => l.level !== "info" && (l.message.includes(c.key) || (c.title && l.message.includes(c.title))));
  return hit?.ts ?? null;
}

const reduceMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Eased count-up towards `target` — every time the target changes it glides from the current value. */
export function useCountUp(target: number, ms = 1400) {
  const [v, setV] = useState(0);
  const from = useRef(0);
  const cur = useRef(0);
  useEffect(() => {
    if (reduceMotion()) {
      cur.current = target;
      setV(target);
      return;
    }
    from.current = cur.current;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      const val = from.current + (target - from.current) * e;
      cur.current = val;
      setV(val);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

/** A clock that ticks every `ms` while `on` is true. */
export function useNow(on: boolean, ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [on, ms]);
  return now;
}

export type DiffLine = { text: string; mark?: "add" | "del" };

/** Minimal LCS line diff — schema snippets are small, so O(n·m) is fine. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.replace(/\s+$/, "").split("\n");
  const b = after.replace(/\s+$/, "").split("\n");
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i].trim() === b[j].trim() ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i].trim() === b[j].trim()) {
      out.push({ text: b[j] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ text: a[i++], mark: "del" });
    else out.push({ text: b[j++], mark: "add" });
  }
  while (i < n) out.push({ text: a[i++], mark: "del" });
  while (j < m) out.push({ text: b[j++], mark: "add" });
  return out;
}

export const shortHash = (h: string | null | undefined) => (!h ? "—" : h.length > 10 ? `${h.slice(0, 4)}…${h.slice(-3)}` : h);
