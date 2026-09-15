/**
 * The agent-facing tool names, shared by MCP (app/api/mcp/route.ts registers
 * exactly these) and REST (/api/v1/actions accepts exactly these). Dependency
 * free so a pure parser can import it without pulling in the tools.
 * lib/agent-api/operations.ts's schema table is typed against this list, so
 * a name added here without a schema fails tsc.
 */
export const AGENT_TOOL_NAMES = ["list_capabilities", "read", "write", "widget_manage", "scheduler_manage"] as const;

export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

export function isAgentToolName(value: string): value is AgentToolName {
  return (AGENT_TOOL_NAMES as readonly string[]).includes(value);
}
