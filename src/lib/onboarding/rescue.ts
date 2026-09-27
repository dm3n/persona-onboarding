import { gateway } from "@ai-sdk/gateway";
import { generateObject } from "ai";
import { z } from "zod";

import { normalizeSlot } from "./slots";
import type { SlotId } from "./types";

const FIELD: Record<SlotId, string> = {
  agentName: "the name the user wants to give their AI agent",
  userName: "the user's own name, what the agent should call them",
  gmail: "the user's email address",
  need: "the thing the user wants help with, in their words",
};

const Extraction = z.object({
  agentName: z.string().nullable(),
  userName: z.string().nullable(),
  gmail: z.string().nullable(),
  need: z.string().nullable(),
});

/**
 * Second read of an exchange, when the conversation captured nothing from it.
 *
 * The conversational model is asked to save what it learns and usually does.
 * When it forgets, someone has answered a question and watched the answer
 * vanish, which is the worst thing this product could do to them. So a small
 * model reads the same two lines with one job.
 *
 * It only ever produces values. Refusals are decided by pattern elsewhere, so
 * this can never quietly close a slot that nobody refused.
 */
export async function rescueSlots(opts: {
  wanted: SlotId[];
  question: string;
  answer: string;
}): Promise<Partial<Record<SlotId, string>>> {
  const { wanted, question, answer } = opts;
  if (!wanted.length || answer.trim().length < 2) return {};

  try {
    const { object } = await generateObject({
      model: gateway("openai/gpt-4.1-mini"),
      schema: Extraction,
      temperature: 0,
      abortSignal: AbortSignal.timeout(9000),
      providerOptions: {
        gateway: { models: ["openai/gpt-4o-mini", "openai/gpt-4.1-nano"] },
      },
      system: `You read one exchange from an onboarding conversation and pull out any of these that the user gave:
${wanted.map((w) => `- ${w}: ${FIELD[w]}`).join("\n")}

Rules.
Return each field exactly as the user phrased it. Do not tidy, expand or invent.
Return null for anything they did not give in this message.
A question, a greeting, a joke, a refusal or nonsense is not an answer. Return null.
Do not guess a name from an email address. Do not treat "call me" on its own as a name.
Only these fields exist: ${wanted.join(", ")}. Everything else must be null.`,
      prompt: `Agent asked: ${question.slice(0, 500) || "(nothing, the user spoke first)"}\nUser replied: ${answer.slice(0, 800)}`,
    });

    const out: Partial<Record<SlotId, string>> = {};
    for (const id of wanted) {
      const value = normalizeSlot(id, object[id]);
      if (value) out[id] = value;
    }
    return out;
  } catch {
    return {};
  }
}
