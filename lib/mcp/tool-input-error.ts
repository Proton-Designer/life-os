import "server-only";

/**
 * A validation failure caused by the CALLER's own input — a missing/blank
 * required field, a value outside an enum, the wrong type. Opus Lead's
 * ruling (2026-09-14, #37 follow-up): MCP input errors must reach the AI
 * client so it can actually correct its call, instead of every thrown
 * error — including a plain "patch.kind must be one of: ..." — collapsing
 * into `tool-wrapper.ts`'s generic "Something went wrong running that
 * tool." message.
 *
 * THE SAFETY PROPERTY THIS TYPE EXISTS TO PRESERVE: its message may ONLY
 * ever contain (a) the literal validation-rule text this file's own
 * `require*`/`optional*` helpers already write, and (b) the caller's OWN
 * submitted value echoed back via `JSON.stringify`. It must NEVER contain
 * a value read from the database (another row's actual state, a value
 * this user doesn't already know), an internal identifier (a table or
 * column name), or anything from a Postgres/PostgREST error object.
 * `lib/mcp/write-registry.ts`'s `assertRowDomain` is the textbook example
 * of what NOT to wrap in this: its message interpolates a DB-read
 * `domain` value and the literal table name.
 *
 * `tool-wrapper.ts`'s `runMcpTool` is the ONLY reader of this type — it
 * unwraps a caught `ToolInputError` and returns its message VERBATIM to
 * the MCP client; every other thrown value (a bare `Error`, a Postgres
 * error, anything else) stays behind the generic message exactly as
 * before. See that file's own test suite — "a tool that THROWS is
 * audited as an error, and the client gets a generic message, not the
 * raw internal error" — for the guarantee a `ToolInputError` must never
 * be used to route around.
 */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}

/**
 * The caller named a specific row by id and no such row exists for this
 * user (or it is outside the entity's allowlist filters). A SUBCLASS of
 * `ToolInputError`, so `runMcpTool`'s one `instanceof ToolInputError` check
 * passes it through verbatim with no second branch; the separate class
 * exists so a transport that has status codes (P4-02's REST adapter) can
 * tell "not found" (404) apart from "invalid input" (400).
 *
 * Same safety property as the parent: the message may echo only the
 * caller's own id and the registry's public entity name, never a table
 * name or anything read from the row.
 */
export class ToolNotFoundError extends ToolInputError {
  constructor(message: string) {
    super(message);
    this.name = "ToolNotFoundError";
  }
}
