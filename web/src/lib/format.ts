import type { RehearsalStatus } from "./types";

export const fmtInt = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-IN"));

export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export function fmtBytes(b: number | null | undefined): string {
  if (b == null) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = b;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

/** Risk bands used everywhere: 0–30 safe, 31–60 review, 61–100 blocked. */
export type RiskBand = "safe" | "review" | "block";
export const riskBand = (r: number | null | undefined): RiskBand => (r == null ? "review" : r <= 30 ? "safe" : r <= 60 ? "review" : "block");
export const riskColor = (r: number | null | undefined) =>
  ({ safe: "#47705A", review: "#A3552F", block: "#A8234F" })[riskBand(r)];

export function statusChip(status: RehearsalStatus): { cls: string; label: string } {
  switch (status) {
    case "passed":
      return { cls: "st st-safe", label: "✓ Safe" };
    case "warning":
      return { cls: "st st-review", label: "△ Review" };
    case "blocked":
      return { cls: "st st-block", label: "✕ Blocked" };
    case "running":
      return { cls: "st st-ai", label: "◉ Running" };
    case "queued":
      return { cls: "st st-info", label: "○ Queued" };
    case "cancelled":
      return { cls: "st st-info", label: "— Cancelled" };
    default:
      return { cls: "st st-block", label: "! Error" };
  }
}

export const pad2 = (n: number) => String(n).padStart(2, "0");
