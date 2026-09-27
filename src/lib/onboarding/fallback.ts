import { displayAgentName, missingSlots, nextSlot } from "./slots";
import type { Profile, SlotId } from "./types";

/**
 * What the agent says when the model is unreachable or errors.
 *
 * The onboarding still works with the network on fire: these lines keep the
 * conversation moving and the deterministic slot parsing keeps recording
 * answers. It is duller than the real thing, and it never dead ends.
 */
const ASK: Record<SlotId, string[]> = {
  agentName: [
    "What do you want to call me?",
    "Still need a name. What are you calling me?",
  ],
  userName: ["And what should I call you?", "What is your name?"],
  need: [
    "What is one thing you would hand off today if you could?",
    "What should I take off your plate first?",
  ],
  gmail: [
    "Last thing, hook up your Gmail and I can actually get to work.",
    "Connect Gmail when you are ready and I will take it from there.",
  ],
};

export function fallbackReply(profile: Profile, offline: boolean): string {
  const next = nextSlot(profile);
  const lead = offline ? "I lost the thread for a second. " : "";
  if (!next) {
    const name = displayAgentName(profile);
    return `${lead}That is everything I need. ${name} is ready when you are.`;
  }
  const options = ASK[next];
  const pick = options[profile.slots[next].asks % options.length];
  return `${lead}${pick}`;
}

export function fallbackSuggestions(profile: Profile): string[] {
  const next = nextSlot(profile);
  if (!next) return [];
  if (next === "agentName") return ["Ada", "Scout", "You pick"];
  if (next === "gmail") return ["Connect Gmail", "Skip for now"];
  if (next === "need") return ["My inbox", "Scheduling", "Follow-ups"];
  return [];
}

export function readyLine(profile: Profile): string {
  const name = displayAgentName(profile);
  const who = profile.slots.userName.value;
  const left = missingSlots(profile);
  const tail = left.length
    ? " You can fill in the rest from settings whenever you want."
    : "";
  return `${who ? `${who}, ` : ""}${name} is ready.${tail}`;
}
