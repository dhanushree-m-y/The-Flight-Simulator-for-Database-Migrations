"use client";

import Link from "next/link";
import { TopBar } from "@/components/shell/AppShell";
import { Skeleton } from "@/components/ui";
import { isLive, useCountUp } from "@/components/rehearsals/util";
import { useApi } from "@/lib/api";
import { fmtInt, pad2 } from "@/lib/format";
import type { Overview } from "@/lib/types";
import "@/components/rehearsals/screens.css";

const TWINKLES: { x: number; y: number; s: number; d: string }[] = [
  { x: 30, y: 58, s: 16, d: "0s" },
  { x: 80, y: 42, s: 11, d: ".4s" },
  { x: 135, y: 36, s: 18, d: ".8s" },
  { x: 186, y: 48, s: 10, d: "1.2s" },
  { x: 228, y: 74, s: 14, d: ".2s" },
  { x: 262, y: 112, s: 9, d: "1s" },
];

export default function WelcomePage() {
  const ov = useApi<Overview>("/api/overview");
  const k = ov.data?.kpis;
  const p = useCountUp(!!k);
  const sample = ov.data?.recent.find((r) => !isLive(r.status)) ?? null;

  const stats: { value: string | null; label: string }[] = [
    { value: k ? fmtInt(Math.round(k.rows_protected * p)) : null, label: "rows protected this week" },
    { value: k ? pad2(Math.round(k.blocked * p)) : null, label: "migrations stopped before prod" },
    { value: k ? pad2(Math.round(k.rehearsals * p)) : null, label: "rehearsals run this week" },
    { value: "0", label: "writes to production during rehearsal" },
  ];

  return (
    <>
      <TopBar crumbs={["Welcome"]} env={{ kind: "org" }} />
      <div className="pg-welcome page">
        <section className="bloom wl-hero" aria-labelledby="wl-title">
          <div className="dots" aria-hidden="true" />
          <div className="dots2" aria-hidden="true" />
          <div className="cols" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>

          <nav className="row nav wl-nav" style={{ gap: 18, position: "relative" }} aria-label="Welcome">
            <span className="b-small">DryRun</span>
            <span className="b-small" style={{ opacity: 0.85 }}>rehearses every migration</span>
            <span className="b-small" style={{ opacity: 0.85 }}>Mysuru · Bengaluru</span>
            <Link href="/rehearsals" className="b-small" style={{ marginLeft: "auto" }}>
              Rehearsals
            </Link>
            <Link href="/databases" className="b-small">
              Databases
            </Link>
          </nav>

          <div className="col" style={{ gap: 26, maxWidth: 1100, position: "relative", margin: "auto 0", padding: "64px 0 48px" }}>
            <span className="b-rule" />
            <h1 id="wl-title" className="b-head wl-head" style={{ margin: 0 }}>
              Welcome to DryRun.
            </h1>
            <span style={{ font: "400 italic 30px/1.25 'Manrope',sans-serif", maxWidth: 720, textShadow: "0 1px 12px rgba(120,20,60,.2)" }}>
              Nothing touches production until it survives here.
            </span>
            <div className="row" style={{ gap: 12, paddingTop: 10, flexWrap: "wrap" }}>
              <Link href="/rehearsals/new" className="btn btn-lg btn-spark" style={{ background: "#FFFFFF", color: "#B8386E", border: 0 }}>
                Start a rehearsal
              </Link>
              <Link
                href="/databases"
                className="btn btn-lg btn-spark"
                style={{ background: "rgba(255,255,255,.14)", color: "#FFFFFF", border: "1px solid rgba(255,255,255,.55)" }}
              >
                Connect a database
              </Link>
              {sample && (
                <Link
                  href={`/rehearsals/${sample.id}/report`}
                  className="b-small"
                  style={{ color: "#FFF7F2", alignSelf: "center", marginLeft: 8, textUnderlineOffset: 4 }}
                >
                  or see a sample report →
                </Link>
              )}
            </div>
          </div>

          {/* decorative flower with sparkle arc */}
          <div className="float wl-flower" aria-hidden="true">
            <svg width="420" height="260" viewBox="0 0 420 260" style={{ position: "absolute", inset: 0 }}>
              <path d="M10 60 C120 20 220 40 300 170" fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="1" strokeDasharray="2 7" />
              <g fill="#FFFFFF">
                {TWINKLES.map((t) => (
                  <text key={`${t.x}-${t.y}`} x={t.x} y={t.y} fontSize={t.s} className="twinkle" style={{ animationDelay: t.d }}>
                    ✦
                  </text>
                ))}
                <circle cx="110" cy="52" r="2.5" className="twinkle" />
                <circle cx="206" cy="60" r="2" className="twinkle" style={{ animationDelay: ".6s" }} />
              </g>
            </svg>
            <div style={{ position: "absolute", left: 258, top: 130, filter: "drop-shadow(0 0 22px rgba(255,255,255,.55))" }}>
              <svg width="120" height="120" viewBox="-23 -23 46 46">
                {[0, 72, 144, 216, 288].map((r, i) => (
                  <g key={r} transform={`rotate(${r})`}>
                    <ellipse className="petal" cx="0" cy="-10" rx="7.5" ry="10.5" fill="#FFFFFF" style={{ animationDelay: `${0.1 + i * 0.15}s` }} />
                  </g>
                ))}
                <circle r="6" fill="#FFD7E5" />
                <circle r="3" fill="#F0507A" />
              </svg>
            </div>
          </div>

          {/* hero data strip — live numbers from /api/overview */}
          <div className="wl-strip" style={{ position: "relative", paddingBottom: 40 }} aria-live="polite">
            {stats.map((s) => (
              <div key={s.label} className="col" style={{ gap: 6 }}>
                {s.value == null ? (
                  ov.error ? (
                    <span className="num tab" style={{ fontSize: 44, color: "#FFFFFF", opacity: 0.6 }} title="Couldn’t reach the DryRun API">
                      —
                    </span>
                  ) : (
                    <Skeleton h={44} w={120} style={{ background: "rgba(255,255,255,.25)" }} />
                  )
                ) : (
                  <span className="num tab" style={{ fontSize: 44, color: "#FFFFFF" }}>{s.value}</span>
                )}
                <span className="b-small" style={{ opacity: 0.9 }}>{s.label}</span>
              </div>
            ))}
          </div>

          <div className="row" style={{ position: "relative" }}>
            <Link href="/policies" className="b-small" style={{ color: "#FFF7F2", textDecoration: "none" }}>
              Security &amp; policies
            </Link>
            <div
              style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", width: 26, height: 40, border: "1.5px solid rgba(255,255,255,.8)", borderRadius: 13 }}
              aria-hidden="true"
            >
              <span className="float" style={{ position: "absolute", left: 11, top: 8, width: 2, height: 8, borderRadius: 1, background: "#FFFFFF" }} />
            </div>
            <Link href="/audit" className="b-small" style={{ marginLeft: "auto", color: "#FFF7F2", textDecoration: "none" }}>
              Audit log
            </Link>
          </div>
          {ov.error && (
            <span className="b-small" role="status" style={{ position: "relative", opacity: 0.9, paddingTop: 12 }}>
              Live numbers unavailable — {ov.error.message}.{" "}
              <button type="button" onClick={ov.reload} style={{ background: "none", border: 0, color: "inherit", textDecoration: "underline", padding: 0, font: "inherit" }}>
                Retry
              </button>
            </span>
          )}
        </section>
      </div>
    </>
  );
}
