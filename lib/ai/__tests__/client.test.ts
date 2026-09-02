import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chat } from "../client";

// Boss ruling (R7, DeepSeek task), relayed via ULM lead. Three findings on
// the exact screen where a user has just pasted their own API key:
//
// 1. defaultModel bet on an unverified name ("deepseek-chat") instead of a
//    listed one ("deepseek-v4-flash") -- covered in providers.test.ts, not
//    here, since it's a plain constant on PROVIDERS.
// 2. A bad model id (HTTP 400) rendered as the same generic
//    "DeepSeek returned an error (HTTP 400)" a 401/403 would, on the exact
//    screen a user just proved their key on -- implicating the key for a
//    failure that has nothing to do with it.
// 3. A 2xx response with empty `content` -- which DeepSeek's own docs admit
//    happens -- must fail with its own message, not read as success (a
//    caller checking `.ok` alone would otherwise treat `content: ""` as a
//    real answer).
describe("chat()'s HTTP status / content-shape mapping", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function jsonResponse(status: number, body: unknown) {
    return { status, ok: status >= 200 && status < 300, json: async () => body };
  }

  it("a 401/403 (bad key) says the key was rejected", async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: "invalid_api_key" }));
    const result = await chat("deepseek", "sk-test", [{ role: "user", content: "hi" }]);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/rejected that key/i);
  });

  it("a 400 (bad request -- e.g. a stale model id) must NOT implicate the user's key", async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { error: { message: "invalid model" } }));
    const result = await chat("deepseek", "sk-test", [{ role: "user", content: "hi" }]);
    expect(result.ok).toBe(false);
    // The exact wrong behavior this pins against: the old generic message
    // read as "DeepSeek returned an error (HTTP 400)" on the same screen a
    // user just proved their key on -- easy to misread as "your key is bad."
    // The fix's own wording DOES say "key" (reassuringly: "not with your
    // key"), so the real assertion is that it never uses the 401/403
    // phrasing ("rejected that key") and does carry the "our side"
    // reassurance -- not that the word itself is absent.
    expect(result.message).not.toMatch(/rejected that key/i);
    expect(result.message).toMatch(/our side|not (a|the) (problem )?with your key/i);
  });

  // The push-back: prove the 400 and 401/403 messages can never quietly
  // collapse back into the same branch. If someone folds them together,
  // this fails because both messages become the exact same "rejected that
  // key" phrasing the 401/403 branch owns.
  it("400 and 401/403 are distinct messages, never merged", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, {}));
    const badRequest = await chat("deepseek", "sk-test", [{ role: "user", content: "hi" }]);

    fetchMock.mockResolvedValueOnce(jsonResponse(403, {}));
    const badKey = await chat("deepseek", "sk-test", [{ role: "user", content: "hi" }]);

    expect(badRequest.message).not.toBe(badKey.message);
    expect(badRequest.message).not.toMatch(/rejected that key/i);
    expect(badKey.message).toMatch(/rejected that key/i);
  });

  it("an empty content string in a 2xx response is a failure with its own message, not a silent success", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: "" } }] }));
    const result = await chat("deepseek", "sk-test", [{ role: "user", content: "hi" }]);
    expect(result.ok).toBe(false);
    expect(result.content).toBeUndefined();
    expect(result.message).toMatch(/empty/i);
  });

  it("a 2xx response with no choices at all is the same empty-content failure, not a crash", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { choices: [] }));
    const result = await chat("deepseek", "sk-test", [{ role: "user", content: "hi" }]);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/empty/i);
  });

  it("a real 2xx response with content is still a success", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: "ok" } }] }));
    const result = await chat("deepseek", "sk-test", [{ role: "user", content: "hi" }]);
    expect(result.ok).toBe(true);
    expect(result.content).toBe("ok");
  });
});
