import { AGENT_TOOL_NAMES, isAgentToolName, type AgentToolName } from "@/lib/agent-api/tool-names";

/**
 * P4-17: the REST path grammar for /api/v1, as a PURE function. It maps
 * (method, path segments, query, JSON body) onto the exact `{tool, args}` an
 * MCP client would send, so everything past this point (schema validation,
 * scope, rate limit, audit, the tool itself) is shared with MCP through
 * lib/agent-api/operations.ts + lib/agent-api/execute.ts. No registry
 * knowledge lives here: an unknown domain/entity/action is the tool's own
 * ToolInputError, with the same text MCP returns.
 *
 * Grammar (segments are after /api/v1):
 *   GET  (root)                               discovery
 *   GET  me                                   token info
 *   GET  capabilities[?domain=]               list_capabilities
 *   GET  {domain}/{entity}[?detail&fields&cursor&limit&filter[col]&filter[col][gte|lte]]   read list
 *   GET  {domain}/{entity}/{id}[?detail&fields]                 read by id
 *   POST {domain}/{entity}/{action}  {id?, patch?}              write
 *   GET  manage/widgets | manage/schedules                      *_manage list
 *   POST manage/widgets | manage/schedules  {patch}             *_manage create
 *   POST manage/widgets/{id}/(update|delete)  {patch?}
 *   POST manage/schedules/{id}/(cancel|pause) {patch?}
 *   POST actions  {tool, args}                                  any tool, MCP args verbatim
 *   GET  write/{domain}/{entity}/{action}[?id=&patch=<url-encoded JSON>]   the SAME write as the POST above, for agents whose
 *        only HTTP tool is GET-with-headers (they could read but never write). Still needs the Bearer header (a token in the
 *        URL is refused before this is reached), still needs a write-scoped token, and is never cached (Cache-Control: no-store).
 *
 * The widget/schedule managers sit under `manage/` (not `/widgets` as the
 * audit's §3.2 sketched) because `widgets` is already a READ registry domain
 * (GET /widgets/widget). RESERVED_TOP_SEGMENTS is drift-guarded against both
 * registries in parse-path.test.ts.
 */

export const RESERVED_TOP_SEGMENTS = ["me", "capabilities", "actions", "manage", "write"] as const;

export type RestMethod = "GET" | "POST";

export type RestRoute = { kind: "root" } | { kind: "me" } | { kind: "tool"; tool: AgentToolName; args: Record<string, unknown> };

export type RestParseErrorCode = "route_not_found" | "method_not_allowed" | "invalid_input";

export type RestParseResult = { ok: true; route: RestRoute } | { ok: false; code: RestParseErrorCode; message: string; allow?: string };

export interface RestRequestParts {
  method: RestMethod;
  /** Decoded path segments after /api/v1, empty strings removed. */
  segments: string[];
  query: URLSearchParams;
  /** Parsed JSON body (POST), or undefined when there was none. */
  body: unknown;
}

const MANAGERS = {
  widgets: { tool: "widget_manage", itemActions: ["update", "delete"] },
  schedules: { tool: "scheduler_manage", itemActions: ["cancel", "pause"] },
} as const satisfies Record<string, { tool: AgentToolName; itemActions: readonly string[] }>;

const TOKEN_PARAM_NAMES = new Set(["access_token", "token", "api_key", "apikey", "key", "lifeos_token", "bearer", "authorization", "x-lifeos-token"]);

/**
 * A credential in the URL lands in server logs, browser history, proxies and
 * the agent's own transcript, so it is refused outright (400) before auth is
 * even attempted, even when the same request also carries a valid header.
 * Returns the offending parameter name, or null.
 */
export function findTokenInQuery(query: URLSearchParams): string | null {
  for (const [name, value] of query) {
    if (TOKEN_PARAM_NAMES.has(name.toLowerCase())) return name;
    if (value.startsWith("lifeos_pat_")) return name;
  }
  return null;
}

const ok = (route: RestRoute): RestParseResult => ({ ok: true, route });
const notFound = (message = "No such route. GET /api/v1 lists the routes."): RestParseResult => ({ ok: false, code: "route_not_found", message });
const badInput = (message: string): RestParseResult => ({ ok: false, code: "invalid_input", message });
const wrongMethod = (allow: RestMethod): RestParseResult => ({ ok: false, code: "method_not_allowed", message: `This route only accepts ${allow}.`, allow });

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Every query param must be one this route understands; `filter[...]` counts when allowed. */
function checkQueryParams(query: URLSearchParams, allowed: readonly string[], allowFilter: boolean): string | null {
  for (const name of new Set(query.keys())) {
    if (allowed.includes(name)) continue;
    if (allowFilter && FILTER_PARAM.test(name)) continue;
    const names = [...allowed, ...(allowFilter ? ["filter[<column>]", "filter[<column>][gte|lte]"] : [])];
    return names.length === 0
      ? `Unknown query parameter "${name}". This route takes no query parameters.`
      : `Unknown query parameter "${name}". Allowed: ${names.join(", ")}.`;
  }
  return null;
}

/** A single-valued param; repeating it is refused rather than guessing which one was meant. */
function single(query: URLSearchParams, name: string): { value?: string; error?: string } {
  const all = query.getAll(name);
  if (all.length > 1) return { error: `Query parameter "${name}" was given more than once.` };
  return all.length === 1 ? { value: all[0] } : {};
}

const FILTER_PARAM = /^filter\[([^\]]+)\](?:\[([^\]]+)\])?$/;

function parseReadQuery(query: URLSearchParams, byId: boolean): { args?: Record<string, unknown>; error?: string } {
  const allowed = byId ? ["detail", "fields"] : ["detail", "fields", "cursor", "limit"];
  const unknown = checkQueryParams(query, allowed, !byId);
  if (unknown) return { error: unknown };

  const args: Record<string, unknown> = {};
  const detail = single(query, "detail");
  if (detail.error) return { error: detail.error };
  if (detail.value !== undefined) args.detail = detail.value;

  const fieldValues = query.getAll("fields");
  if (fieldValues.length > 0) {
    args.fields = fieldValues
      .flatMap((v) => v.split(","))
      .map((f) => f.trim())
      .filter(Boolean);
  }

  if (!byId) {
    const cursor = single(query, "cursor");
    if (cursor.error) return { error: cursor.error };
    if (cursor.value !== undefined) args.cursor = cursor.value;

    const limit = single(query, "limit");
    if (limit.error) return { error: limit.error };
    // A digit string becomes a number; anything else is passed through as
    // text so the shared schema rejects it with its own message.
    if (limit.value !== undefined) args.limit = /^\d+$/.test(limit.value) ? Number(limit.value) : limit.value;

    const filter: Record<string, string | Record<string, string>> = {};
    for (const name of new Set(query.keys())) {
      const m = FILTER_PARAM.exec(name);
      if (!m) continue;
      const [, col, bound] = m;
      const one = single(query, name);
      if (one.error) return { error: one.error };
      const existing = filter[col];
      // Values stay strings: PostgREST's eq()/gte()/lte() serialize to the
      // same URL text either way, so this matches an MCP caller sending the
      // same literal.
      if (bound === undefined) {
        if (existing !== undefined) return { error: `filter[${col}] can't be both an equality and a range.` };
        filter[col] = one.value ?? "";
      } else {
        if (typeof existing === "string") return { error: `filter[${col}] can't be both an equality and a range.` };
        // The bound name is not checked here: the shared schema's .strict()
        // rejects anything but gte/lte, with the same message MCP gets.
        filter[col] = { ...(existing ?? {}), [bound]: one.value ?? "" };
      }
    }
    if (Object.keys(filter).length > 0) args.filter = filter;
  }
  return { args };
}

/** POST bodies: absent = {}, otherwise a JSON object whose keys are all in `allowedKeys`. */
function bodyObject(body: unknown, allowedKeys: readonly string[], hint: string): { value?: Record<string, unknown>; error?: string } {
  if (body === undefined || body === null) return { value: {} };
  if (!isPlainObject(body)) return { error: `The request body must be a JSON object${allowedKeys.length ? ` with ${allowedKeys.join(", ")}` : ""}.` };
  const extra = Object.keys(body).filter((k) => !allowedKeys.includes(k));
  if (extra.length > 0) return { error: `Unexpected body field(s): ${extra.join(", ")}. ${hint}` };
  return { value: body };
}

function pick(obj: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

export function parseRestRoute({ method, segments, query, body }: RestRequestParts): RestParseResult {
  const [first, second, third, fourth, ...rest] = segments;

  if (segments.length === 0) return method === "GET" ? ok({ kind: "root" }) : wrongMethod("GET");

  if (first === "me") {
    if (segments.length !== 1) return notFound();
    if (method !== "GET") return wrongMethod("GET");
    const unknown = checkQueryParams(query, [], false);
    return unknown ? badInput(unknown) : ok({ kind: "me" });
  }

  if (first === "capabilities") {
    if (segments.length !== 1) return notFound();
    if (method !== "GET") return wrongMethod("GET");
    const unknown = checkQueryParams(query, ["domain"], false);
    if (unknown) return badInput(unknown);
    const domain = single(query, "domain");
    if (domain.error) return badInput(domain.error);
    return ok({ kind: "tool", tool: "list_capabilities", args: domain.value !== undefined ? { domain: domain.value } : {} });
  }

  if (first === "actions") {
    if (segments.length !== 1) return notFound();
    if (method !== "POST") return wrongMethod("POST");
    const unknown = checkQueryParams(query, [], false);
    if (unknown) return badInput(unknown);
    if (!isPlainObject(body)) return badInput('The request body must be a JSON object: {"tool": "<name>", "args": {...}}.');
    const { tool, args } = body;
    if (typeof tool !== "string" || !isAgentToolName(tool)) {
      return badInput(`Unknown tool ${JSON.stringify(tool)}. Tools: ${AGENT_TOOL_NAMES.join(", ")}.`);
    }
    if (args !== undefined && !isPlainObject(args)) return badInput('"args" must be a JSON object.');
    const extra = Object.keys(body).filter((k) => k !== "tool" && k !== "args");
    if (extra.length > 0) return badInput(`Unexpected body field(s): ${extra.join(", ")}. The body is {"tool", "args"}.`);
    return ok({ kind: "tool", tool, args: args ?? {} });
  }

  if (first === "write") {
    if (segments.length !== 4) return notFound("A GET write is /write/{domain}/{entity}/{action}?id=&patch=<url-encoded JSON>.");
    if (method !== "GET") return wrongMethod("GET"); // the POST form is /{domain}/{entity}/{action}
    const unknown = checkQueryParams(query, ["id", "patch"], false);
    if (unknown) return badInput(unknown);
    const id = single(query, "id");
    if (id.error) return badInput(id.error);
    const patchText = single(query, "patch");
    if (patchText.error) return badInput(patchText.error);
    const args: Record<string, unknown> = { domain: second, entity: third, action: fourth };
    if (id.value !== undefined) args.id = id.value;
    if (patchText.value !== undefined) {
      let patch: unknown;
      try {
        patch = JSON.parse(patchText.value);
      } catch {
        return badInput('"patch" must be a URL-encoded JSON object, e.g. patch=%7B%22name%22%3A%22...%22%7D.');
      }
      if (!isPlainObject(patch)) return badInput('"patch" must be a JSON object.');
      args.patch = patch;
    }
    return ok({ kind: "tool", tool: "write", args });
  }

  if (first === "manage") {
    const manager = second !== undefined && Object.hasOwn(MANAGERS, second) ? MANAGERS[second as keyof typeof MANAGERS] : undefined;
    if (!manager || rest.length > 0) return notFound();
    const unknown = checkQueryParams(query, [], false);

    if (segments.length === 2) {
      if (unknown) return badInput(unknown);
      if (method === "GET") return ok({ kind: "tool", tool: manager.tool, args: { action: "list" } });
      const b = bodyObject(body, ["patch"], 'The body is {"patch": {...}}.');
      if (b.error) return badInput(b.error);
      return ok({ kind: "tool", tool: manager.tool, args: { action: "create", ...pick(b.value!, ["patch"]) } });
    }

    if (segments.length === 4) {
      if (!(manager.itemActions as readonly string[]).includes(fourth)) return notFound(`Unknown ${second} action "${fourth}". Actions: ${manager.itemActions.join(", ")}.`);
      if (method !== "POST") return wrongMethod("POST");
      if (unknown) return badInput(unknown);
      const b = bodyObject(body, ["patch"], 'The body is {"patch": {...}}.');
      if (b.error) return badInput(b.error);
      return ok({ kind: "tool", tool: manager.tool, args: { action: fourth, id: third, ...pick(b.value!, ["patch"]) } });
    }
    return notFound();
  }

  // Registry resources.
  if (segments.length === 2) {
    if (method !== "GET") return wrongMethod("GET");
    const parsed = parseReadQuery(query, false);
    if (parsed.error) return badInput(parsed.error);
    return ok({ kind: "tool", tool: "read", args: { domain: first, entity: second, ...parsed.args } });
  }

  if (segments.length === 3) {
    if (method === "GET") {
      const parsed = parseReadQuery(query, true);
      if (parsed.error) return badInput(parsed.error);
      return ok({ kind: "tool", tool: "read", args: { domain: first, entity: second, id: third, ...parsed.args } });
    }
    const unknown = checkQueryParams(query, [], false);
    if (unknown) return badInput(unknown);
    const b = bodyObject(body, ["id", "patch"], 'Put the action\'s fields inside "patch": {"id"?: "...", "patch": {...}}.');
    if (b.error) return badInput(b.error);
    return ok({ kind: "tool", tool: "write", args: { domain: first, entity: second, action: third, ...pick(b.value!, ["id", "patch"]) } });
  }

  return notFound();
}
