/**
 * NAV-02: client side of lib/api/shell-read.ts. A plain fetch (outside the Server Action queue).
 * Throws on a non-2xx or non-JSON answer (an expired session can bounce to an HTML login page), so
 * each poll's existing try/catch keeps its "leave the last-known value showing" behaviour.
 */
export async function shellFetch<T>(path: string): Promise<T> {
  const res = await fetch(path, { method: "GET", credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  if (!(res.headers.get("content-type") ?? "").includes("application/json")) throw new Error(`${path}: not JSON`);
  return (await res.json()) as T;
}
