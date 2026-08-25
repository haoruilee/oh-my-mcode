import { existsSync, readFileSync } from "node:fs";
import { CliError, promptLine } from "./util.js";
import { RunStore } from "./store.js";
import type { AcceptanceItem, RunRecord } from "./types.js";
import { namedCheckInGoal } from "./acceptance.js";

export interface InterviewQuestion {
  id: string;
  prompt: string;
}

export interface InterviewAnswers {
  goal?: string;
  constraints?: string[];
  acceptance?: string[];
  out_of_scope?: string[];
}

export interface InterviewRecord {
  run_id: string;
  goal: string;
  questions: Array<InterviewQuestion & { answer: string }>;
  answers: Required<InterviewAnswers>;
  derived_acceptance: AcceptanceItem[];
  source: "tty" | "answers-file" | "flags";
}

export const INTERVIEW_QUESTIONS: InterviewQuestion[] = [
  { id: "goal", prompt: "Restate the goal in one sentence." },
  { id: "constraints", prompt: "Hard constraints (files, APIs, time)?" },
  { id: "acceptance", prompt: "How will we know this is done?" },
  { id: "out_of_scope", prompt: "What is out of scope?" },
];

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/\n|;/g)
      .map((item) => item.replace(/^[-*]\s*/, "").trim())
      .filter(Boolean);
  }
  return [];
}

export function loadAnswersFile(filePath: string): InterviewAnswers {
  if (!existsSync(filePath)) throw new CliError(`answers file not found: ${filePath}`);
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
  return {
    goal: typeof raw.goal === "string" ? raw.goal : undefined,
    constraints: asStringList(raw.constraints),
    acceptance: asStringList(raw.acceptance),
    out_of_scope: asStringList(raw.out_of_scope ?? raw.outOfScope),
  };
}

export function deriveAcceptance(goal: string, answers: InterviewAnswers): AcceptanceItem[] {
  const lines = answers.acceptance && answers.acceptance.length > 0 ? answers.acceptance : [`${goal} is complete and verified`];
  return lines.map((criterion, i) => {
    const named = namedCheckInGoal(criterion) || namedCheckInGoal(goal);
    return {
      id: `A${i + 1}`,
      criterion,
      kind: named ? named.kind : "manual",
      command: named?.command,
      source: named ? "goal" : undefined,
    };
  });
}

function formatInterviewMarkdown(record: InterviewRecord): string {
  const lines = [
    `# Interview`,
    ``,
    `Goal: ${record.goal}`,
    ``,
    `## Questions`,
    ``,
  ];
  for (const item of record.questions) {
    lines.push(`- **${item.id}:** ${item.prompt}`);
    lines.push(`  ${item.answer || "_unanswered_"}`);
  }
  lines.push(``, `## Derived acceptance`, ``);
  for (const item of record.derived_acceptance) {
    lines.push(`- ${item.id}: ${item.criterion}${item.command ? ` (\`${item.command}\`)` : ""}`);
  }
  lines.push(``, `_Interview stops at PLAN_REVIEW. No builder. Say \`max\` to execute._`, ``);
  return lines.join("\n");
}

function formatInterviewPlan(record: InterviewRecord): string {
  return [
    `# Plan`,
    ``,
    `Goal: ${record.goal}`,
    ``,
    `## Constraints`,
    ``,
    ...(record.answers.constraints.length ? record.answers.constraints.map((item) => `- ${item}`) : ["- _none_"]),
    ``,
    `## Acceptance`,
    ``,
    ...record.derived_acceptance.map((item) => `- ${item.id}: ${item.criterion}`),
    ``,
    `## Out of scope`,
    ``,
    ...(record.answers.out_of_scope.length ? record.answers.out_of_scope.map((item) => `- ${item}`) : ["- _none_"]),
    ``,
    `_Drafted from interview. Planner has not rewritten this file yet._`,
    ``,
  ].join("\n");
}

export async function collectInterviewAnswers(opts: {
  goal: string;
  answers?: InterviewAnswers;
  answersPath?: string;
  constraints?: string[];
  interactive?: boolean;
}): Promise<{ answers: Required<InterviewAnswers>; source: InterviewRecord["source"]; questions: InterviewRecord["questions"] }> {
  let source: InterviewRecord["source"] = "flags";
  let loaded: InterviewAnswers = {};
  if (opts.answersPath) {
    loaded = loadAnswersFile(opts.answersPath);
    source = "answers-file";
  } else if (opts.answers) {
    loaded = opts.answers;
    source = "answers-file";
  }

  const tty = opts.interactive ?? Boolean(process.stdin.isTTY);
  const hasStructured =
    Boolean(opts.answersPath || opts.answers) || Boolean(opts.constraints && opts.constraints.length > 0);

  if (!tty && !hasStructured) {
    throw new CliError("interview: non-TTY requires --answers <file> or --constraint (repeatable)");
  }

  let goal = (loaded.goal || opts.goal || "").trim();
  let constraints = [...(loaded.constraints || []), ...(opts.constraints || [])];
  let acceptance = [...(loaded.acceptance || [])];
  let outOfScope = [...(loaded.out_of_scope || [])];

  if (tty && !opts.answersPath && !opts.answers) {
    source = "tty";
    const askedGoal = await promptLine(`${INTERVIEW_QUESTIONS[0]?.prompt} [${opts.goal}]`);
    if (askedGoal) goal = askedGoal;
    const askedConstraints = await promptLine(INTERVIEW_QUESTIONS[1]?.prompt || "Constraints?");
    if (askedConstraints) constraints = asStringList(askedConstraints);
    const askedAcceptance = await promptLine(INTERVIEW_QUESTIONS[2]?.prompt || "Acceptance?");
    if (askedAcceptance) acceptance = asStringList(askedAcceptance);
    const askedScope = await promptLine(INTERVIEW_QUESTIONS[3]?.prompt || "Out of scope?");
    if (askedScope) outOfScope = asStringList(askedScope);
  }

  if (!goal) throw new CliError("interview requires a goal");
  const answers: Required<InterviewAnswers> = {
    goal,
    constraints,
    acceptance,
    out_of_scope: outOfScope,
  };
  const questions = INTERVIEW_QUESTIONS.map((question) => {
    const value =
      question.id === "goal"
        ? answers.goal
        : question.id === "constraints"
          ? answers.constraints.join("; ")
          : question.id === "acceptance"
            ? answers.acceptance.join("; ")
            : answers.out_of_scope.join("; ");
    return { ...question, answer: value };
  });
  return { answers, source, questions };
}

export interface InterviewOptions {
  workspace: string;
  goal?: string;
  runId?: string;
  answers?: InterviewAnswers;
  answersPath?: string;
  constraints?: string[];
  interactive?: boolean;
}

/** TypeScript intake. Writes interview artifacts and stops at PLAN_REVIEW. No mcode. No builder. */
export async function runInterview(opts: InterviewOptions): Promise<{ run: RunRecord; interview: InterviewRecord }> {
  const store = new RunStore(opts.workspace);
  const goal = (opts.goal || "").trim();
  if (!opts.runId && !goal) throw new CliError('usage: oh-my-mcode interview "<goal>"');
  const run = opts.runId ? store.load(opts.runId) : store.create(goal);
  const collected = await collectInterviewAnswers({
    goal: goal || run.goal,
    answers: opts.answers,
    answersPath: opts.answersPath,
    constraints: opts.constraints,
    interactive: opts.interactive,
  });
  const derived = deriveAcceptance(collected.answers.goal, collected.answers);
  const interview: InterviewRecord = {
    run_id: run.run_id,
    goal: collected.answers.goal,
    questions: collected.questions,
    answers: collected.answers,
    derived_acceptance: derived,
    source: collected.source,
  };

  if (collected.answers.goal && collected.answers.goal !== run.goal) {
    store.patchRun(run.run_id, { goal: collected.answers.goal });
  }
  store.writeArtifact(run.run_id, "interview.json", `${JSON.stringify(interview, null, 2)}\n`);
  store.writeArtifact(run.run_id, "interview.md", formatInterviewMarkdown(interview));
  store.writePlan(run.run_id, formatInterviewPlan(interview));
  const tasks = store.loadTasks(run.run_id);
  store.writeTasks(run.run_id, {
    ...tasks,
    acceptance: derived,
    tasks: [
      {
        id: "T1",
        title: "Interview intake",
        role: "planner",
        status: "done",
        depends_on: [],
        notes: "Captured by oh-my-mcode interview",
      },
      {
        id: "T2",
        title: collected.answers.goal,
        role: "builder",
        status: "pending",
        depends_on: ["T1"],
      },
    ],
  });
  store.patchRun(run.run_id, { workflow: "interview" });
  store.setPhase(run.run_id, "PLAN_REVIEW");
  store.appendEvent(run.run_id, "interview_completed", {
    source: interview.source,
    acceptance_count: derived.length,
    builder: false,
    accepted: false,
  });
  store.evidenceReport(run.run_id);
  return { run: store.load(run.run_id), interview };
}

export function interviewContext(store: RunStore, runId: string): string {
  return store.readArtifact(runId, "interview.md");
}
