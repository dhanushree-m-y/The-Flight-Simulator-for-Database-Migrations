"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { TopBar } from "@/components/shell/AppShell";
import { api, useApi } from "@/lib/api";
import { fmtTime, riskBand } from "@/lib/format";
import type { Integration, RehearsalSummary } from "@/lib/types";
import { BrandMark } from "@/components/icons";
import { EmptyState, FailState, LoadState, PageHead } from "@/components/admin/kit";

const ORDER: Integration["key"][] = ["truefoundry", "llm", "sandbox", "schedule", "aws", "github", "slack"];

const COPY: Record<Integration["key"], { title: string; body: string }> = {
  truefoundry: {
    title: "TrueForge",
    body: "The agent harness. Every rehearsal is a TrueForge session: the agent calls DryRun's MCP tools, spawns sub-agents, asks the engineer when intent is unclear, and pauses on the approval-gated production tools.",
  },
  llm: {
    title: "LLM · TrueForge",
    body: "The team's OpenAI model, configured once in TrueForge → Settings → Models. It writes read-only checks, plain-language verdicts and fix proposals; it never writes to production.",
  },
  github: {
    title: "GitHub",
    body: "Posts the rehearsal report as a comment on the pull request that contains the migration (set GITHUB_TOKEN, GITHUB_REPO and the PR number on the rehearsal).",
  },
  slack: {
    title: "Slack",
    body: "Posts rehearsal verdicts and approval requests to a channel. Approving still happens in DryRun with the typed database name.",
  },
  sandbox: {
    title: "TrueForge sandbox · Daytona",
    body: "Isolated compute for code the agent generates (Code Mode). Enabled automatically once a Daytona provider is added in TrueForge; migrations themselves always run in a throwaway database clone.",
  },
  schedule: {
    title: "Nightly drift check",
    body: "A TrueForge schedule wakes the agent every night to re-rehearse approved-but-unapplied migrations against that day's data, because yesterday's safe verdict can go stale.",
  },
  aws: {
    title: "AWS S3 backups",
    body: "Every backup taken before a production apply is also copied to an encrypted S3 bucket, so a restore never depends on this machine.",
  },
};

function Chip({ i }: { i: Integration }) {
  if (!i.connected) return <span className="st st-info">○ not connected</span>;
  return <span className="st st-safe">✓ {i.key === "truefoundry" ? "healthy" : "connected"}</span>;
}

const verdict = (r: RehearsalSummary) => {
  if (r.status === "blocked" || riskBand(r.risk) === "block") return { gh: "BLOCKED", color: "#CF222E", glyph: "✕", word: "BLOCKED", bar: "#A8234F" };
  if (r.status === "warning" || riskBand(r.risk) === "review") return { gh: "NEEDS REVIEW", color: "#9A6700", glyph: "●", word: "REVIEW", bar: "#C56F45" };
  return { gh: "PASSED", color: "#1A7F37", glyph: "✓", word: "SAFE", bar: "#47705A" };
};

export default function IntegrationsPage() {
  const { data, error, loading, reload } = useApi<Integration[]>("/api/integrations", { pollMs: 60000 });
  const recent = useApi<RehearsalSummary[]>("/api/rehearsals?limit=10");
  const sample = (recent.data ?? []).find((r) => r.status !== "queued" && r.status !== "running" && r.risk != null) ?? null;

  const list = [...(data ?? [])].sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
  const connected = list.filter((i) => i.connected).length;

  return (
    <div className="pg-integrations page">
      <TopBar crumbs={["Integrations"]} />
      <PageHead eyebrow={data ? `Integrations · ${connected} of ${list.length} connected` : "Integrations"} title="Where migrations come from, and where the evidence goes." />

      {loading && !data ? (
        <LoadState title="Checking integrations…" steps={["Pinging the TrueForge agent harness", "Checking the model provider", "Checking GitHub and Slack"]} />
      ) : error && !data ? (
        <FailState title="Couldn’t load integrations." error={error} onRetry={reload} />
      ) : list.length === 0 ? (
        <EmptyState eyebrow="Empty" title="No integrations reported." body="The DryRun API didn’t report any integrations. Check the API configuration." />
      ) : (
        <div className="cards">
          {list.map((i) => (
            <Card key={i.key} i={i} sample={sample} />
          ))}
        </div>
      )}

      <HowTrueForge />
    </div>
  );
}

function Card({ i, sample }: { i: Integration; sample: RehearsalSummary | null }) {
  const c = COPY[i.key] ?? { title: i.name, body: "" };
  const tf = i.key === "truefoundry";
  let extra: ReactNode = null;

  if (tf)
    extra = (
      <>
        <div className="kv"><span>Environment status</span>{i.connected ? <span className="row" style={{ gap: 6, color: "#47705A" }}><span className="dot breathe" aria-hidden="true" />operational</span> : <span style={{ color: "#A8234F" }}>unreachable</span>}</div>
        <div className="kv"><span>Rehearsal sandbox</span><span>throwaway database clone</span></div>
        <div className="kv"><span>Lifetime</span><span>auto-deleted after 45 min</span></div>
        <div className="kv"><span>Route to production</span><span style={{ color: "#47705A" }}>✓ none · only via approval</span></div>
      </>
    );
  if (i.key === "schedule")
    extra = (
      <>
        <div className="kv"><span>Schedule</span><span>{i.detail}</span></div>
        <DriftNow />
      </>
    );
  if (i.key === "llm")
    extra = (
      <>
        <div className="kv"><span>Used for</span><span>AI checks · summaries · fixes</span></div>
        <div className="kv"><span>Sees</span><span>schema · check evidence</span></div>
        <div className="kv"><span>Can apply to production</span><span style={{ color: "#47705A" }}>✓ never</span></div>
      </>
    );
  if (i.key === "github") {
    const v = sample ? verdict(sample) : null;
    extra = (
      <>
        <span className="eyebrow" style={{ paddingTop: 6 }}>Preview · pull request check{sample ? ` · ${sample.name}` : ""}</span>
        {sample && v ? (
          <div className="pv">
            <div style={{ padding: "12px 14px", borderBottom: "1px solid rgba(38,31,41,.12)", display: "flex", gap: 8, alignItems: "center", fontWeight: 600 }}>
              <span style={{ color: v.color }} aria-hidden="true">{v.glyph}</span>DryRun Migration Safety
              <span style={{ marginLeft: "auto", fontWeight: 400, color: "#57606A", fontSize: 12 }}>Required</span>
            </div>
            <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
              <div><b style={{ color: v.color }}>{v.gh}</b> · Risk <b>{sample.risk}</b></div>
              {sample.headline && <div>{sample.headline}</div>}
              <Link href={`/rehearsals/${sample.id}/report`} style={{ color: "#0969DA" }}>View evidence →</Link>
            </div>
          </div>
        ) : (
          <PreviewEmpty />
        )}
      </>
    );
  }
  if (i.key === "slack") {
    const v = sample ? verdict(sample) : null;
    extra = (
      <>
        <span className="eyebrow" style={{ paddingTop: 6 }}>Preview · message</span>
        {sample && v ? (
          <div className="pv" style={{ padding: 14, display: "grid", gridTemplateColumns: "36px minmax(0,1fr)", gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: "#FFD7E5", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <BrandMark size={22} />
            </div>
            <div className="col" style={{ gap: 6, minWidth: 0 }}>
              <div>
                <b>DryRun</b> <span style={{ fontSize: 11, background: "#EEE", padding: "1px 4px", borderRadius: 3, color: "#555" }}>APP</span>{" "}
                <span style={{ color: "#777", fontSize: 12 }}>{fmtTime(sample.finished_at ?? sample.created_at).slice(0, 5)}</span>
              </div>
              <div><b>{sample.approval_status === "pending" ? "Migration awaiting approval" : "Rehearsal finished"}</b></div>
              <div style={{ borderLeft: `4px solid ${v.bar}`, paddingLeft: 10, display: "flex", flexDirection: "column", gap: 2, fontSize: 13, minWidth: 0 }}>
                <span style={{ fontFamily: "'DM Mono',monospace", overflowWrap: "anywhere" }}>{sample.name} · V{sample.version}</span>
                <span>Risk: <b>{sample.risk} — {v.word}</b></span>
                <span>Database: <b>{sample.connection_name}</b></span>
              </div>
              <div className="row" style={{ gap: 6, paddingTop: 4, flexWrap: "wrap" }} aria-hidden="true">
                <span style={{ border: "1px solid #BBB", borderRadius: 5, padding: "4px 10px", fontSize: 13, fontWeight: 600 }}>Review</span>
                {sample.approval_status === "pending" && (
                  <>
                    <span style={{ background: "#47705A", color: "#FFF", borderRadius: 5, padding: "4px 10px", fontSize: 13, fontWeight: 600 }}>Approve</span>
                    <span style={{ border: "1px solid #BBB", borderRadius: 5, padding: "4px 10px", fontSize: 13, fontWeight: 600, color: "#A8234F" }}>Reject</span>
                  </>
                )}
              </div>
            </div>
          </div>
        ) : (
          <PreviewEmpty />
        )}
      </>
    );
  }

  return (
    <section className="glass ig" style={tf ? { border: "1px dashed rgba(71,112,90,.45)" } : undefined} aria-label={c.title}>
      <div className="row" style={{ justifyContent: "space-between", gap: 10 }}>
        <span className="h2" style={{ fontSize: 26 }}>{c.title}</span>
        <Chip i={i} />
      </div>
      <span style={{ font: "400 13.5px/1.5 'Manrope',sans-serif", color: "var(--text2)" }}>{c.body}</span>
      <div className="kv"><span>{i.connected ? "Connection" : "Status"}</span><span style={{ textAlign: "right", overflowWrap: "anywhere" }}>{i.detail}</span></div>
      {extra}
      {!i.connected && (
        <span className="mono muted" style={{ fontSize: 11.5 }}>Configure it in the DryRun API environment, then reload this page.</span>
      )}
    </section>
  );
}

const PreviewEmpty = () => (
  <div className="pv" style={{ padding: 14, color: "#57606A", fontSize: 13 }}>
    Run a rehearsal to see what this looks like with your own data.
  </div>
);

function HowTrueForge() {
  const steps = [
    { n: "01", c: "#B8386E", t: "Agent spec", d: "DryRun is a TrueForge agent: model, instructions and tools in one versioned spec, so every rehearsal traces back to a session you can open." },
    { n: "02", c: "#6A4FB8", t: "MCP tools", d: "Rehearsing, reading evidence, proposing fixes and applying are MCP tools. The agent can only do what a tool allows — nothing else." },
    { n: "03", c: "#A8234F", t: "Approval gate", d: "apply_to_production is a gated tool. TrueForge pauses the session at that call until an approver types the database name on the approval page." },
    { n: "04", c: "#47705A", t: "Sandboxed rehearsal", d: "Every rehearsal runs on a fresh TrueForge sandbox copy with no route to production, and the sandbox is destroyed afterwards." },
  ];
  const flow = ["PR / engineer", "TrueForge agent session", "MCP tools", "sandbox rehearsal", "evidence report"];
  return (
    <section className="glass col" style={{ padding: "24px 26px", gap: 20 }} aria-labelledby="tf-how">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div className="col" style={{ gap: 8 }}>
          <span className="eyebrow">Under the hood</span>
          <h2 id="tf-how" className="h2" style={{ margin: 0 }}>How DryRun uses TrueForge</h2>
        </div>
        <span className="mono muted" style={{ fontSize: 11.5 }}>agent harness · model provider · sandboxes</span>
      </div>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", font: "500 12px/1 'DM Mono',monospace" }} aria-label="Flow: PR or engineer, TrueForge agent session, MCP tools, sandbox rehearsal, evidence report, approval gate, apply_to_production">
        {flow.map((f) => (
          <span key={f} className="row" style={{ gap: 8 }}>
            <span style={{ padding: "8px 10px", borderRadius: 8, background: "#FFFFFF", border: "1px solid var(--line)" }}>{f}</span>
            <span className="muted" aria-hidden="true">→</span>
          </span>
        ))}
        <span style={{ padding: "8px 10px", borderRadius: 8, background: "#FFF4EA", border: "1px dashed #C56F45", color: "#A3552F" }}>⏸ approval gate</span>
        <span className="muted" aria-hidden="true">→</span>
        <span className="env env-prod" style={{ height: 30 }}>⛨ apply_to_production</span>
      </div>
      <ol className="how" style={{ margin: 0, padding: 0 }}>
        {steps.map((s) => (
          <li key={s.n}>
            <b style={{ color: s.c }}>{s.n}</b>
            <span className="h3">{s.t}</span>
            <span style={{ font: "400 13px/1.55 'Manrope',sans-serif", color: "var(--text2)" }}>{s.d}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}


/** Trigger the TrueForge schedule now (background execution) instead of waiting for 02:30. */
function DriftNow() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-sm btn-ai"
      style={{ alignSelf: "flex-start", marginTop: 8 }}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api("/api/trueforge/drift-check", { method: "POST" });
          toast.success("Drift check started in TrueForge — new rehearsal versions will appear in Rehearsals");
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Could not start the drift check");
        } finally {
          setBusy(false);
        }
      }}
    >
      ▶ Run drift check now
    </button>
  );
}
