// Thin wrapper around the Anthropic SDK, running directly in the browser with
// the user's own API key.
import Anthropic from "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.130.0/+esm";
import { store } from "./store.js";

export const MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 — best quality" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 — faster and cheaper" },
];

function client() {
  const { apiKey } = store.getSettings();
  if (!apiKey) throw new Error("Add your Anthropic API key in Settings first.");
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

/**
 * Stream a response. Calls onText(fullTextSoFar) as text arrives and resolves
 * with the final text.
 *
 * @param {object} opts
 * @param {string|object[]} opts.system
 * @param {object[]} opts.messages
 * @param {"low"|"medium"|"high"} [opts.effort]
 * @param {object} [opts.schema] JSON schema for structured output
 * @param {(text: string) => void} [opts.onText]
 * @param {AbortSignal} [opts.signal]
 */
export async function run({ system, messages, effort = "medium", schema, onText, signal }) {
  const { model } = store.getSettings();
  const output_config = { effort };
  if (schema) output_config.format = { type: "json_schema", schema };

  const stream = client().beta.messages.stream(
    {
      model,
      max_tokens: 64000,
      thinking: { type: "adaptive" },
      output_config,
      // If the model declines, the API retries on Anthropic's recommended fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system,
      messages,
    },
    { signal },
  );

  let text = "";
  try {
    for await (const event of stream) {
      if (event.type === "content_block_start" && event.content_block.type === "fallback") {
        text = ""; // a fallback model took over; discard the partial answer
        onText?.(text);
      } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        text += event.delta.text;
        onText?.(text);
      }
    }
  } catch (err) {
    throw friendlyError(err);
  }

  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") {
    throw new Error("The AI declined this request. Try rephrasing it or removing unrelated content.");
  }
  const lastFallback = message.content.map((b) => b.type).lastIndexOf("fallback");
  const finalText = message.content
    .slice(lastFallback + 1)
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  return { text: finalText || text, truncated: message.stop_reason === "max_tokens" };
}

export async function testKey() {
  const { model } = store.getSettings();
  try {
    await client().messages.create({
      model,
      max_tokens: 64,
      output_config: { effort: "low" },
      messages: [{ role: "user", content: "Reply with the single word OK." }],
    });
  } catch (err) {
    throw friendlyError(err);
  }
}

function friendlyError(err) {
  if (err?.name === "AbortError" || err instanceof Anthropic.APIUserAbortError) {
    const e = new Error("Stopped.");
    e.aborted = true;
    return e;
  }
  if (err instanceof Anthropic.AuthenticationError) return new Error("Your API key was rejected. Check it in Settings.");
  if (err instanceof Anthropic.PermissionDeniedError) return new Error("This API key doesn't have access to the selected model.");
  if (err instanceof Anthropic.RateLimitError) return new Error("Rate limit reached. Wait a minute and try again.");
  if (err instanceof Anthropic.BadRequestError) return new Error(`The request was rejected: ${err.message}`);
  if (err instanceof Anthropic.APIConnectionError) return new Error("Couldn't reach the Anthropic API. Check your internet connection.");
  if (err instanceof Anthropic.APIError) return new Error(`API error ${err.status ?? ""}: ${err.message}`);
  return err instanceof Error ? err : new Error(String(err));
}
