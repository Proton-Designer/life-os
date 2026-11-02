/** The MyHomeBase admin console's token (TASK-80): its label and its one scope. Shared by the Settings action and its UI so the two cannot drift. */
export const CONSOLE_TOKEN_LABEL = "MyHomeBase console";
export const CONSOLE_TOKEN_SCOPES = ["kill_list"] as const;
