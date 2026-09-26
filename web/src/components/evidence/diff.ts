// Minimal line diff (longest common subsequence) for SQL before/after views.

export type DiffOp = { kind: "same" | "add" | "del"; text: string; a: number | null; b: number | null };

/** Same normalisation SqlCode applies before splitting, so line numbers match what is rendered. */
export const sqlLines = (sql: string) => sql.replace(/\s+$/, "").split("\n");

const norm = (l: string) => l.trim().replace(/\s+/g, " ");

export function diffLines(before: string, after: string): DiffOp[] {
  const a = sqlLines(before);
  const b = sqlLines(after);
  const n = a.length;
  const m = b.length;
  // Guard against pathological inputs: fall back to "all removed / all added".
  if (n * m > 4_000_000) {
    return [
      ...a.map((text, i) => ({ kind: "del" as const, text, a: i + 1, b: null })),
      ...b.map((text, j) => ({ kind: "add" as const, text, a: null, b: j + 1 })),
    ];
  }
  const na = a.map(norm);
  const nb = b.map(norm);
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = na[i] === nb[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (na[i] === nb[j]) {
      ops.push({ kind: "same", text: b[j], a: i + 1, b: j + 1 });
      i++;
      j++;
    } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
      ops.push({ kind: "del", text: a[i], a: i + 1, b: null });
      i++;
    } else {
      ops.push({ kind: "add", text: b[j], a: null, b: j + 1 });
      j++;
    }
  }
  while (i < n) ops.push({ kind: "del", text: a[i], a: ++i, b: null });
  while (j < m) ops.push({ kind: "add", text: b[j], a: null, b: ++j });
  return ops;
}

/** Marks for two side-by-side SqlCode blocks: removed lines on the left, added lines on the right. */
export function sideBySideMarks(ops: DiffOp[]) {
  const left: Record<number, "del"> = {};
  const right: Record<number, "add"> = {};
  for (const o of ops) {
    if (o.kind === "del" && o.a) left[o.a] = "del";
    if (o.kind === "add" && o.b) right[o.b] = "add";
  }
  return { left, right };
}

/**
 * A unified view: changed lines with `context` unchanged lines around them; long unchanged runs
 * collapse to a "…" line. Returns the text plus SqlCode marks and the real line numbers per row.
 */
export function unifiedDiff(ops: DiffOp[], context = 2) {
  const keep = ops.map((o) => o.kind !== "same");
  const show = ops.map((_, i) => {
    for (let k = Math.max(0, i - context); k <= Math.min(ops.length - 1, i + context); k++) if (keep[k]) return true;
    return false;
  });
  const lines: string[] = [];
  const marks: Record<number, "add" | "del"> = {};
  let skipped = false;
  ops.forEach((o, i) => {
    if (!show[i]) {
      if (!skipped) lines.push("  …");
      skipped = true;
      return;
    }
    skipped = false;
    lines.push(`${o.kind === "add" ? "+" : o.kind === "del" ? "−" : " "} ${o.text}`);
    if (o.kind !== "same") marks[lines.length] = o.kind;
  });
  const added = ops.filter((o) => o.kind === "add").length;
  const removed = ops.filter((o) => o.kind === "del").length;
  return { text: lines.join("\n"), marks, added, removed };
}
