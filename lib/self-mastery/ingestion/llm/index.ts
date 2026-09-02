// Barrel: types + both providers. `grounding.ts` is a leaf module and is
// NEVER imported through this file from inside the port (see its own header)
// — everything internal imports `./grounding` directly. This file exists so
// an external consumer (the future worker, a test) has one import surface.
export * from "./types";
export * from "./grounding";
export * from "./heuristic-provider";
export * from "./ollama-provider";
