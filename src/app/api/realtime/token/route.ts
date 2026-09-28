import { z } from "zod";

import { buildSystemPrompt } from "@/lib/onboarding/prompt";
import { callWouldHelp, coerceProfile, nextSlot } from "@/lib/onboarding/slots";

export const runtime = "nodejs";
export const maxDuration = 30;

export const REALTIME_MODEL =
  process.env.PERSONA_REALTIME_MODEL || "gpt-realtime-2.1";
const VOICE = process.env.PERSONA_REALTIME_VOICE || "marin";

/**
 * The voice agent's tools.
 *
 * Deliberately the same set the text agent has, so both channels collect into
 * the same contract and neither can invent a shortcut the other lacks.
 */
const TOOLS = [
  {
    type: "function",
    name: "remember",
    description:
      "Save something you just learned. Call it the moment you learn it, before you reply. Pass values exactly as they said them; they are cleaned up afterwards. Set a declined flag when they refuse to give something.",
    parameters: {
      type: "object",
      properties: {
        agentName: {
          type: "string",
          description: "What they want to call you.",
        },
        userName: { type: "string", description: "Their own name." },
        gmail: { type: "string", description: "Their email address." },
        need: {
          type: "string",
          description: "The job they want off their plate.",
        },
        userNameDeclined: { type: "boolean" },
        gmailDeclined: { type: "boolean" },
        needDeclined: { type: "boolean" },
        note: { type: "string", description: "One short fact worth keeping." },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "show_board",
    description:
      "Put the job board on their screen: six kinds of work they can tap. Use this instead of making them describe the job out loud from nothing.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "connect_gmail",
    description:
      "Put the Gmail connect button on their screen. Always prefer this to hearing an email address out loud, because addresses do not survive a microphone.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "finish",
    description:
      "End onboarding and open their workspace. Only when you have everything, or they have asked to move on.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "hang_up",
    description:
      "End the call and go back to text. Use it when the conversation is done, or when they have gone quiet and you have already checked on them.",
    parameters: {
      type: "object",
      properties: { reason: { type: "string" } },
      additionalProperties: false,
    },
  },
] as const;

/** What a real-time voice needs on top of the shared brief. */
function voiceAddendum(profile: ReturnType<typeof coerceProfile>): string {
  const next = nextSlot(profile);
  return `
# You are on a live call
They can hear you and you can hear them, continuously. This is a conversation, not a reading.

- Short turns. One or two sentences, then stop and listen. Silence is you giving them the floor, not a problem to fill.
- If they start talking while you are, stop immediately and listen. Never talk over them.
- Speak like a person: contractions, a little warmth, ordinary words. Never spell out punctuation, never read markdown, never say "bullet point".
- Do not narrate what you are about to do. Do it. Ask the question rather than announcing that you are going to ask it.
- Never say what you will do "next" or "when you are ready". There is no queue, there is just the next question.
- Never say you are thinking, framing, preparing or setting something up. Say the thing itself.
- If you could not make out what they said, say so plainly and ask again in different words. Never guess at a name.
- Never ask them to say an email address out loud. Call connect_gmail and tell them you have put a button on their screen.
- Their screen is right there and it is interactive. When something appears on it, say so in a few words and let them use it.
${next ? `- The one thing to get next is: ${next}.` : "- You have everything. Say one line about where you will start, then call finish."}
- Call your tools as you go. A fact you do not save is a fact they will be asked for twice.`;
}

const Body = z.object({ profile: z.unknown() });

export async function POST(req: Request) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return Response.json(
      { error: "voice_unavailable", reason: "no_key" },
      { status: 503 },
    );
  }

  let profile: ReturnType<typeof coerceProfile>;
  try {
    profile = coerceProfile(Body.parse(await req.json()).profile);
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const instructions = `${buildSystemPrompt({
    profile,
    channel: "voice",
  })}\n${voiceAddendum(profile)}`;

  try {
    const res = await fetch(
      "https://api.openai.com/v1/realtime/client_secrets",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({
          session: {
            type: "realtime",
            model: REALTIME_MODEL,
            instructions,
            tools: TOOLS,
            tool_choice: "auto",
            // A demo should not be able to run up a bill by being left open.
            max_output_tokens: 1200,
            audio: {
              input: {
                // Semantic turn detection waits for a finished thought rather
                // than a gap, which stops it cutting people off mid sentence.
                turn_detection: {
                  type: "semantic_vad",
                  interrupt_response: true,
                },
                transcription: { model: "gpt-4o-mini-transcribe" },
                noise_reduction: { type: "near_field" },
              },
              output: { voice: VOICE, speed: 1.05 },
            },
          },
        }),
      },
    );

    if (!res.ok) {
      const detail = await res.text();
      console.error("[realtime] mint failed", res.status, detail.slice(0, 400));
      return Response.json(
        { error: "voice_unavailable", reason: `upstream_${res.status}` },
        { status: 503 },
      );
    }

    const data = (await res.json()) as { value?: string; expires_at?: number };
    if (!data.value) {
      return Response.json(
        { error: "voice_unavailable", reason: "no_token" },
        { status: 503 },
      );
    }

    return Response.json(
      {
        value: data.value,
        expiresAt: data.expires_at ?? null,
        model: REALTIME_MODEL,
        // The client uses this to decide whether a call is worth offering.
        wouldHelp: callWouldHelp(profile),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    console.error("[realtime] mint threw", err);
    return Response.json(
      { error: "voice_unavailable", reason: "network" },
      { status: 503 },
    );
  }
}
