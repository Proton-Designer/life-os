// Vitest stub for Next's `server-only` package.
//
// `import "server-only"` makes a module fail the BUILD if it is ever pulled
// into a client bundle — the guard that keeps lib/ai/encryption.ts and
// resolve-key.ts (which handle plaintext provider keys) off the browser. The
// real package resolves only inside Next's bundler, so under vitest it fails
// to resolve at all and takes every test of those modules with it.
//
// Aliasing to this empty module keeps the production guard intact while making
// the modules testable. Deleting the import would have been the easy fix and
// would have silently removed the protection.
export {};
