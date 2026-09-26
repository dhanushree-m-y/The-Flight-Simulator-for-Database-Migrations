"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode, type MouseEvent } from "react";
import { Command } from "cmdk";
import { Toaster } from "sonner";
import { useShell } from "./ShellContext";
import { useApi } from "@/lib/api";
import type { Approval, RehearsalSummary } from "@/lib/types";
import {
  BrandMark,
  IconApprovals,
  IconAudit,
  IconBell,
  IconDatabases,
  IconIntegrations,
  IconMoon,
  IconOverview,
  IconPolicies,
  IconRehearsals,
  IconSearch,
  IconSettings,
  IconSun,
} from "@/components/icons";

const NAV = [
  { href: "/", label: "Overview", icon: IconOverview },
  { href: "/rehearsals", label: "Rehearsals", icon: IconRehearsals },
  { href: "/approvals", label: "Approvals", icon: IconApprovals, badge: true },
  { href: "/databases", label: "Databases", icon: IconDatabases },
  { href: "/policies", label: "Policies", icon: IconPolicies },
  { href: "/audit", label: "Audit Log", icon: IconAudit },
  { href: "/integrations", label: "Integrations", icon: IconIntegrations },
  { href: "/settings", label: "Settings", icon: IconSettings },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function AppShell({ children }: { children: ReactNode }) {
  const { dark, variant, me } = useShell();
  const pathname = usePathname();
  const pending = useApi<Approval[]>("/api/approvals?status=pending", { pollMs: 15000 });
  const sparks = useSparkles();

  return (
    <div
      className={`pm app${variant === "calm" ? " calm" : ""}${dark ? " dark" : ""}`}
      onMouseMove={sparks.onMove}
      onMouseLeave={sparks.onLeave}
    >
      <div className="atmo" aria-hidden="true">
        <div className="l1" />
        <div className="l2" />
        <div className="l3" />
      </div>
      <aside className="side" aria-label="Primary">
        <Link href="/" className="brand" style={{ height: "auto", padding: "0 8px 26px", background: "none", boxShadow: "none" }}>
          <BrandMark />
          <span>DryRun</span>
        </Link>
        {NAV.map((n) => {
          const Icon = n.icon;
          const count = n.badge ? pending.data?.length ?? 0 : 0;
          return (
            <Link key={n.href} href={n.href} className={isActive(pathname, n.href) ? "on" : undefined}>
              <Icon />
              <span className="lbl">{n.label}</span>
              {count > 0 && <span className="badge">{count}</span>}
            </Link>
          );
        })}
        <div className="col who" style={{ marginTop: "auto", gap: 4, padding: "12px 10px", borderTop: "1px solid var(--line)" }}>
          <span style={{ font: "600 13px/1.2 'Manrope',sans-serif" }}>{me?.name ?? "Signed out"}</span>
          <span className="eyebrow">{me?.role ?? "—"}</span>
        </div>
      </aside>
      <div className="col above" style={{ minWidth: 0 }}>
        {children}
      </div>
      <CommandPalette />
      {sparks.nodes}
      <Toaster position="bottom-right" toastOptions={{ style: { fontFamily: "Manrope, sans-serif", borderRadius: 12 } }} />
    </div>
  );
}

type Env = { kind: "org" } | { kind: "sandbox"; id?: string | null } | { kind: "production"; name: string };

/** Top bar: breadcrumb, search, notifications, environment chip, theme, avatar. Pages pass `right` for page actions. */
export function TopBar({ crumbs, env = { kind: "org" }, right }: { crumbs: ReactNode[]; env?: Env; right?: ReactNode }) {
  const { dark, toggleDark, me, users, switchUser, setPaletteOpen } = useShell();
  const [menu, setMenu] = useState(false);
  const [bell, setBell] = useState(false);
  return (
    <div className="top">
      <div className="crumb">
        {crumbs.map((c, i) => (
          <span key={i}>
            {i > 0 && " / "}
            {i === crumbs.length - 1 ? <b>{c}</b> : c}
          </span>
        ))}
      </div>
      <button type="button" className="search" style={{ marginLeft: "auto", cursor: "pointer" }} onClick={() => setPaletteOpen(true)}>
        <IconSearch /> Search migrations, rows, hashes<span className="kbd" style={{ marginLeft: "auto" }}>⌘K</span>
      </button>
      {right}
      <div style={{ position: "relative" }}>
        <button type="button" className="iconbtn" aria-label="Notifications" onClick={() => setBell((b) => !b)}>
          <IconBell />
        </button>
        {bell && <Notifications onClose={() => setBell(false)} />}
      </div>
      {env.kind === "org" && <span className="env env-org">ORG VIEW · no environment</span>}
      {env.kind === "sandbox" && (
        <span className="env env-sb">
          <span className="dot breathe" />
          SANDBOX{env.id ? ` · ${env.id}` : ""}
        </span>
      )}
      {env.kind === "production" && <span className="env env-prod">⛨ PRODUCTION · {env.name}</span>}
      <button type="button" className="iconbtn" aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} onClick={toggleDark}>
        {dark ? <IconSun /> : <IconMoon />}
      </button>
      <div style={{ position: "relative" }}>
        <button type="button" className="avatar" style={{ border: 0 }} aria-label={`Signed in as ${me?.name ?? "unknown"}`} onClick={() => setMenu((m) => !m)}>
          {me?.initials ?? "··"}
        </button>
        {menu && (
          <div className="glass col" style={{ position: "absolute", right: 0, top: 44, width: 260, padding: 8, zIndex: 50 }}>
            <span className="eyebrow" style={{ padding: "8px 10px" }}>Act as (demo roles)</span>
            {users.map((u) => (
              <button
                key={u.id}
                type="button"
                className="row"
                onClick={() => switchUser(u.id)}
                style={{ gap: 10, padding: "8px 10px", border: 0, borderRadius: 10, background: u.id === me?.id ? "var(--surface)" : "transparent", color: "var(--text)", textAlign: "left" }}
              >
                <span className="avatar" style={{ width: 28, height: 28, fontSize: 11 }}>{u.initials}</span>
                <span className="col" style={{ gap: 2 }}>
                  <span style={{ font: "600 13px/1.2 'Manrope',sans-serif" }}>{u.name}</span>
                  <span className="eyebrow">{u.role}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Notifications({ onClose }: { onClose: () => void }) {
  const { data } = useApi<RehearsalSummary[]>("/api/rehearsals?limit=6");
  return (
    <div className="glass col" style={{ position: "absolute", right: 0, top: 44, width: 400, zIndex: 50, background: "var(--glass-strong)" }}>
      <div className="row" style={{ padding: "14px 18px", borderBottom: "1px solid var(--line)" }}>
        <span className="h2" style={{ fontSize: 22 }}>Notifications</span>
        <button type="button" className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={onClose}>
          Close
        </button>
      </div>
      {(data ?? []).map((r) => (
        <Link key={r.id} href={`/rehearsals/${r.id}`} onClick={onClose} className="row" style={{ gap: 12, padding: "12px 18px", borderBottom: "1px solid var(--line)", textDecoration: "none" }}>
          <span className="mono" style={{ fontSize: 13 }}>{r.name} · V{r.version}</span>
          <span className="mono muted" style={{ fontSize: 11, marginLeft: "auto" }}>{r.status}{r.risk != null ? ` · ${r.risk}` : ""}</span>
        </Link>
      ))}
      {data && data.length === 0 && <div className="state-box muted">Nothing yet.</div>}
    </div>
  );
}

function CommandPalette() {
  const { paletteOpen, setPaletteOpen, toggleDark } = useShell();
  const router = useRouter();
  const { data } = useApi<RehearsalSummary[]>(paletteOpen ? "/api/rehearsals?limit=50" : null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(!paletteOpen);
      }
      if (e.key === "Escape") setPaletteOpen(false);
      const t = e.target as HTMLElement;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (!typing && !paletteOpen && e.key.toLowerCase() === "n" && !e.metaKey && !e.ctrlKey) router.push("/rehearsals/new");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen, setPaletteOpen, router]);

  if (!paletteOpen) return null;
  const go = (href: string) => {
    setPaletteOpen(false);
    router.push(href);
  };
  return (
    <div className="cmdk-overlay" onClick={() => setPaletteOpen(false)}>
      <div className="cmdk-box" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Command palette">
        <Command label="Command palette">
          <Command.Input autoFocus placeholder="Type a command or search…" style={{ fontFamily: "'Instrument Serif',serif", fontSize: 22 }} />
          <Command.List>
            <Command.Empty>No results.</Command.Empty>
            <Command.Group heading="Actions">
              <Command.Item onSelect={() => go("/rehearsals/new")}>＋ New rehearsal <span className="kbd" style={{ marginLeft: "auto" }}>N</span></Command.Item>
              <Command.Item onSelect={() => go("/approvals")}>✓ Pending approvals</Command.Item>
              <Command.Item onSelect={() => { toggleDark(); setPaletteOpen(false); }}>◐ Toggle dark mode</Command.Item>
            </Command.Group>
            <Command.Group heading="Go to">
              {NAV.map((n) => (
                <Command.Item key={n.href} onSelect={() => go(n.href)}>{n.label}</Command.Item>
              ))}
            </Command.Group>
            {data && data.length > 0 && (
              <Command.Group heading="Rehearsals">
                {data.map((r) => (
                  <Command.Item key={r.id} value={`${r.name} v${r.version} ${r.status}`} onSelect={() => go(`/rehearsals/${r.id}/report`)}>
                    <span className="mono">{r.name}</span>
                    <span className="mono muted" style={{ fontSize: 11.5 }}>V{r.version} · {r.status}{r.risk != null ? ` · risk ${r.risk}` : ""}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
          </Command.List>
        </Command>
        <div className="row" style={{ gap: 18, padding: "12px 18px", borderTop: "1px solid var(--line)", font: "400 12px/1 'Manrope',sans-serif", color: "var(--text2)" }}>
          <span><span className="kbd">↑</span> <span className="kbd">↓</span> move</span>
          <span><span className="kbd">↵</span> open</span>
          <span style={{ marginLeft: "auto" }}>Production actions are never in the palette.</span>
        </div>
      </div>
    </div>
  );
}

/** The design's signature cursor trail: small ✦ sparks that drift and fade. */
function useSparkles() {
  type Spark = { id: number; x: number; y: number; t: number; s: number; c: string; dx: number; dy: number };
  const [, force] = useState(0);
  const sp = useRef<Spark[]>([]);
  const sid = useRef(0);
  const last = useRef(0);
  const raf = useRef(0);
  const reduce = useRef(false);

  useEffect(() => {
    reduce.current = !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const loop = () => {
      const now = performance.now();
      if (sp.current.length) {
        sp.current = sp.current.filter((s) => now - s.t < 900);
        force((n) => n + 1);
      }
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, []);

  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    if (reduce.current) return;
    const now = performance.now();
    if (now - last.current < 40) return;
    last.current = now;
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    for (let i = 0; i < 2; i++)
      sp.current.push({
        id: sid.current++,
        x: x + (Math.random() * 34 - 17),
        y: y + (Math.random() * 34 - 17),
        t: now,
        s: 9 + Math.random() * 13,
        c: Math.random() < 0.55 ? "#E8458F" : "#F49AC4",
        dy: 10 + Math.random() * 26,
        dx: Math.random() * 16 - 8,
      });
    if (sp.current.length > 50) sp.current.splice(0, sp.current.length - 50);
  };

  const now = typeof performance !== "undefined" ? performance.now() : 0;
  const nodes = sp.current.map((p) => {
    const a = Math.min(1, (now - p.t) / 900);
    return (
      <span
        key={p.id}
        className="spk"
        aria-hidden="true"
        style={{ left: p.x + p.dx * a, top: p.y + p.dy * a, fontSize: p.s * (1 - a * 0.5), color: p.c, opacity: 1 - a }}
      >
        ✦
      </span>
    );
  });
  return { onMove, onLeave: () => undefined, nodes };
}
