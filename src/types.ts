export const PHASES = [
  "INTAKE",
  "DISCOVER",
  "PLAN",
  "PLAN_REVIEW",
  "EXECUTE",
  "VERIFY",
  "REPAIR",
  "ACCEPT",
  "RELEASE",
] as const;

export type Phase = (typeof PHASES)[number];

export const STATUSES = ["active", "accepted", "rejected", "blocked", "cancelled"] as const;
export type RunStatus = (typeof STATUSES)[number];

export const EVENT_TYPES = [
  "run_created",
  "phase_changed",
  "task_started",
  "task_completed",
  "tool_called",
  "test_ran",
  "finding_emitted",
  "repair_requested",
  "run_accepted",
  "run_rejected",
  "run_resumed",
  "review_completed",
  "ship_prepared",
  "research_completed",
  "task_cancelled",
  "team_spawned",
  "worktree_created",
  "hud_attached",
  "run_cancelled",
  "host_session_bound",
  "host_event",
  "interview_completed",
  "subagent_spawned",
  "goal_changed",
  "guard_fired",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const ROLES = ["explorer", "planner", "builder", "verifier", "release"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = ["ask", "smart", "full", "off"] as const;
export type Permission = (typeof PERMISSIONS)[number];

export type TaskStatus = "pending" | "in_progress" | "done" | "blocked" | "cancelled";
export type AcceptanceKind = "test" | "build" | "diff" | "manual" | "diagnostic";
export type AcceptanceResult = "pass" | "fail" | "untested";
export type AcceptanceSource = "goal" | "detected";
export const FINDING_CLASSES = ["command_failed", "command_refused", "no_test", "stale_workspace", "host_crash"] as const;
export type FindingClass = (typeof FINDING_CLASSES)[number];
export type FindingSeverity = "blocker" | "major" | "minor" | "note";
export type EvidenceKind = "command" | "test" | "diff" | "log" | "other";
export type Verdict = "accepted" | "rejected";

/** Durable same-session goal. `paused` is DSH-only; we do not pause/resume/clear. */
export type GoalPhase = "active" | "blocked" | "complete";

export interface GoalBlockReason {
  /** lower-kebab-case, policy-owned (`repeat-finding` / `repair-cap` / `host-crash`) */
  code: string;
  /** non-empty human+model text */
  message: string;
}

export interface GoalSnapshot {
  id: string;
  /** increment on every accepted mutation */
  revision: number;
  objective: string;
  phase: GoalPhase;
  /** present iff phase === "blocked" */
  blockedReason?: GoalBlockReason;
  maxRounds: number;
  roundsStarted: number;
}

export interface RunRecord {
  run_id: string;
  /** Original user goal string. Do not rename. Durable lifecycle lives on `goal_state`. */
  goal: string;
  /** Armed on create. Mutations are logged `goal_changed`. */
  goal_state?: GoalSnapshot;
  phase: Phase;
  status: RunStatus;
  created_at: string;
  updated_at: string;
  workspace: string;
  repair_count?: number;
  last_failure_signature?: string;
  max_repairs?: number;
  ralph?: boolean;
  team?: boolean;
  workflow?: string;
  host_session_id?: string;
  host_continue?: boolean;
  host_session_source?: "host" | "synthesized" | "user";
  /** Host Goal settlement/budget facts from structured exec events. Not our acceptance authority. */
  host_goal?: HostGoalFacts;
  usage?: UsageTotals;
}

/** Copied from structured host events only. VERIFY/REPAIR/guard still decide Accept. */
export interface HostGoalFacts {
  phase?: string;
  budget?: unknown;
  settled?: boolean | string;
}

export interface HostModel {
  providerId?: string;
  modelId?: string;
  variant?: string;
}

export interface UsageTotals {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  cache_read_tokens?: number;
  cost_usd?: number;
  /** message.usage.requestDurationMs — generation clock for output_tps */
  request_duration_ms?: number;
  /** exec.result.durationMs — exec clock, not generation */
  duration_ms?: number;
  thinking_duration_ms?: number;
  first_token_ms?: number;
  model?: HostModel;
}

export interface RunEvent {
  id: string;
  ts: string;
  type: EventType;
  run_id: string;
  phase?: Phase;
  task_id?: string;
  payload: Record<string, unknown>;
}

export interface TaskItem {
  id: string;
  title: string;
  role: Role;
  status: TaskStatus;
  depends_on: string[];
  notes?: string;
  allowed_files?: string[];
}

export interface AcceptanceItem {
  id: string;
  criterion: string;
  kind?: AcceptanceKind;
  command?: string;
  result?: AcceptanceResult;
  evidence?: string[];
  /** Where the runnable command / criterion was sourced. */
  source?: AcceptanceSource;
}

export interface TaskGraph {
  run_id: string;
  updated_at: string;
  tasks: TaskItem[];
  acceptance: AcceptanceItem[];
}

export interface FindingItem {
  id: string;
  severity: FindingSeverity;
  title: string;
  detail: string;
  evidence?: string[];
  sha256?: string;
  /** command_failed | command_refused | no_test | stale_workspace | host_crash — not HTTP / OMP transport codes. */
  class?: FindingClass;
}

export interface Findings {
  run_id: string;
  verdict: Verdict;
  checked_at: string;
  summary: string;
  acceptance: AcceptanceItem[];
  findings: FindingItem[];
}

export interface EvidenceRecord {
  id: string;
  kind: EvidenceKind;
  path: string;
  command?: string;
  exit_code?: number;
  recorded_at: string;
  notes?: string;
  sha256?: string;
}

export interface EvidenceIndex {
  run_id: string;
  items: EvidenceRecord[];
}

export interface TaskContract {
  task_id: string;
  objective: string;
  allowed_files?: string[];
  acceptance: string[];
  constraints: string[];
}
