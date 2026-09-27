import { gateway } from "@ai-sdk/gateway";
import { stepCountIs, streamText, tool } from "ai";
import { z } from "zod";

import { fallbackReply, fallbackSuggestions } from "@/lib/onboarding/fallback";
import { readIntent, salvage, slotInMessage } from "@/lib/onboarding/intent";
import { rescueSlots } from "@/lib/onboarding/rescue";
import { createScrubber } from "@/lib/onboarding/scrub";
import { buildSystemPrompt } from "@/lib/onboarding/prompt";
import {
  callWouldHelp,
  canGraduate,
  coerceProfile,
  missingSlots,
  nextSlot,
  normalizeSlot,
} from "@/lib/onboarding/slots";
import { SLOT_IDS } from "@/lib/onboarding/types";
import type {
  Profile,
  SlotId,
  StreamLine,
  TurnAction,
  TurnEvent,
} from "@/lib/onboarding/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = process.env.PERSONA_MODEL || "openai/gpt-4.1";
const FALLBACK_MODELS = ["openai/gpt-4.1-mini", "openai/gpt-4o-mini"];

const BodySchema = z.object({
  profile: z.unknown(),
  channel: z.enum(["chat", "voice"]).default("chat"),
  messages: z
    .array(
      z.object({
        role: z.enum(["assistant", "user"]),
        text: z.string().max(4000),
      }),
    )
    .max(60)
    .default([]),
  event: z.unknown().optional(),
});

const EventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("open") }),
  z.object({ type: z.literal("resume"), awayMs: z.number() }),
  z.object({ type: z.literal("call_accepted") }),
  z.object({ type: z.literal("call_declined") }),
  z.object({
    type: z.literal("call_ended"),
    outcome: z.enum([
      "completed",
      "declined",
      "hungup",
      "abandoned",
      "failed",
      "no_mic",
    ]),
    secs: z.number(),
  }),
  z.object({ type: z.literal("call_failed"), reason: z.string().max(120) }),
  z.object({ type: z.literal("call_silence"), strikes: z.number() }),
  z.object({ type: z.literal("gmail_connected"), email: z.string().max(254) }),
  z.object({ type: z.literal("gmail_dismissed") }),
]);

export async function POST(req: Request) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return new Response(JSON.stringify({ error: "bad_request" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const profile = coerceProfile(body.profile);
  const parsedEvent = EventSchema.safeParse(body.event);
  const event: TurnEvent | undefined = parsedEvent.success
    ? parsedEvent.data
    : undefined;

  // The last user turn drives the deterministic guarantees.
  const lastUser = [...body.messages].reverse().find((m) => m.role === "user");
  const lastAssistant = [...body.messages]
    .reverse()
    .find((m) => m.role === "assistant");

  /*
   * Only a turn the user actually typed or said carries intent.
   *
   * Event driven turns (a call ending, a sheet closing) re-send the same
   * history, so reading intent from them would re-fire whatever the user asked
   * for last time. That is how one "call me" turns into a phone that will not
   * stop ringing.
   */
  const userDriven =
    Boolean(lastUser) &&
    body.messages[body.messages.length - 1]?.role === "user";
  const intent = readIntent(userDriven ? (lastUser?.text ?? "") : "");

  const patch: Partial<Record<SlotId, string>> = {};
  const declined: SlotId[] = [];
  const actions: TurnAction[] = [];

  /**
   * Whether this is the turn to offer the call, decided before the model runs
   * so the words and the action agree. It is the first turn where the agent
   * has a name and a call would still collect something.
   */
  const offerCallNow =
    body.channel === "chat" &&
    !profile.callOffered &&
    !profile.callRefused &&
    Boolean(profile.slots.agentName.value) &&
    callWouldHelp(profile) &&
    !intent.wantsCall &&
    !intent.wantsSkip &&
    event?.type !== "call_ended";

  // Apply what we can be certain about before the model ever sees the prompt.
  if (intent.wantsSkip) profile.wantsToSkip = true;
  if (intent.refusesCall) {
    profile.callRefused = true;
    profile.callOffered = true;
  }
  if (event?.type === "call_declined") profile.callOffered = true;

  // A plain refusal settles the slot we were asking about, whatever the model
  // does next. Nobody should have to say no twice.
  /*
   * The slot this exchange is actually about.
   *
   * The user's own words win, then the agent's last question, then the default
   * order. Getting this wrong means declining the thing nobody refused.
   */
  const unsettled = (id: SlotId | null): SlotId | null =>
    id && !profile.slots[id].value && !profile.slots[id].declined ? id : null;

  const askedFor =
    unsettled(userDriven ? slotInMessage(lastUser?.text ?? "") : null) ??
    unsettled(slotInMessage(lastAssistant?.text ?? "")) ??
    nextSlot(profile);

  // "I'd rather not" reads as a refusal of both the slot and the call. When
  // they were turning down the call, the slot is still open.
  if (
    intent.refuses &&
    !intent.refusesCall &&
    askedFor &&
    askedFor !== "agentName"
  ) {
    profile.slots[askedFor].declined = true;
    declined.push(askedFor);
  }
  if (event?.type === "gmail_connected") {
    const email = normalizeSlot("gmail", event.email);
    if (email) {
      profile.slots.gmail.value = email;
      profile.slots.gmail.declined = false;
      profile.slots.gmail.source = "oauth";
      patch.gmail = email;
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (line: StreamLine) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already torn down */
        }
      };

      if (Object.keys(patch).length) send({ t: "patch", v: patch });
      if (declined.length) send({ t: "declined", v: declined });

      const emitRemember = (input: Record<string, unknown>) => {
        const next: Partial<Record<SlotId, string>> & { notes?: string[] } = {};
        for (const id of ["agentName", "userName", "gmail", "need"] as const) {
          const raw = input[id];
          if (typeof raw !== "string") continue;
          const value = normalizeSlot(id, raw);
          if (!value) continue;
          profile.slots[id].value = value;
          profile.slots[id].declined = false;
          next[id] = value;
        }
        for (const id of ["agentName", "userName", "gmail", "need"] as const) {
          const key = `${id}Declined`;
          if (input[key] === true && !profile.slots[id].value) {
            profile.slots[id].declined = true;
          }
        }
        if (typeof input.note === "string" && input.note.trim()) {
          const note = input.note.trim().slice(0, 240);
          if (!profile.notes.includes(note)) profile.notes.push(note);
          next.notes = profile.notes.slice(-8);
        }
        if (Object.keys(next).length) send({ t: "patch", v: next });
      };

      const pushAction = (a: TurnAction) => {
        if (actions.some((x) => x.kind === a.kind)) return;
        actions.push(a);
        send({ t: "action", v: a });
      };

      const tools = {
        remember: tool({
          description:
            "Save something you just learned. Call this the moment you learn it. Pass values exactly as the user said them; they are cleaned up downstream. Set a *Declined flag when the user refuses to give something.",
          inputSchema: z.object({
            agentName: z.string().max(60).optional(),
            userName: z.string().max(60).optional(),
            gmail: z.string().max(254).optional(),
            need: z.string().max(400).optional(),
            agentNameDeclined: z.boolean().optional(),
            userNameDeclined: z.boolean().optional(),
            gmailDeclined: z.boolean().optional(),
            needDeclined: z.boolean().optional(),
            note: z
              .string()
              .max(240)
              .optional()
              .describe("One short fact worth keeping that is not a slot."),
          }),
          execute: async (input) => {
            rememberedSomething = true;
            emitRemember(input as Record<string, unknown>);
            return { saved: true };
          },
        }),
        placeCall: tool({
          description:
            "Start the voice call. Only after the user has agreed to talk.",
          inputSchema: z.object({}),
          execute: async () => {
            pushAction({ kind: "place_call" });
            return { ringing: true };
          },
        }),
        endCall: tool({
          description: "Hang up. Only valid while a call is live.",
          inputSchema: z.object({ reason: z.string().max(80).optional() }),
          execute: async ({ reason }) => {
            pushAction({ kind: "end_call", reason });
            return { ended: true };
          },
        }),
        connectGmail: tool({
          description:
            "Put the Gmail connect button on the user's screen. Prefer this over asking them to type an address, and always use it on a call.",
          inputSchema: z.object({}),
          execute: async () => {
            pushAction({ kind: "gmail_connect" });
            return { shown: true };
          },
        }),
        finish: tool({
          description:
            "End onboarding and open the workspace. Only when you have enough.",
          inputSchema: z.object({}),
          execute: async () => {
            pushAction({ kind: "graduate" });
            return { done: true };
          },
        }),
      };

      const scrub = createScrubber(body.channel);
      let sawText = false;
      let textBlocks = 0;
      let rememberedSomething = false;
      try {
        const result = streamText({
          model: gateway(MODEL),
          system: buildSystemPrompt({
            profile,
            channel: body.channel,
            event,
            intent,
            offerCallNow,
          }),
          messages: toModelMessages(body.messages, event, body.channel),
          tools,
          stopWhen: stepCountIs(4),
          temperature: 0.75,
          maxOutputTokens: body.channel === "voice" ? 180 : 320,
          abortSignal: AbortSignal.timeout(45_000),
          providerOptions: {
            // If the primary model is unavailable the gateway walks this list
            // rather than failing the turn.
            gateway: { models: FALLBACK_MODELS },
          },
        });

        for await (const part of result.fullStream) {
          if (req.signal.aborted) break;
          if (part.type === "text-start") {
            // A tool call between two text blocks otherwise glues the
            // sentences together with no space.
            textBlocks++;
            if (textBlocks > 1 && sawText) send({ t: "delta", v: " " });
          } else if (part.type === "text-delta" && part.text) {
            const clean = scrub(part.text);
            if (!clean) continue;
            sawText = true;
            send({ t: "delta", v: clean });
          } else if (part.type === "error") {
            throw part.error;
          }
        }
      } catch (err) {
        if (!req.signal.aborted) {
          console.error("[onboarding] turn failed", err);
          if (!sawText) {
            // Recover what the user plainly told us, then keep talking.
            const rescue = salvage(lastUser?.text ?? "");
            const guess = nextSlot(profile);
            if (rescue.email) emitRemember({ gmail: rescue.email });
            if (rescue.name && guess && guess !== "gmail")
              emitRemember({ [guess]: rescue.name });
            send({ t: "delta", v: fallbackReply(profile, true) });
            const sug = fallbackSuggestions(profile);
            if (sug.length) send({ t: "suggestions", v: sug });
          }
        }
      }

      /*
       * Second pass at the answer, when the conversation dropped it.
       *
       * Streaming has already finished, so the reply is on screen while this
       * runs and the chip simply fills in a moment later.
       */
      const wasAnAnswer =
        userDriven &&
        !intent.wantsCall &&
        !intent.refusesCall &&
        !intent.wantsSkip &&
        !intent.refuses &&
        !intent.isBareGreeting;

      /*
       * If the turn captured nothing, read the exchange again.
       *
       * Streaming has already finished, so the reply is on screen while this
       * runs and the setup chips simply fill in a moment later.
       */
      const stillOpen = SLOT_IDS.filter(
        (id) => !profile.slots[id].value && !profile.slots[id].declined,
      );
      if (wasAnAnswer && stillOpen.length && !rememberedSomething && lastUser) {
        const rescued = await rescueSlots({
          wanted: stillOpen,
          question: lastAssistant?.text ?? "",
          answer: lastUser.text,
        });
        const found: Partial<Record<SlotId, string>> = {};
        for (const [id, value] of Object.entries(rescued) as [
          SlotId,
          string,
        ][]) {
          if (profile.slots[id].value) continue;
          profile.slots[id].value = value;
          found[id] = value;
        }
        if (Object.keys(found).length) send({ t: "patch", v: found });
      }

      // A turn that called tools but wrote nothing still owes the user words.
      if (!sawText && !req.signal.aborted) {
        send({ t: "delta", v: fallbackReply(profile, false) });
        const sug = fallbackSuggestions(profile);
        if (sug.length) send({ t: "suggestions", v: sug });
      }

      // Guarantees the model is not trusted to provide.
      applyGuarantees(
        profile,
        intent,
        actions,
        pushAction,
        body.channel,
        offerCallNow,
        userDriven,
      );
      send({ t: "done" });
      close();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

/**
 * Invariants enforced after the model has had its say.
 *
 * A model that forgets to offer a call, or refuses to let an impatient user
 * leave, would break promises this product makes. These are cheap to check and
 * they make the behaviour testable.
 */
function applyGuarantees(
  profile: Profile,
  intent: ReturnType<typeof readIntent>,
  actions: TurnAction[],
  push: (a: TurnAction) => void,
  channel: "chat" | "voice",
  offerCallNow: boolean,
  userDriven: boolean,
) {
  const has = (k: TurnAction["kind"]) => actions.some((a) => a.kind === k);

  // The user asked for a call in so many words. Honour it.
  if (
    userDriven &&
    intent.wantsCall &&
    !profile.callRefused &&
    channel === "chat" &&
    !has("place_call")
  ) {
    push({ kind: "place_call" });
  }

  // The user wants out and we have enough. Let them out.
  if (
    userDriven &&
    intent.wantsSkip &&
    canGraduate(profile) &&
    !has("graduate")
  ) {
    push({ kind: "graduate" });
  }

  // Nothing left to ask and the model did not close it out.
  if (
    missingSlots(profile).length === 0 &&
    !has("graduate") &&
    channel === "chat"
  ) {
    push({ kind: "graduate" });
  }

  // First natural moment to offer the call, once only.
  if (offerCallNow && !has("place_call") && !has("graduate")) {
    push({ kind: "offer_call" });
  }

  // Gmail is the one slot with a button. When it is the only thing left,
  // put the button on screen rather than making them type an address.
  if (
    !has("graduate") &&
    !has("place_call") &&
    !profile.slots.gmail.value &&
    !profile.slots.gmail.declined &&
    nextSlot(profile) === "gmail" &&
    !has("gmail_connect")
  ) {
    push({ kind: "gmail_connect" });
  }
}

function toModelMessages(
  messages: { role: "assistant" | "user"; text: string }[],
  event: TurnEvent | undefined,
  channel: "chat" | "voice",
) {
  const trimmed = messages
    .filter((m) => m.text.trim().length > 0)
    .slice(-24)
    .map((m) => ({
      role: m.role,
      content:
        m.role === "user"
          ? // Fence user content so instructions inside it read as quoted speech.
            `<user_said channel="${channel}">\n${m.text.slice(0, 2000)}\n</user_said>`
          : m.text.slice(0, 2000),
    }));

  // Some turns are driven by an event rather than by something the user typed.
  if (
    trimmed.length === 0 ||
    trimmed[trimmed.length - 1].role === "assistant"
  ) {
    trimmed.push({
      role: "user",
      content: `<system_event>${event?.type ?? "continue"}</system_event>`,
    });
  }
  return trimmed as { role: "user" | "assistant"; content: string }[];
}
