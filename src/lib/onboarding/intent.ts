/**
 * Deterministic intent detection.
 *
 * The model handles nuance. These patterns handle the cases where being wrong
 * is expensive: someone asking to be left alone, someone asking to skip, and
 * someone asking for or refusing a call. They run on every user turn regardless
 * of what the model decides, so the guarantees hold even if a turn fails.
 */

const RE = {
  skip: /\b(?:skip(?: this| all| ahead| it)?|move on|next|get on with it|hurry|speed (?:this )?up|just (?:let me in|start|go|get started|show me)|can we (?:move|get) on|i(?:'m| am) good|that'?s enough|enough (?:questions|of this)|stop asking|no more questions|i know what i (?:need|want)|take me (?:to|in)|let'?s go|finish|done|wrap (?:it )?up|end onboarding)\b/i,
  refuse:
    /\b(?:no thanks|no thank you|rather not|prefer not|not (?:comfortable|giving|sharing|telling)|won'?t (?:give|share|tell)|don'?t want to (?:give|share|say|tell)|none of your business|not sharing|keep that private|pass on that|skip (?:that|the) (?:one|question)|leave (?:that|it) blank|i(?:'ll)? pass)\b/i,
  callYes:
    /\b(?:call me|give me a (?:call|ring)|ring me|let'?s (?:do the |hop on a |jump on a )?call|sure,? call|do the call|voice|talk (?:it )?(?:out|through)|i'?d rather (?:talk|speak)|phone me|yes,? call)\b/i,
  callNo:
    /\b(?:no call|don'?t call|do not call|can'?t (?:talk|speak)|not (?:a )?(?:good time|now) (?:for|to) (?:a )?(?:call|talk)|rather (?:type|text|chat|write)|prefer (?:to )?(?:type|text|chat|writing)|just (?:type|text|chat)|keep it (?:to )?(?:text|typing|chat)|no (?:phone|voice|talking)|hate (?:calls|phone)|text (?:is )?(?:fine|better)|i'?m (?:in public|on a train|at work|in an office))\b/i,
  restart:
    /^\s*(?:\/?(?:restart|reset|start over|new persona|clear)|begin again)\s*[.!]?\s*$/i,
  greeting:
    /^\s*(?:hi|hey|hello|yo|sup|hiya|howdy|good (?:morning|afternoon|evening))\b[\s!.,]*$/i,
} as const;

import type { SlotId } from "./types";

export type UserIntent = {
  wantsSkip: boolean;
  refuses: boolean;
  wantsCall: boolean;
  refusesCall: boolean;
  wantsRestart: boolean;
  isBareGreeting: boolean;
};

export function readIntent(text: string): UserIntent {
  const t = (text || "").slice(0, 2000);
  return {
    wantsSkip: RE.skip.test(t),
    refuses: RE.refuse.test(t),
    wantsCall: RE.callYes.test(t),
    refusesCall: RE.callNo.test(t),
    wantsRestart: RE.restart.test(t),
    isBareGreeting: RE.greeting.test(t),
  };
}

/**
 * Which slot a message is about.
 *
 * Used to aim a refusal and the rescue pass at the thing that was actually
 * asked, rather than at whatever happens to be next in the default order.
 * Reading the agent's own last question is far more reliable than that order,
 * because conversations wander.
 */
export function slotInMessage(text: string): SlotId | null {
  const t = (text || "").toLowerCase();
  if (/\b(?:g[\s-]?mail|email|e-mail|inbox account|address|@)\b/.test(t))
    return "gmail";
  if (
    /\b(?:what should i call you|your name|who am i (?:talking|speaking) to|what do you go by|call you)\b/.test(
      t,
    )
  )
    return "userName";
  if (
    /\b(?:call me|name me|what (?:do you want to |should i )?call me|my name)\b/.test(
      t,
    )
  )
    return "agentName";
  if (
    /\b(?:off your plate|help with|working on|take care of|first job|what should i (?:do|start)|hand off|struggling)\b/.test(
      t,
    )
  )
    return "need";
  return null;
}

const MENTIONS: Record<SlotId, RegExp> = {
  agentName: /\b(?:call me|name me|my name)\b/i,
  userName: /\b(?:call you|your name|go by)\b/i,
  // "inbox" is left out on purpose: it turns up constantly in need-talk
  // ("my inbox is a disaster") and reading it as an email question is wrong.
  gmail: /\b(?:g[\s-]?mail|email|e-mail|connect|address)\b|@/i,
  need: /\b(?:help with|off your plate|take on|start with|first job|working on|hand(?:ed)? (?:me|off))\b/i,
};

/** Whether a reply already deals with a slot, however it is phrased. */
export function mentionsSlot(text: string, slot: SlotId): boolean {
  return MENTIONS[slot].test(text || "");
}

/**
 * Narrowly, is this reply asking for the email account?
 *
 * Used where a false positive costs a whole interaction, so it will not fire
 * on "connect" or "address" the way the looser check above does.
 */
export function asksForEmail(text: string): boolean {
  return /\b(?:g[\s-]?mail|e-?mail)\b|@/i.test(text || "");
}

/**
 * Last-resort extraction for when a model turn fails entirely. Deliberately
 * conservative: it only fires on unambiguous shapes.
 */
export function salvage(text: string): {
  email?: string;
  name?: string;
} {
  const out: { email?: string; name?: string } = {};
  const email = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  if (email) out.email = email[0];
  const name = text.match(
    /\b(?:my name(?:'s| is)|i'?m|i am|call me|this is)\s+([A-Za-z][A-Za-z'’-]{1,19})(?:\s|$|[.,!])/i,
  );
  if (name) out.name = name[1];
  return out;
}
