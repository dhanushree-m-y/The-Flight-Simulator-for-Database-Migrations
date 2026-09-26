"use client";

import "./admin.css";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ApiError } from "@/lib/api";
import type { ApprovalStatus, Role, User } from "@/lib/types";

/* ------------------------------------------------------------------ roles */

export const ROLE_RANK: Record<Role, number> = { viewer: 0, engineer: 1, approver: 2, admin: 3 };
export const canApprove = (u: User | null | undefined) => !!u && (u.role === "approver" || u.role === "admin");
export const canEngineer = (u: User | null | undefined) => !!u && ROLE_RANK[u.role] >= ROLE_RANK.engineer;
export const isAdmin = (u: User | null | undefined) => !!u && u.role === "admin";

export const ROLE_CAN: Record<Role, string> = {
  viewer: "Reads everything. Changes nothing.",
  engineer: "Runs rehearsals and AI fixes.",
  approver: "Approves production changes.",
  admin: "Everything, incl. databases & policies.",
};

/** Role chip in the design's language: production-capable roles get the dark ⛨ chip. */
export function RoleChip({ role }: { role: Role }) {
  if (role === "approver" || role === "admin")
    return (
      <span className="st st-block" style={{ justifySelf: "start", background: "#2A1620", color: "#FFE9F1", borderColor: "#2A1620", boxShadow: "none" }}>
        ⛨ {role}
      </span>
    );
  if (role === "engineer") return <span className="st st-safe" style={{ justifySelf: "start" }}>◌ engineer</span>;
  return <span className="st st-info" style={{ justifySelf: "start" }}>◇ viewer</span>;
}

export const ROLE_AVATAR: Record<Role, { bg: string; fg: string }> = {
  admin: { bg: "#EEE7FF", fg: "#6A4FB8" },
  approver: { bg: "#FFE4CC", fg: "#A3552F" },
  engineer: { bg: "#FFD7E5", fg: "#B8386E" },
  viewer: { bg: "#E6F2DF", fg: "#47705A" },
};

/* ---------------------------------------------------------- approval chip */

export function approvalChip(s: ApprovalStatus): { cls: string; label: string } {
  switch (s) {
    case "pending":
      return { cls: "st st-review", label: "△ awaiting approval" };
    case "approved":
      return { cls: "st st-ai", label: "◉ approved · applying" };
    case "applied":
      return { cls: "st st-safe", label: "✓ applied" };
    case "rejected":
      return { cls: "st st-block", label: "✕ rejected" };
    case "apply_failed":
      return { cls: "st st-block", label: "! apply failed" };
    case "restored":
      return { cls: "st st-info", label: "↺ restored" };
  }
}

export function ApprovalChip({ status }: { status: ApprovalStatus }) {
  const c = approvalChip(status);
  return <span className={c.cls} style={{ justifySelf: "start" }}>{c.label}</span>;
}

/* ------------------------------------------------------------ page parts */

export function PageHead({ eyebrow, title, right, titleSize }: { eyebrow: ReactNode; title: ReactNode; right?: ReactNode; titleSize?: number }) {
  return (
    <div className="adm-head">
      <div className="col">
        <span className="eyebrow">{eyebrow}</span>
        <h1 className="h1" style={{ margin: 0, fontSize: titleSize }}>{title}</h1>
      </div>
      {right}
    </div>
  );
}

/** The dark hazard-striped PRODUCTION strip from the approve / execute designs. */
export function ProdStrip({ name, right, back, compact }: { name: string; right?: ReactNode; back?: ReactNode; compact?: boolean }) {
  return (
    <div className="adm-prod" role="note" aria-label={`Production environment: ${name}`}>
      <span className="stripe" aria-hidden="true" />
      {back}
      <div className="row" style={{ gap: compact ? 8 : 14, padding: compact ? "0 12px 0 4px" : "0 24px", minWidth: 0 }}>
        {!compact && (
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="#FFB3CE" strokeWidth="1.5" aria-hidden="true">
            <path d="M8 1.5l5 2.5v4c0 3.2-2.4 5.3-5 6.5-2.6-1.2-5-3.3-5-6.5V4z" />
          </svg>
        )}
        <span style={{ font: `500 ${compact ? 11 : 13}px/1 'DM Mono',monospace`, letterSpacing: ".2em" }}>PRODUCTION</span>
        <span style={{ font: `500 ${compact ? 15 : 18}px/1 'DM Mono',monospace`, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
      </div>
      {right}
    </div>
  );
}

/* ----------------------------------------------------- states (design 21) */

/** Loading · real work, named. */
export function LoadState({ title, steps = [] }: { title: string; steps?: string[] }) {
  return (
    <div className="glass adm-sb" aria-busy="true" role="status">
      <span className="eyebrow">Loading · real work, named</span>
      <span className="serif" style={{ fontSize: 34, lineHeight: 1.05 }}>{title}</span>
      <div className="adm-indet" aria-hidden="true"><i /></div>
      {steps.length > 0 && (
        <div className="col">
          {steps.map((s, i) => (
            <div key={s} className="adm-ld" style={i === 0 ? undefined : { color: "var(--text2)" }}>
              {i === 0 ? <span className="breathe" style={{ color: "#7758C8" }}>●</span> : <span>○</span>}
              <span>{s}</span>
              <code>{i === 0 ? "now" : "next"}</code>
            </div>
          ))}
        </div>
      )}
      <div className="col" style={{ gap: 8, marginTop: 6 }} aria-hidden="true">
        <div className="adm-shim" style={{ width: "92%" }} />
        <div className="adm-shim" style={{ width: "74%" }} />
      </div>
    </div>
  );
}

/** Error · specific and recoverable. Always states whether production was touched. */
export function FailState({ title, error, onRetry, touched = false, action }: { title: string; error: Error | null; onRetry?: () => void; touched?: boolean; action?: ReactNode }) {
  const code = error instanceof ApiError ? error.status : null;
  const reason =
    code === 403 ? "your role doesn’t allow this" : code === 404 ? "not found" : code === 0 || !code ? error?.message || "the DryRun API didn’t respond" : error?.message;
  return (
    <div className="glass adm-sb" role="alert" style={{ borderColor: "rgba(168,35,79,.3)" }}>
      <div className="row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <span className="eyebrow" style={{ color: "#A8234F" }}>Error · specific and recoverable</span>
        <span className="st st-block">✕ {code ? `HTTP ${code}` : "no response"}</span>
      </div>
      <span className="serif" style={{ fontSize: 36, lineHeight: 1.05 }}>{title}</span>
      <div className="col">
        <div className="kv"><span>Reason</span><span style={{ textAlign: "right", overflowWrap: "anywhere" }}>{reason}</span></div>
        {code === 403 && <div className="kv"><span>What to do</span><span>ask an admin to change your role</span></div>}
      </div>
      {!touched && (
        <div className="row" style={{ gap: 10, padding: "12px 14px", borderRadius: 12, background: "#E6F2DF", flexWrap: "wrap" }}>
          <span style={{ width: 22, height: 22, borderRadius: "50%", background: "#47705A", color: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", font: "600 12px/1 'Manrope',sans-serif" }}>✓</span>
          <span style={{ font: "600 14px/1.3 'Manrope',sans-serif", color: "#2F4B3C" }}>Production was not modified.</span>
        </div>
      )}
      <div className="row" style={{ gap: 10, marginTop: 4, flexWrap: "wrap" }}>
        {onRetry && (
          <button type="button" className="btn" onClick={onRetry}>
            Retry
          </button>
        )}
        {action}
      </div>
    </div>
  );
}

/** Empty · first visit. */
export function EmptyState({ eyebrow = "Empty", title, body, action }: { eyebrow?: string; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="glass adm-sb">
      <span className="eyebrow">{eyebrow}</span>
      <span className="serif" style={{ fontSize: 36, lineHeight: 1.05 }}>{title}</span>
      {body && <span style={{ font: "400 15px/1.5 'Manrope',sans-serif", color: "var(--text2)", maxWidth: 560 }}>{body}</span>}
      {action && <div className="row" style={{ gap: 10, marginTop: 6, flexWrap: "wrap" }}>{action}</div>}
    </div>
  );
}

const Lock = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true" style={{ verticalAlign: -1, flexShrink: 0 }}>
    <rect x="2" y="5.5" width="8" height="5.5" />
    <path d="M4 5.5V4a2 2 0 014 0v1.5" />
  </svg>
);

/** Permission · visible limits, never hidden buttons. */
export function PermissionNote({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "sod" }) {
  const sod = tone === "sod";
  return (
    <div
      className="panel row"
      style={{
        gap: 8,
        padding: "12px 14px",
        alignItems: "flex-start",
        background: sod ? "#FFF4EA" : undefined,
        borderColor: sod ? "rgba(197,111,69,.3)" : undefined,
        font: `${sod ? 500 : 400} 12.5px/1.5 'Manrope',sans-serif`,
        color: sod ? "#A3552F" : "var(--text2)",
      }}
    >
      <span style={{ paddingTop: 2 }}><Lock /></span>
      <span>{children}</span>
    </div>
  );
}
export { Lock as LockIcon };

/* ------------------------------------------------------------ modal/drawer */

export function Modal({
  open,
  onClose,
  label,
  children,
  drawer = false,
  danger = false,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
  drawer?: boolean;
  danger?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<Element | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    setHost(document.querySelector(".pm.app") ?? document.body);
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => {
      const first = box.current?.querySelector<HTMLElement>("[data-autofocus], input, textarea, select, button");
      first?.focus();
    }, 20);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close.current();
      }
      if (e.key === "Tab" && box.current) {
        const f = Array.from(box.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), textarea, select")).filter((el) => el.offsetParent !== null);
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey, true);
      prev?.focus?.();
    };
  }, [open]);

  if (!open || !host) return null;
  return createPortal(
    <div className={`adm-overlay${drawer ? " drawer" : ""}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} className={`adm-dialog${danger ? " danger" : ""}`} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>,
    host,
  );
}

/* ---------------------------------------------------------------- hooks */

export function useMediaQuery(q: string) {
  const [m, setM] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return m;
}

/** Re-render on an interval (for "time ago" labels and countdowns). */
export function useNow(ms = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export const shortHash = (h: string | null | undefined, n = 6) => (!h ? "—" : h.length <= n * 2 + 1 ? h : `${h.slice(0, n)}…${h.slice(-4)}`);

export function errMsg(e: unknown): string {
  if (e instanceof ApiError) return e.status === 403 ? `Not allowed — ${e.message}` : e.message;
  if (e instanceof Error) return e.message;
  return "Something went wrong.";
}

export function download(filename: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
