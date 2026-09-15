import "server-only";
import { MODEL_CATALOG } from "./model-catalog";

/**
 * Transcription provider clients for lecture-capture (P3-15). BYOK only --
 * every call here uses the CALLER's own OpenAI/Gemini key, never this
 * project's shared/allowlisted server key (see lecture-transcription-worker.ts's
 * use of `resolveStoredUserKey`, never `resolveApiKey`).
 *
 * Both providers are called with plain `fetch`, NOT `safeFetch`
 * (lib/net/safe-outbound-url.ts) -- deliberately. safeFetch exists because
 * Canvas's instance URL is USER-SUPPLIED (P2-20 security review, SSRF).
 * OpenAI's and Google's API hostnames here are fixed literals this file
 * owns, never influenced by user input, so there is no SSRF surface to
 * guard against.
 *
 * Discriminated result type mirrors lib/canvas/client.ts's
 * `CanvasClientResult<T>` (same shape, same reasoning: a bad key or an
 * unreachable provider is an expected, common BYOK outcome, not an
 * exceptional one -- callers need a message they can show the user
 * directly, not a caught exception).
 *
 * KNOWN GAP: the Gemini Files API path below is written against Google's
 * documented resumable-upload + generateContent contract but has never been
 * exercised against a live Gemini key (BYOK -- there is no operator test
 * credential for a user-supplied-key feature, same posture P2-20's Canvas
 * client already accepted). Flagged in $SD/OPEN_QUESTIONS.md: smoke-test
 * against a real key before this is considered fully proven, same as any
 * BYOK integration in this codebase.
 */

const REQUEST_TIMEOUT_MS = 90_000; // transcription runs far longer than a typical chat call (verifyCanvasToken's 10s would starve a real audio file)

/** OpenAI's own request-size limit for /v1/audio/transcriptions. */
export const OPENAI_MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

export type TranscriptionResult = { text: string; durationSeconds: number | null };
export type TranscriptionClientResult = { ok: true; data: TranscriptionResult } | { ok: false; message: string };

/**
 * Duck-typed, not `instanceof Error`/`instanceof DOMException` -- which
 * concrete class an aborted fetch() throws varies by runtime (Node's own
 * DOMException vs. a test environment's polyfill aren't guaranteed to share
 * a prototype chain), but `.name === "AbortError"` is the one thing every
 * environment agrees on for an AbortController-triggered rejection.
 */
function isAbortError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { name?: unknown }).name === "AbortError";
}

async function withAbort<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * `whisper-1`, `response_format: "verbose_json"` -- the ONLY OpenAI
 * transcription response shape that includes a real `duration` field
 * (seconds), which is what lets the caller log the REAL cost afterward
 * instead of the pre-flight worst-case estimate (lib/ai/transcription-pricing.ts's
 * `computeActualTranscriptionCostUsd`).
 */
export async function transcribeWithOpenAI(
  apiKey: string,
  audioBytes: Uint8Array,
  filename: string,
  mimeType: string,
): Promise<TranscriptionClientResult> {
  try {
    return await withAbort(async (signal) => {
      const formData = new FormData();
      // Buffer.from(...), not the raw Uint8Array -- lib.dom.d.ts's BlobPart
      // type wants an ArrayBufferView<ArrayBuffer>, and a bare Uint8Array's
      // buffer is typed ArrayBufferLike (which also covers SharedArrayBuffer,
      // rejected here). Server-only file (Node runtime), so Buffer is always
      // available.
      formData.append("file", new Blob([Buffer.from(audioBytes)], { type: mimeType }), filename);
      formData.append("model", "whisper-1");
      formData.append("response_format", "verbose_json");

      const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
        signal,
      });

      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: "OpenAI rejected that key." };
      }
      if (!res.ok) {
        return { ok: false, message: `OpenAI returned an error (HTTP ${res.status}).` };
      }
      const data = (await res.json()) as { text?: string; duration?: number };
      if (typeof data.text !== "string") {
        return { ok: false, message: "OpenAI responded, but not with a recognizable transcript." };
      }
      return { ok: true, data: { text: data.text, durationSeconds: typeof data.duration === "number" ? data.duration : null } };
    });
  } catch (err) {
    if (isAbortError(err)) return { ok: false, message: "OpenAI didn't respond in time." };
    return { ok: false, message: "Couldn't reach OpenAI." };
  }
}

const GEMINI_MODEL = MODEL_CATALOG.google.budget.id; // same model this file's own pricing (transcription-pricing.ts) is priced against -- keep them in sync.

type GeminiUploadStart = { uploadUrl: string };

async function startGeminiUpload(apiKey: string, sizeBytes: number, mimeType: string, signal: AbortSignal): Promise<GeminiUploadStart> {
  const res = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(sizeBytes),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: "lecture-recording" } }),
    signal,
  });
  if (!res.ok) throw new Error(`Gemini rejected the upload start (HTTP ${res.status}).`);
  const uploadUrl = res.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("Gemini didn't return an upload URL.");
  return { uploadUrl };
}

async function finishGeminiUpload(uploadUrl: string, audioBytes: Uint8Array, signal: AbortSignal): Promise<{ fileUri: string; fileMimeType: string }> {
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: audioBytes as BodyInit,
    signal,
  });
  if (!res.ok) throw new Error(`Gemini rejected the file upload (HTTP ${res.status}).`);
  const data = (await res.json()) as { file?: { uri?: string; mimeType?: string } };
  if (!data.file?.uri) throw new Error("Gemini didn't return a file URI after upload.");
  return { fileUri: data.file.uri, fileMimeType: data.file.mimeType ?? "application/octet-stream" };
}

/**
 * Files API two-step (upload, then reference the file in a generateContent
 * call) -- the only Gemini path that handles genuinely long lecture audio,
 * unlike inlining base64 bytes directly in the request body. Gemini doesn't
 * reliably report exact audio duration in its response, unlike OpenAI's
 * verbose_json -- the caller falls back to the same size-based estimate
 * used for the pre-flight gate (documented gap, see this file's own
 * header and OPEN_QUESTIONS.md).
 */
export async function transcribeWithGemini(apiKey: string, audioBytes: Uint8Array, mimeType: string): Promise<TranscriptionClientResult> {
  try {
    return await withAbort(async (signal) => {
      const { uploadUrl } = await startGeminiUpload(apiKey, audioBytes.byteLength, mimeType, signal);
      const { fileUri, fileMimeType } = await finishGeminiUpload(uploadUrl, audioBytes, signal);

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { file_data: { mime_type: fileMimeType, file_uri: fileUri } },
                  { text: "Transcribe this audio verbatim. Return only the transcript text, no commentary." },
                ],
              },
            ],
          }),
          signal,
        },
      );

      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: "Gemini rejected that key." };
      }
      if (!res.ok) {
        return { ok: false, message: `Gemini returned an error (HTTP ${res.status}).` };
      }
      const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      if (!text.trim()) {
        return { ok: false, message: "Gemini responded, but not with a recognizable transcript." };
      }
      // No reliable provider-reported duration -- caller (lecture-transcription-worker.ts)
      // falls back to the size-based estimate for cost logging. See this file's header.
      return { ok: true, data: { text, durationSeconds: null } };
    });
  } catch (err) {
    if (isAbortError(err)) return { ok: false, message: "Gemini didn't respond in time." };
    if (err instanceof Error) return { ok: false, message: err.message };
    return { ok: false, message: "Couldn't reach Gemini." };
  }
}
