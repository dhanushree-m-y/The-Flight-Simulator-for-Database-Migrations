// API contract between the DryRun web app and the FastAPI backend (api/dryrun/models.py mirrors this).

export type Role = "viewer" | "engineer" | "approver" | "admin";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  initials: string;
}

export type RehearsalStatus =
  | "queued"
  | "running"
  | "passed" // safe to apply
  | "warning" // needs human review
  | "blocked" // do not apply
  | "failed" // DryRun itself errored
  | "cancelled";

export type StageStatus = "pending" | "running" | "passed" | "warning" | "failed" | "skipped";

export type StageKey =
  | "provision"
  | "snapshot"
  | "migrate"
  | "compare"
  | "ai_checks"
  | "rollback"
  | "report";

export interface Stage {
  key: StageKey;
  label: string;
  status: StageStatus;
  started_at: string | null;
  duration_ms: number | null;
  detail: string | null;
}

export type CheckGroup = "data" | "constraint" | "performance" | "ai";
export type CheckStatus = "pass" | "fail" | "warn";

export interface Check {
  id: string;
  key: string;
  title: string;
  group: CheckGroup;
  status: CheckStatus;
  table: string | null;
  column: string | null;
  before: string | null;
  after: string | null;
  sql: string | null;
  explanation: string | null;
  affected_rows: number;
  has_rows: boolean; // evidence rows can be fetched from /broken-rows
}

export interface RiskPart {
  label: string;
  points: number;
  kind: "data_loss" | "constraint" | "lock" | "rollback" | "policy" | "ai" | "other";
}

export interface LockEvent {
  table: string;
  mode: string; // e.g. ACCESS EXCLUSIVE
  duration_ms: number;
  blocks_reads: boolean;
  blocks_writes: boolean;
  source: "measured" | "static";
}

export interface RollbackTable {
  table: string;
  rows_before: number;
  rows_after: number;
  checksum_before: string;
  checksum_after: string;
  identical: boolean;
}

export interface RollbackResult {
  status: "passed" | "failed" | "skipped";
  down_sql: string | null;
  down_sql_source: "user" | "ai" | null;
  identical: boolean;
  tables: RollbackTable[];
  message: string | null;
}

export interface TableImpact {
  name: string;
  rows: number;
  status: "changed" | "affected" | "unchanged";
  references: string[]; // tables this one has foreign keys to
  note: string | null;
}

export interface SchemaDiff {
  table: string;
  before: string;
  after: string;
}

export interface LogLine {
  ts: string;
  level: "info" | "warn" | "error" | "ai";
  source: string;
  message: string;
}

export interface AiSummary {
  headline: string;
  summary: string;
  model: string | null;
}

export interface Metrics {
  rows_scanned: number;
  rows_total: number;
  tables: number;
  checks_run: number;
  checks_total: number;
  elapsed_ms: number;
}

export interface SandboxInfo {
  id: string;
  provider: "truefoundry" | "local-postgres";
  engine: string;
  region: string | null;
  status: "creating" | "ready" | "destroyed";
  expires_at: string | null;
}

export interface RehearsalSummary {
  id: string;
  name: string; // migration file name, e.g. 003_room_capacity
  version: number; // V1, V2… within a lineage
  lineage_id: string;
  connection_id: string;
  connection_name: string;
  status: RehearsalStatus;
  risk: number | null;
  headline: string | null;
  created_by: User;
  created_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  approval_status: ApprovalStatus | null;
}

export interface Rehearsal extends RehearsalSummary {
  up_sql: string;
  down_sql: string | null;
  parent_id: string | null;
  stages: Stage[];
  metrics: Metrics;
  checks: Check[];
  risk_parts: RiskPart[];
  locks: LockEvent[];
  rollback: RollbackResult | null;
  impact: TableImpact[];
  schema_diff: SchemaDiff[];
  logs: LogLine[];
  ai: AiSummary | null;
  sandbox: SandboxInfo | null;
  policy_violations: PolicyViolation[];
  error: string | null;
  /** The TrueForge session that drove this rehearsal (open it in the TrueForge UI). */
  agent: { provider: "trueforge" | "direct"; session_id: string | null; url: string | null; model: string | null } | null;
}

export interface BrokenRows {
  check_id: string;
  columns: string[];
  highlight: string[]; // columns whose values are the problem
  rows: Record<string, string | number | null>[];
  total: number;
  masked: boolean;
}

export interface AiFix {
  id: string;
  rehearsal_id: string;
  root_cause: string;
  evidence: string[];
  original_sql: string;
  fixed_sql: string;
  down_sql: string | null;
  why_safer: string[];
  model: string | null;
  created_at: string;
}

export interface AiFixState {
  state: "none" | "running" | "ready" | "failed";
  fix: AiFix | null;
  error: string | null;
}

export type ApprovalStatus = "pending" | "approved" | "rejected" | "applied" | "apply_failed" | "restored";

export interface ApprovalCheck {
  label: string;
  ok: boolean;
  detail: string | null;
}

export interface Approval {
  id: string;
  rehearsal: RehearsalSummary;
  status: ApprovalStatus;
  requested_by: User;
  requested_at: string;
  decided_by: User | null;
  decided_at: string | null;
  comment: string | null;
  checklist: ApprovalCheck[];
  confirm_phrase: string; // the user must type this (the production database name)
  apply: ApplyRun | null;
}

export type ApplyStepKey = "backup" | "apply" | "verify" | "done";

export interface ApplyRun {
  id: string;
  status: "running" | "succeeded" | "failed" | "restored";
  steps: { key: ApplyStepKey; label: string; status: StageStatus; duration_ms: number | null; detail: string | null }[];
  backup_ref: string | null;
  restore_until: string | null;
  logs: LogLine[];
}

export interface Connection {
  id: string;
  name: string;
  engine: string;
  host: string; // masked
  database: string;
  environment: "production" | "staging";
  read_only: boolean;
  size_bytes: number | null;
  tables: number | null;
  rows: number | null;
  health: "ok" | "degraded" | "down";
  last_checked_at: string | null;
}

export interface SchemaColumn {
  name: string;
  type: string;
  nullable: boolean;
}

export interface SchemaTable {
  name: string;
  rows: number;
  columns: SchemaColumn[];
  references: string[];
}

export interface StaticHint {
  level: "info" | "warn" | "danger";
  message: string;
  line: number | null;
}

export interface Policy {
  id: string;
  key: string;
  title: string;
  description: string;
  severity: "block" | "review" | "info";
  enabled: boolean;
  params: Record<string, number | string | boolean>;
}

export interface PolicyViolation {
  policy_id: string;
  title: string;
  severity: Policy["severity"];
  message: string;
}

export interface AuditEvent {
  id: number;
  ts: string;
  actor: User | null;
  action: string;
  target: string | null;
  detail: Record<string, unknown>;
  prev_hash: string;
  hash: string;
}

export interface AuditVerify {
  ok: boolean;
  events: number;
  broken_at: number | null;
}

export interface Integration {
  key: "truefoundry" | "github" | "slack" | "llm";
  name: string;
  connected: boolean;
  detail: string;
}

export interface Overview {
  week_label: string;
  kpis: { rehearsals: number; blocked: number; rows_protected: number; avg_duration_ms: number };
  pending: Approval[];
  recent: RehearsalSummary[];
  risk_trend: { id: string; name: string; risk: number; at: string }[];
  top_issues: { kind: string; count: number }[];
}

export type LiveEvent =
  | { type: "snapshot"; rehearsal: Rehearsal }
  | { type: "stage"; stage: Stage }
  | { type: "log"; line: LogLine }
  | { type: "metrics"; metrics: Metrics }
  | { type: "check"; check: Check }
  | { type: "sandbox"; sandbox: SandboxInfo }
  | { type: "done"; rehearsal: Rehearsal };

export type ApplyEvent =
  | { type: "step"; run: ApplyRun }
  | { type: "log"; line: LogLine }
  | { type: "done"; run: ApplyRun };
