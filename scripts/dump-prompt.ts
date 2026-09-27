/**
 * Prints the system prompt for a given state.
 *
 * The prompt is rebuilt from the profile on every turn, so the fastest way to
 * work out why the agent said something odd is to look at what it was told.
 *
 *   pnpm dlx tsx --tsconfig tsconfig.json scripts/dump-prompt.ts
 */
import { readIntent } from "@/lib/onboarding/intent";
import { buildSystemPrompt } from "@/lib/onboarding/prompt";
import { newProfile } from "@/lib/onboarding/slots";

const profile = newProfile();
profile.phase = "chat";
profile.slots.agentName.value = "Ada";

console.log(
  buildSystemPrompt({
    profile,
    channel: "chat",
    intent: readIntent("I'm Daniel"),
    offerCallNow: true,
  }),
);
