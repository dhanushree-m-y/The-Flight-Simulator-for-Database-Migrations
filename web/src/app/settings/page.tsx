"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { TopBar } from "@/components/shell/AppShell";
import { useShell } from "@/components/shell/ShellContext";
import { useApi } from "@/lib/api";
import type { Integration, Role, User } from "@/lib/types";
import { FailState, LoadState, ROLE_AVATAR, ROLE_CAN, RoleChip } from "@/components/admin/kit";

const SECTIONS = [
  { id: "team", label: "Team & roles" },
  { id: "permissions", label: "Permissions" },
  { id: "sandbox", label: "Sandbox defaults" },
  { id: "notifications", label: "Notifications" },
];

const ROLES: Role[] = ["viewer", "engineer", "approver", "admin"];
const MATRIX: { label: string; roles: Role[]; prod?: boolean }[] = [
  { label: "Inspect rehearsals, reports, audit", roles: ["viewer", "engineer", "approver", "admin"] },
  { label: "Create & re-run rehearsals", roles: ["engineer", "approver", "admin"] },
  { label: "Generate & rehearse AI fixes", roles: ["engineer", "approver", "admin"] },
  { label: "Connect & test databases", roles: ["engineer", "approver", "admin"] },
  { label: "Change safety policies", roles: ["admin"] },
  { label: "⛨ Approve / reject production", roles: ["approver", "admin"], prod: true },
  { label: "⛨ Execute & restore production", roles: ["approver", "admin"], prod: true },
];

type Prefs = { approvals: boolean; blocked: boolean; prod: boolean; digest: boolean; slack: boolean };
const PREF_KEY = "dryrun.notify";
const DEFAULT_PREFS: Prefs = { approvals: true, blocked: true, prod: true, digest: false, slack: false };
const PREF_ROWS: { key: keyof Prefs; label: string; hint: string }[] = [
  { key: "approvals", label: "Approval requested", hint: "When a change is waiting on someone with your role" },
  { key: "blocked", label: "Rehearsal blocked", hint: "When a migration you ran is blocked or needs review" },
  { key: "prod", label: "Production runs", hint: "Apply started, succeeded, failed or restored" },
  { key: "digest", label: "Weekly digest", hint: "Rehearsals, blocks and rows protected, every Monday" },
  { key: "slack", label: "Also send to Slack", hint: "Uses the Slack integration when it’s connected" },
];

export default function SettingsPage() {
  const { me, switchUser } = useShell();
  const users = useApi<User[]>("/api/users");
  const integ = useApi<Integration[]>("/api/integrations");
  const [active, setActive] = useState("team");
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREF_KEY);
      if (raw) setPrefs({ ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) });
    } catch {
      /* storage unavailable — defaults */
    }
  }, []);

  // Highlight the section in view.
  useEffect(() => {
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter(Boolean) as HTMLElement[];
    if (!els.length || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (vis) setActive(vis.target.id);
      },
      { rootMargin: "-10% 0px -60% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [users.data]);

  const setPref = (k: keyof Prefs) => {
    const next = { ...prefs, [k]: !prefs[k] };
    setPrefs(next);
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(next));
      toast("Notification preference saved in this browser");
    } catch {
      toast.error("Couldn’t save — browser storage is unavailable");
    }
  };

  const list = useMemo(() => [...(users.data ?? [])].sort((a, b) => ROLES.indexOf(b.role) - ROLES.indexOf(a.role) || a.name.localeCompare(b.name)), [users.data]);
  const approvers = list.filter((u) => u.role === "approver" || u.role === "admin").length;
  const tf = integ.data?.find((i) => i.key === "truefoundry");
  const slack = integ.data?.find((i) => i.key === "slack");

  return (
    <div className="pg-settings page">
      <TopBar crumbs={["Settings", SECTIONS.find((s) => s.id === active)?.label ?? "Team & roles"]} />
      <div className="adm-grid">
        <nav className="sn col" style={{ gap: 2 }} aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className={active === s.id ? "on" : undefined} aria-current={active === s.id ? "true" : undefined} onClick={() => setActive(s.id)}>
              {s.label}
            </a>
          ))}
        </nav>

        <div className="col" style={{ gap: 20, minWidth: 0 }}>
          <section id="team" className="col" style={{ gap: 20 }} aria-labelledby="st-team">
            <div className="col" style={{ gap: 10 }}>
              <span className="eyebrow">{users.data ? `${list.length} members · ${approvers} can approve production` : "Team & roles"}</span>
              <h1 id="st-team" className="h1" style={{ fontSize: 40, margin: 0 }}>Who can rehearse, approve and touch production.</h1>
            </div>
            <div className="glass row" style={{ gap: 10, padding: "12px 14px", flexWrap: "wrap" }}>
              {me ? (
                <>
                  <span className="av" style={{ background: ROLE_AVATAR[me.role].bg, color: ROLE_AVATAR[me.role].fg }}>{me.initials}</span>
                  <span style={{ font: "600 14px/1.3 'Manrope',sans-serif" }}>Signed in as {me.name}</span>
                  <RoleChip role={me.role} />
                </>
              ) : (
                <span className="muted">Resolving your identity…</span>
              )}
              <span className="mono muted" style={{ marginLeft: "auto", fontSize: 11.5 }}>role changes are audited · demo roles can be switched below</span>
            </div>

            {users.loading && !users.data ? (
              <LoadState title="Loading your team…" steps={["Fetching members", "Resolving roles"]} />
            ) : users.error && !users.data ? (
              <FailState title="Couldn’t load the team." error={users.error} onRetry={users.reload} />
            ) : (
              <div className="panel col" style={{ overflow: "hidden" }}>
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }} aria-label="Team members">
                  {list.map((u, i) => {
                    const you = u.id === me?.id;
                    return (
                      <li key={u.id} className="mb" style={i === list.length - 1 ? { border: 0 } : undefined}>
                        <div className="row" style={{ gap: 12, minWidth: 0 }}>
                          <span className="av" style={{ background: ROLE_AVATAR[u.role].bg, color: ROLE_AVATAR[u.role].fg, flexShrink: 0 }} aria-hidden="true">{u.initials}</span>
                          <div className="col" style={{ gap: 2, minWidth: 0 }}>
                            <span className="h3" style={{ fontSize: 14.5 }}>{u.name}{you ? " · you" : ""}</span>
                            <span className="mono muted" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.email}</span>
                          </div>
                        </div>
                        <RoleChip role={u.role} />
                        <span className="muted c-can" style={{ fontSize: 12.5 }}>{ROLE_CAN[u.role]}</span>
                        <span className="c-act" style={{ justifySelf: "end" }}>
                          <button type="button" className="btn btn-sm" disabled={you} onClick={() => switchUser(u.id)} aria-label={you ? "This is you" : `Act as ${u.name} (demo)`}>
                            {you ? "You" : "Act as"}
                          </button>
                        </span>
                      </li>
                    );
                  })}
                  {list.length === 0 && <li className="state-box muted">No members returned by the API.</li>}
                </ul>
              </div>
            )}
          </section>

          <section id="permissions" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 20 }} aria-label="Permissions by role">
            <div className="panel col" style={{ overflow: "hidden", gridColumn: "span 1" }}>
              <div className="rm" style={{ font: "500 10.5px/1 'DM Mono',monospace", letterSpacing: ".14em", color: "var(--text2)" }}>
                <span>PERMISSION</span>
                {ROLES.map((r) => (
                  <span key={r} className={me?.role === r ? "me" : undefined} style={{ font: "500 10px/1 'DM Mono',monospace", letterSpacing: ".1em" }}>
                    {r.toUpperCase()}
                  </span>
                ))}
              </div>
              {MATRIX.map((m, i) => (
                <div key={m.label} className="rm" style={{ ...(m.prod ? { background: "#FBF3F6" } : {}), ...(i === MATRIX.length - 1 ? { border: 0 } : {}), color: m.prod ? "#261F29" : undefined }}>
                  <span>{m.label}</span>
                  {ROLES.map((r) => {
                    const ok = m.roles.includes(r);
                    return (
                      <span key={r} className={`${ok ? "y" : "n"}${me?.role === r ? " me" : ""}`} aria-label={`${r}: ${ok ? "allowed" : "not allowed"}`}>
                        {ok ? (m.prod ? "✓ *" : "✓") : "✕"}
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="col" style={{ gap: 20 }}>
              <div className="glass col" style={{ padding: "18px 20px", gap: 10 }}>
                <span className="eyebrow">* Separation of duties</span>
                <span style={{ font: "400 13.5px/1.55 'Manrope',sans-serif" }}>
                  An approver can never approve their own request. With {approvers >= 2 ? `${approvers} people who can approve` : "two approvers"}, every production change has an independent reviewer.
                </span>
                <div className="kv"><span>Policy SOD-1</span><span style={{ color: "#47705A" }}>✓ enforced server-side</span></div>
                <div className="kv"><span>Step-up on approve</span><span>typed database name</span></div>
                <div className="kv"><span>Approval releases</span><span>TrueForge apply_to_production</span></div>
              </div>
              <div className="glass col" style={{ padding: "18px 20px", gap: 8 }}>
                <span className="eyebrow">What each role is for</span>
                {ROLES.map((r) => (
                  <div key={r} className="row" style={{ gap: 10, padding: "6px 0", borderBottom: r === "admin" ? 0 : "1px solid var(--line)" }}>
                    <span style={{ width: 118, flexShrink: 0 }}><RoleChip role={r} /></span>
                    <span style={{ font: "400 13px/1.4 'Manrope',sans-serif" }}>{ROLE_CAN[r]}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section id="sandbox" className="glass col" style={{ padding: "20px 22px", gap: 10 }} aria-labelledby="st-sb">
            <div className="row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <h2 id="st-sb" className="h2" style={{ fontSize: 26, margin: 0 }}>Sandbox defaults</h2>
              <span className="st st-info">read-only · set in API config</span>
            </div>
            <span style={{ font: "400 13.5px/1.5 'Manrope',sans-serif", color: "var(--text2)" }}>
              Every rehearsal runs in a fresh sandbox on TrueForge. These defaults come from the DryRun API configuration and can’t be changed from the browser.
            </span>
            <div className="kv"><span>Provider</span><span style={{ textAlign: "right", overflowWrap: "anywhere" }}>TrueForge sandboxes{tf ? ` · ${tf.detail}` : ""}</span></div>
            <div className="kv"><span>Status</span>{integ.loading && !integ.data ? <span className="muted">checking…</span> : tf?.connected ? <span className="row" style={{ gap: 6, color: "#47705A" }}><span className="dot breathe" aria-hidden="true" />operational</span> : <span style={{ color: "#A8234F" }}>not connected</span>}</div>
            <div className="kv"><span>Isolation</span><span>own network · no egress</span></div>
            <div className="kv"><span>Source data</span><span>read-only login → sandbox copy</span></div>
            <div className="kv"><span>Lifetime</span><span>destroyed after each rehearsal</span></div>
            <div className="kv"><span>Route to production</span><span style={{ color: "#47705A" }}>✓ none · only via approvals</span></div>
          </section>

          <section id="notifications" className="glass col" style={{ padding: "20px 22px", gap: 6 }} aria-labelledby="st-nt">
            <div className="row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <h2 id="st-nt" className="h2" style={{ fontSize: 26, margin: 0 }}>Notifications</h2>
              <span className="mono muted" style={{ fontSize: 11.5 }}>saved in this browser only</span>
            </div>
            {PREF_ROWS.map((p) => {
              const disabled = p.key === "slack" && !slack?.connected;
              return (
                <div key={p.key} className="np">
                  <div className="col" style={{ gap: 3 }}>
                    <span id={`np-${p.key}`}>{p.label}</span>
                    <span className="muted" style={{ font: "400 12px/1.4 'Manrope',sans-serif" }}>{disabled ? "Connect Slack on the Integrations page first" : p.hint}</span>
                  </div>
                  <button type="button" role="switch" className="tg" aria-checked={prefs[p.key] && !disabled} aria-labelledby={`np-${p.key}`} disabled={disabled} onClick={() => setPref(p.key)} />
                </div>
              );
            })}
          </section>
        </div>
      </div>
    </div>
  );
}
