import { describe, expect, it, beforeEach, afterEach } from "vitest";

describe("createClient (browser)", () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey;
  });

  it("throws a clear error if NEXT_PUBLIC_SUPABASE_URL is unset", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    const { createClient } = await import("../client");
    expect(() => createClient()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("throws a clear error if NEXT_PUBLIC_SUPABASE_ANON_KEY is unset", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    const { createClient } = await import("../client");
    expect(() => createClient()).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });

  it("returns a client when both env vars are set", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    const { createClient } = await import("../client");
    expect(() => createClient()).not.toThrow();
  });
});
