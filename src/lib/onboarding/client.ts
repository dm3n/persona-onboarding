"use client";

import type { Profile, StreamLine, TurnEvent } from "./types";

export type TurnHandlers = {
  onDelta(text: string): void;
  onPatch(patch: Extract<StreamLine, { t: "patch" }>["v"]): void;
  onDeclined(slots: Extract<StreamLine, { t: "declined" }>["v"]): void;
  onAction(action: Extract<StreamLine, { t: "action" }>["v"]): void;
  onSuggestions(list: string[]): void;
};

export type TurnRequest = {
  profile: Profile;
  channel: "chat" | "voice";
  messages: { role: "assistant" | "user"; text: string }[];
  event?: TurnEvent;
};

/**
 * One turn, streamed.
 *
 * Reads newline delimited JSON so text can start rendering, and on a call start
 * being spoken, before the model has finished thinking. Network failures are
 * retried once; anything worse is the caller's problem to render.
 */
export async function runTurn(
  req: TurnRequest,
  handlers: TurnHandlers,
  signal: AbortSignal,
): Promise<{ ok: boolean }> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt < 2) {
    attempt++;
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req),
        signal,
      });
      if (!res.ok || !res.body) throw new Error(`http_${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sawAnything = false;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let parsed: StreamLine;
          try {
            parsed = JSON.parse(line) as StreamLine;
          } catch {
            continue;
          }
          sawAnything = true;
          dispatch(parsed, handlers);
        }
      }
      if (buffer.trim()) {
        try {
          dispatch(JSON.parse(buffer) as StreamLine, handlers);
        } catch {
          /* truncated tail */
        }
      }
      return { ok: sawAnything };
    } catch (err) {
      if (signal.aborted) return { ok: false };
      lastError = err;
      // One quick retry covers a cold start or a dropped socket.
      if (attempt < 2) await sleep(400);
    }
  }
  console.warn("[onboarding] turn failed", lastError);
  return { ok: false };
}

function dispatch(line: StreamLine, h: TurnHandlers) {
  switch (line.t) {
    case "delta":
      h.onDelta(line.v);
      break;
    case "patch":
      h.onPatch(line.v);
      break;
    case "declined":
      h.onDeclined(line.v);
      break;
    case "action":
      h.onAction(line.v);
      break;
    case "suggestions":
      h.onSuggestions(line.v);
      break;
    default:
      break;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
