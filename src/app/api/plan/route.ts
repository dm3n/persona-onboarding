import { gateway } from "@ai-sdk/gateway";
import { generateObject } from "ai";
import { z } from "zod";

import { coerceProfile } from "@/lib/onboarding/slots";

export const runtime = "nodejs";
export const maxDuration = 30;

const PlanSchema = z.object({
  opening: z
    .string()
    .max(140)
    .describe(
      "One sentence in the agent's own voice about where it will start.",
    ),
  steps: z
    .array(
      z.object({
        title: z.string().max(60).describe("Three to six words, verb first."),
        detail: z
          .string()
          .max(120)
          .describe("One short sentence about what that actually involves."),
      }),
    )
    .length(3),
});

export type Plan = z.infer<typeof PlanSchema>;

export async function POST(req: Request) {
  const profile = coerceProfile(
    ((await req.json()) as { profile?: unknown })?.profile,
  );
  const need = profile.slots.need.value;
  const user = profile.slots.userName.value;
  const agent = profile.slots.agentName.value ?? "Persona";
  const gmail = profile.slots.gmail.value;

  const fallback: Plan = {
    opening: need
      ? `Here is where I would start on ${need.toLowerCase()}.`
      : "Here is where I would start once you point me at something.",
    steps: need
      ? [
          {
            title: "Map what is already there",
            detail:
              "Read the last few weeks and work out what actually matters.",
          },
          {
            title: "Draft the first pass",
            detail: "You get something to react to instead of a blank page.",
          },
          {
            title: "Hold the thread",
            detail: "Chase what goes quiet so you do not have to remember to.",
          },
        ]
      : [
          {
            title: "Learn how you work",
            detail: "Watch a normal week before changing anything about it.",
          },
          {
            title: "Clear the small stuff",
            detail: "Handle the replies that only need a yes or a no.",
          },
          {
            title: "Flag what needs you",
            detail:
              "Surface the few things that genuinely need your judgement.",
          },
        ],
  };

  if (!need) {
    return Response.json(fallback);
  }

  try {
    const { object } = await generateObject({
      model: gateway(process.env.PERSONA_MODEL || "openai/gpt-4.1-mini"),
      schema: PlanSchema,
      temperature: 0.7,
      abortSignal: AbortSignal.timeout(20_000),
      providerOptions: {
        gateway: { models: ["openai/gpt-4o-mini", "openai/gpt-4.1"] },
      },
      system: `You are ${agent}, a personal AI that has just finished being set up${user ? ` by ${user}` : ""}.
Write the first three things you will do about the job they handed you. Be concrete and specific to what they said, never generic productivity advice.
Speak to them directly as "you" and "your". Never write their name in the third person and never quote their email address back at them.
Rules: no em dashes, no exclamation marks, no corporate filler. Titles are three to six words and start with a verb. Details are one plain sentence.
${gmail ? "You have access to their inbox, so steps may involve their mail." : "You have no inbox access yet, so do not claim to read their mail."}
Never claim to have already done anything.`,
      prompt: `What they want help with: ${need}`,
    });
    return Response.json(object);
  } catch (err) {
    console.error("[plan] failed", err);
    return Response.json(fallback);
  }
}
