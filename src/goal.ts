import { CliError } from "./util.js";
import type { GoalBlockReason, GoalPhase, GoalSnapshot } from "./types.js";

export type GoalOperation = "create" | "complete" | "block" | "start_round";

export const DEFAULT_GOAL_MAX_ROUNDS = 3;

export const GOAL_BLOCK_CODES = {
  REPEAT_FINDING: "repeat-finding",
  REPAIR_CAP: "repair-cap",
  HOST_CRASH: "host-crash",
} as const;

const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function goalIdForRun(runId: string): string {
  return `goal_${runId}`;
}

export function createGoalSnapshot(
  runId: string,
  objective: string,
  maxRounds = DEFAULT_GOAL_MAX_ROUNDS,
): GoalSnapshot {
  return {
    id: goalIdForRun(runId),
    revision: 1,
    objective,
    phase: "active",
    maxRounds,
    roundsStarted: 0,
  };
}

export function assertGoalRevision(current: GoalSnapshot, expectedRevision: number): void {
  if (current.revision !== expectedRevision) {
    throw new CliError(`stale goal revision: expected ${expectedRevision}, have ${current.revision}`);
  }
}

export function assertGoalBlockReason(reason: GoalBlockReason): void {
  if (!KEBAB_RE.test(reason.code)) {
    throw new CliError(`goal block code must be lower-kebab-case: ${reason.code}`);
  }
  if (!reason.message.trim()) {
    throw new CliError("goal block message must be non-empty");
  }
}

function withoutBlockedReason(snapshot: GoalSnapshot): GoalSnapshot {
  const next = { ...snapshot };
  delete next.blockedReason;
  return next;
}

/** Compare-and-set complete. Clears blockedReason. */
export function completeGoal(current: GoalSnapshot, expectedRevision: number): GoalSnapshot {
  assertGoalRevision(current, expectedRevision);
  return withoutBlockedReason({
    ...current,
    revision: current.revision + 1,
    phase: "complete",
  });
}

/** Compare-and-set block. blockedReason is present iff phase is blocked. */
export function blockGoal(
  current: GoalSnapshot,
  expectedRevision: number,
  reason: GoalBlockReason,
): GoalSnapshot {
  assertGoalRevision(current, expectedRevision);
  assertGoalBlockReason(reason);
  return {
    ...current,
    revision: current.revision + 1,
    phase: "blocked",
    blockedReason: { code: reason.code, message: reason.message.trim() },
  };
}

/** Compare-and-set: increment roundsStarted when a REPAIR is admitted. */
export function startGoalRound(current: GoalSnapshot, expectedRevision: number): GoalSnapshot {
  assertGoalRevision(current, expectedRevision);
  if (current.phase !== "active") {
    throw new CliError(`cannot start a goal round while phase is ${current.phase}`);
  }
  return {
    ...current,
    revision: current.revision + 1,
    roundsStarted: current.roundsStarted + 1,
  };
}

export function goalChangedPayload(
  operation: GoalOperation,
  snapshot: GoalSnapshot,
): { operation: GoalOperation; revision: number; phase: GoalPhase; blockedReason?: GoalBlockReason } {
  const payload: {
    operation: GoalOperation;
    revision: number;
    phase: GoalPhase;
    blockedReason?: GoalBlockReason;
  } = {
    operation,
    revision: snapshot.revision,
    phase: snapshot.phase,
  };
  if (snapshot.phase === "blocked" && snapshot.blockedReason) {
    payload.blockedReason = snapshot.blockedReason;
  }
  return payload;
}
