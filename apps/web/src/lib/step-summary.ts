// One-line summaries of agent_steps input/output for the "How the agent
// worked" timeline. The full payloads stay in the database; the browser only
// gets enough to see what each step did.

const MAX = 140;

export function oneLine(text: string, max = MAX): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function summarizeInput(kind: "llm" | "tool", input: unknown): string {
  if (input === null || input === undefined) return "";
  if (kind === "llm" && isRecord(input)) {
    const messages = Array.isArray(input.messages) ? input.messages.length : 0;
    const tools = Array.isArray(input.tools) && input.tools.length > 0 ? `, tools: ${input.tools.join(", ")}` : "";
    const json = input.json === true ? ", JSON output" : "";
    return `${messages} message${messages === 1 ? "" : "s"}${json}${tools}`;
  }
  return oneLine(JSON.stringify(input));
}

export function summarizeOutput(kind: "llm" | "tool", output: unknown): string {
  if (output === null || output === undefined) return "";
  if (kind === "llm" && isRecord(output)) {
    if (Array.isArray(output.toolCalls) && output.toolCalls.length > 0) {
      const names = output.toolCalls.map((c) => (isRecord(c) && isRecord(c.function) ? String(c.function.name) : "?"));
      return `called ${names.join(", ")}`;
    }
    if (typeof output.content === "string") return oneLine(output.content);
  }
  return oneLine(JSON.stringify(output));
}
