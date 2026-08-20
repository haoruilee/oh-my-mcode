import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PHASES, type Phase } from "./types.js";
import { packageRoot } from "./util.js";

export interface WorkflowDef {
  id: string;
  kind?: string;
  phases: Phase[];
  rules: Record<string, unknown>;
  stopAfter?: Phase;
  source: string;
}

/** Minimal YAML subset used by workflows/*.yaml (comments, scalars, lists, one-level maps). */
export function parseSimpleYaml(text: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  const lines = text.replace(/\r/g, "").split("\n");
  let i = 0;
  const assign = (target: Record<string, unknown>, key: string, value: unknown) => {
    target[key] = value;
  };

  while (i < lines.length) {
    const raw = lines[i] || "";
    i += 1;
    const line = raw.replace(/\s+#.*$/, "");
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (/^\s/.test(line)) continue;
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1] as string;
    const rest = (match[2] || "").trim();
    if (rest !== "") {
      assign(root, key, coerce(rest));
      continue;
    }
    const collected: unknown[] = [];
    const nested: Record<string, unknown> = {};
    while (i < lines.length) {
      const childRaw = lines[i] || "";
      const child = childRaw.replace(/\s+#.*$/, "");
      if (!child.trim() || child.trim().startsWith("#")) {
        i += 1;
        continue;
      }
      if (!/^\s/.test(child)) break;
      const item = child.match(/^\s+-\s+(.*)$/);
      if (item) {
        collected.push(coerce(item[1] || ""));
        i += 1;
        continue;
      }
      const pair = child.match(/^\s+([A-Za-z0-9_-]+):\s*(.*)$/);
      if (pair) {
        nested[pair[1] as string] = coerce(pair[2] || "");
        i += 1;
        continue;
      }
      break;
    }
    if (collected.length > 0) assign(root, key, collected);
    else if (Object.keys(nested).length > 0) assign(root, key, nested);
    else assign(root, key, {});
  }
  return root;
}

function coerce(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null" || trimmed === "") return trimmed === "" ? "" : null;
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function workflowsDir(root = packageRoot()): string {
  return path.join(root, "workflows");
}

export function listWorkflowIds(root = packageRoot()): string[] {
  const dir = workflowsDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".yaml") || name.endsWith(".yml"))
    .map((name) => name.replace(/\.ya?ml$/, ""))
    .sort();
}

export function loadWorkflow(id: string, root = packageRoot()): WorkflowDef {
  const filePath = path.join(workflowsDir(root), `${id}.yaml`);
  const alt = path.join(workflowsDir(root), `${id}.yml`);
  const source = existsSync(filePath) ? filePath : alt;
  if (!existsSync(source)) {
    return {
      id,
      phases: [...PHASES],
      rules: {},
      source: "",
    };
  }
  const parsed = parseSimpleYaml(readFileSync(source, "utf8"));
  const phases = (Array.isArray(parsed.phases) ? parsed.phases : [])
    .map((item) => String(item))
    .filter((item): item is Phase => (PHASES as readonly string[]).includes(item));
  const rules = parsed.rules && typeof parsed.rules === "object" && !Array.isArray(parsed.rules)
    ? (parsed.rules as Record<string, unknown>)
    : {};
  const stopAfterRaw = rules.stop_after;
  const stopAfter =
    typeof stopAfterRaw === "string" && (PHASES as readonly string[]).includes(stopAfterRaw)
      ? (stopAfterRaw as Phase)
      : undefined;
  return {
    id: typeof parsed.id === "string" ? parsed.id : id,
    kind: typeof parsed.kind === "string" ? parsed.kind : undefined,
    phases: phases.length > 0 ? phases : [...PHASES],
    rules,
    stopAfter,
    source,
  };
}

export function workflowStopAfter(id: string): Phase | undefined {
  return loadWorkflow(id).stopAfter;
}
