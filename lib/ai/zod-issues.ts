import type { ZodError } from "zod";

/** A short, caller-safe description of what was wrong with a value: the first few issues as `[0].confidence: Too big ...`. Written so an agent can fix its own output. */
export function describeZodIssues(error: ZodError, max = 3): string {
  const parts = error.issues.slice(0, max).map((issue) => {
    const path = issue.path.map((seg, i) => (typeof seg === "number" ? `[${seg}]` : i === 0 ? String(seg) : `.${String(seg)}`)).join("");
    return `${path || "result"}: ${issue.message}`;
  });
  const more = error.issues.length > max ? ` (and ${error.issues.length - max} more)` : "";
  return `${parts.join("; ")}${more}`;
}
