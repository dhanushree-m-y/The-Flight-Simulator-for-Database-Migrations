"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { fmtTime } from "@/lib/format";
import type { LogLine } from "@/lib/types";

type Filter = "all" | "warn" | "error";
const TAIL = 12; // collapsed view: the newest 12 lines, oldest six on the left, newest six on the right

const pad = (s: string, n: number) => (s.length >= n ? `${s} ` : s.padEnd(n + 1));

function Line({ l }: { l: LogLine }) {
  const text = `${fmtTime(l.ts)}  ${l.level.toUpperCase().padEnd(5)} ${l.source}  ${l.message}`;
  return (
    <div className="lv-log-line" title={text}>
      <span className="t">{fmtTime(l.ts)}</span>
      {"  "}
      {l.level === "error" && (
        <>
          <span className="e">ERROR</span>{" "}
        </>
      )}
      {l.level === "warn" && (
        <>
          <span className="w">WARN</span>
          {"  "}
        </>
      )}
      {l.level === "ai" ? <span className="a">{pad(l.source, 18)}</span> : pad(l.source, l.level === "info" ? 18 : 0)}
      {l.message}
    </div>
  );
}

export function LiveLog({ logs, live, connected }: { logs: LogLine[]; live: boolean; connected: boolean }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return logs.filter((l) => {
      if (filter === "warn" && l.level !== "warn" && l.level !== "error") return false;
      if (filter === "error" && l.level !== "error") return false;
      if (!needle) return true;
      return `${l.source} ${l.message}`.toLowerCase().includes(needle);
    });
  }, [logs, filter, q]);

  // "/" focuses the log search (unless the user is already typing somewhere)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // expanded view auto-scrolls to the newest line unless the reader scrolled up
  useEffect(() => {
    const el = scrollRef.current;
    if (expanded && el && stick.current) el.scrollTop = el.scrollHeight;
  }, [shown.length, expanded]);

  const copy = async () => {
    const text = shown.map((l) => `${fmtTime(l.ts)}  ${l.level.toUpperCase().padEnd(5)} ${l.source}  ${l.message}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`Copied ${shown.length} log line${shown.length === 1 ? "" : "s"}`);
    } catch {
      toast.error("Clipboard is unavailable in this browser");
    }
  };

  const tail = shown.slice(-TAIL);
  const half = Math.ceil(tail.length / 2);
  const counts = { warn: logs.filter((l) => l.level === "warn").length, error: logs.filter((l) => l.level === "error").length };

  return (
    <section className="console" style={{ padding: "12px 18px" }} aria-label="Live log">
      <div className="row" style={{ gap: 12, paddingBottom: 8, borderBottom: "1px solid rgba(255,255,255,.08)", flexWrap: "wrap" }}>
        <span style={{ font: "500 10.5px/1 'DM Mono',monospace", letterSpacing: ".16em", color: "#A897AC" }}>
          {live ? "LIVE LOG" : "LOG"}
        </span>
        {live && (
          <span className="row mono" style={{ gap: 6, fontSize: 10.5, color: connected ? "#BFD9B5" : "#FFC2A1" }} role="status">
            <span className={`dot${connected ? " breathe" : ""}`} style={{ width: 6, height: 6 }} />
            {connected ? "streaming" : "reconnecting…"}
          </span>
        )}
        <span className="row" role="group" aria-label="Filter log by level" style={{ gap: 2, font: "400 11.5px/1 'DM Mono',monospace", color: "#A897AC" }}>
          {(["all", "warn", "error"] as Filter[]).map((f, i) => (
            <span key={f} className="row" style={{ gap: 2 }}>
              {i > 0 && <span aria-hidden="true">·</span>}
              <button type="button" className="lv-filter" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f}
                {f !== "all" && counts[f] > 0 ? ` ${counts[f]}` : ""}
              </button>
            </span>
          ))}
        </span>
        <input
          ref={searchRef}
          className="lv-search"
          style={{ marginLeft: "auto" }}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && (setQ(""), e.currentTarget.blur())}
          placeholder="/ search log"
          aria-label="Search log"
        />
        <button type="button" className="btn btn-sm lv-console-btn" onClick={copy} disabled={!shown.length}>
          Copy
        </button>
        <button type="button" className="btn btn-sm lv-console-btn" aria-expanded={expanded} aria-controls="lv-log-body" onClick={() => setExpanded((x) => !x)}>
          {expanded ? "Collapse" : "Expand"}
        </button>
      </div>
      <div id="lv-log-body" role="log" aria-live="off" aria-label={`${shown.length} log lines`}>
        {shown.length === 0 ? (
          <div style={{ padding: "14px 0 6px", color: "#A897AC" }}>
            {logs.length === 0 ? (live ? "waiting for the agent’s first line…" : "no log lines recorded") : "no lines match this filter"}
          </div>
        ) : expanded ? (
          <div
            ref={scrollRef}
            className="lv-log-expanded"
            tabIndex={0}
            onScroll={(e) => {
              const el = e.currentTarget;
              stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
            }}
          >
            {shown.map((l, i) => (
              <Line key={i} l={l} />
            ))}
          </div>
        ) : (
          <div className="lv-log-lines">
            <div>
              {tail.slice(0, half).map((l, i) => (
                <Line key={`${l.ts}-${i}`} l={l} />
              ))}
            </div>
            <div>
              {tail.slice(half).map((l, i) => (
                <Line key={`${l.ts}-${half + i}`} l={l} />
              ))}
            </div>
          </div>
        )}
        {!expanded && shown.length > TAIL && (
          <button type="button" className="lv-filter" style={{ marginTop: 6 }} onClick={() => setExpanded(true)}>
            + {shown.length - TAIL} earlier lines
          </button>
        )}
      </div>
    </section>
  );
}
