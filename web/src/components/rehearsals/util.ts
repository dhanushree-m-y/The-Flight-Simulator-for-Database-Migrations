"use client";

import { useEffect, useRef, useState } from "react";
import { pad2, riskBand, statusChip } from "@/lib/format";
import type { RehearsalStatus, RehearsalSummary } from "@/lib/types";

/** Running / queued rehearsals open the live view; finished ones open their report. */
export function rehearsalHref(r: Pick<RehearsalSummary, "id" | "status">): string {
  return r.status === "running" || r.status === "queued" ? `/rehearsals/${r.id}` : `/rehearsals/${r.id}/report`;
}

export const isLive = (s: RehearsalStatus) => s === "running" || s === "queued";

/** Chip text in the overview's compact form: "✓ safe · 08". */
export function compactChip(status: RehearsalStatus, risk: number | null): { cls: string; label: string } {
  const c = statusChip(status);
  const label = c.label.toLowerCase();
  return { cls: c.cls, label: risk != null && !isLive(status) ? `${label} · ${pad2(risk)}` : label };
}

/** Pin / accent colour for a rehearsal on timelines. */
export function pinColor(status: RehearsalStatus, risk: number | null): string {
  if (isLive(status)) return "#CBB8F6";
  if (status === "failed" || status === "cancelled") return "#E6D9E5";
  if (status === "blocked") return "#D94F87";
  if (status === "warning") return "#F7C59F";
  if (status === "passed") return "#BFD9B5";
  return { safe: "#BFD9B5", review: "#F7C59F", block: "#D94F87" }[riskBand(risk)];
}

/** "003_room_capacity" → "003"; otherwise a trimmed name for tight chart labels. */
export function shortName(name: string, max = 14): string {
  const m = /^(\d{2,})[_-]/.exec(name);
  if (m) return m[1];
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Ease-out progress 0 → 1 that starts the first time `ready` becomes true (the design's count-up).
 * Later data refreshes do not replay it.
 */
export function useCountUp(ready: boolean, durationMs = 1800): number {
  const [p, setP] = useState(0);
  const started = useRef(false);
  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    if (prefersReducedMotion()) {
      setP(1);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const tick = () => {
      const k = Math.min(1, (performance.now() - t0) / durationMs);
      setP(1 - Math.pow(1 - k, 3));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      started.current = false; // allow a clean restart (React strict-mode remount)
    };
  }, [ready, durationMs]);
  return p;
}

/** Tracks an element's content width (for charts that must not stretch their text). */
export function useElementWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0].contentRect.width);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

/** Monotone cubic (Fritsch–Carlson) path through points sorted by x — smooth, never overshoots. */
export function monotonePath(pts: { x: number; y: number }[]): string {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M${pts[0].x} ${pts[0].y}`;
  if (n === 2) return `M${pts[0].x} ${pts[0].y} L${pts[1].x} ${pts[1].y}`;
  const dx: number[] = [];
  const s: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = Math.max(1e-6, pts[i + 1].x - pts[i].x);
    s[i] = (pts[i + 1].y - pts[i].y) / dx[i];
  }
  const m: number[] = [s[0]];
  for (let i = 1; i < n - 1; i++) m[i] = s[i - 1] * s[i] <= 0 ? 0 : (s[i - 1] + s[i]) / 2;
  m[n - 1] = s[n - 2];
  for (let i = 0; i < n - 1; i++) {
    if (s[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / s[i];
    const b = m[i + 1] / s[i];
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      m[i] = t * a * s[i];
      m[i + 1] = t * b * s[i];
    }
  }
  const f = (v: number) => Number(v.toFixed(2));
  let d = `M${f(pts[0].x)} ${f(pts[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${f(pts[i].x + h)} ${f(pts[i].y + m[i] * h)} ${f(pts[i + 1].x - h)} ${f(pts[i + 1].y - m[i + 1] * h)} ${f(pts[i + 1].x)} ${f(pts[i + 1].y)}`;
  }
  return d;
}

/** Tiny sparkline path in a w×h box. */
export function sparkPath(values: number[], w = 90, h = 22): string | null {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - 3 - ((v - min) / span) * (h - 6);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

export const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

export function startOfDay(iso: string): number {
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function dayLabel(ms: number, withDate = true): string {
  const d = new Date(ms);
  const wd = d.toLocaleDateString("en-GB", { weekday: "short" });
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  return `${wd}${withDate ? ` ${d.getDate()}` : ""}${isToday ? " · today" : ""}`;
}
