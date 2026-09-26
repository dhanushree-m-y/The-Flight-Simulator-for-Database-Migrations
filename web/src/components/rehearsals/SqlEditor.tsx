"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { Monaco, OnMount } from "@monaco-editor/react";
import type { StaticHint } from "@/lib/types";
import { Skeleton } from "@/components/ui";

const MonacoEditor = dynamic(() => import("@monaco-editor/react").then((m) => m.Editor), {
  ssr: false,
  loading: () => <EditorSkeleton />,
});

function EditorSkeleton() {
  return (
    <div className="col" style={{ gap: 10, padding: "16px 18px" }} aria-busy="true" aria-label="Loading editor">
      <Skeleton h={12} w="46%" />
      <Skeleton h={12} w="72%" />
      <Skeleton h={12} w="58%" />
    </div>
  );
}

/** How long we wait for Monaco (loaded from its CDN) before falling back to a plain textarea. */
const MONACO_TIMEOUT_MS = 9000;

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  hints?: StaticHint[];
  dark: boolean;
  height: number;
  label: string;
  placeholder?: string;
  id?: string;
};

/**
 * SQL editor: Monaco (lazy, client-only) with hint markers and ⌘/Ctrl+Enter to submit.
 * Falls back to a monospace textarea when Monaco can't load (offline, CSP, slow CDN).
 */
export function SqlEditor({ value, onChange, onSubmit, hints, dark, height, label, placeholder, id }: Props) {
  const [ready, setReady] = useState(false);
  const [fallback, setFallback] = useState(false);
  const submitRef = useRef(onSubmit);
  submitRef.current = onSubmit;
  const monacoRef = useRef<Monaco | null>(null);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

  useEffect(() => {
    if (ready || fallback) return;
    const t = setTimeout(() => setFallback(true), MONACO_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [ready, fallback]);

  const onMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    setReady(true);
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => submitRef.current?.());
  };

  // Mirror static hints as squiggles in the gutter.
  useEffect(() => {
    const monaco = monacoRef.current;
    const model = editorRef.current?.getModel();
    if (!ready || !monaco || !model) return;
    const sev = { danger: monaco.MarkerSeverity.Error, warn: monaco.MarkerSeverity.Warning, info: monaco.MarkerSeverity.Info };
    monaco.editor.setModelMarkers(
      model,
      "dryrun",
      (hints ?? [])
        .filter((h) => h.line != null && h.line >= 1 && h.line <= model.getLineCount())
        .map((h) => ({
          severity: sev[h.level],
          message: h.message,
          startLineNumber: h.line as number,
          endLineNumber: h.line as number,
          startColumn: model.getLineFirstNonWhitespaceColumn(h.line as number) || 1,
          endColumn: model.getLineMaxColumn(h.line as number),
        })),
    );
  }, [hints, ready, value]);

  if (fallback && !ready) {
    return (
      <div className="code editor-box" style={{ height }}>
        <textarea
          id={id}
          aria-label={label}
          spellCheck={false}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              submitRef.current?.();
            }
          }}
        />
      </div>
    );
  }

  return (
    <div className="code editor-box" style={{ height }} aria-label={label} role="group">
      <MonacoEditor
        height={height}
        language="sql"
        theme={dark ? "vs-dark" : "vs"}
        value={value}
        onChange={(v) => onChange(v ?? "")}
        onMount={onMount}
        loading={<EditorSkeleton />}
        options={{
          minimap: { enabled: false },
          fontFamily: "'DM Mono', ui-monospace, monospace",
          fontSize: 13,
          lineHeight: 23,
          scrollBeyondLastLine: false,
          renderLineHighlight: "line",
          padding: { top: 14, bottom: 14 },
          overviewRulerLanes: 0,
          wordWrap: "on",
          tabSize: 2,
          automaticLayout: true,
          fixedOverflowWidgets: true,
          ariaLabel: label,
          placeholder,
        }}
      />
    </div>
  );
}
