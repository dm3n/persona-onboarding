import {
  SLOT_IDS,
  type CallOutcome,
  type Profile,
  type SlotId,
  type SlotState,
} from "./types";

export function emptySlot(): SlotState {
  return { value: null, declined: false, asks: 0 };
}

export function newProfile(): Profile {
  return {
    version: 3,
    phase: "welcome",
    slots: {
      agentName: emptySlot(),
      userName: emptySlot(),
      gmail: emptySlot(),
      need: emptySlot(),
    },
    notes: [],
    callHistory: [],
    callOffered: false,
    callRefused: false,
    wantsToSkip: false,
    startedAt: Date.now(),
  };
}

/* ------------------------------------------------------------------ *
 * Normalisation
 *
 * Everything the model hands us is treated as a suggestion. These
 * functions are the only way a value reaches the profile, so a confused
 * model cannot write "I'm not sure, maybe Alex?" into the name field.
 * ------------------------------------------------------------------ */

const LEADING_JUNK =
  /^(?:ok(?:ay)?|well|um+|uh+|hi|hey|hello|so|yeah|yes|sure|please|just|i(?:'m| am)?|my name(?:'s| is)?|call (?:me|it|you|him|her|them)|you(?:'re| are)|your name(?:'s| is)?|it(?:'s| is)?|this is|the name(?:'s| is)?|name(?:'s| is)?|let(?:'s| us) (?:go with|call (?:it|you)|name (?:it|her|him|you))|go with|name (?:it|her|him|you|yourself)|we can call (?:it|him|her|you)|how about|maybe|lets|let's)\b[\s,.:-]*/i;

function stripJunk(input: string): string {
  let out = input.trim();
  for (let i = 0; i < 6; i++) {
    const next = out.replace(LEADING_JUNK, "").trim();
    if (next === out) break;
    out = next;
  }
  return out;
}

const NAME_STOPWORDS = new Set([
  "i",
  "me",
  "you",
  "it",
  "the",
  "a",
  "an",
  "and",
  "but",
  "no",
  "yes",
  "yeah",
  "nope",
  "nah",
  "skip",
  "none",
  "nothing",
  "anything",
  "whatever",
  "idk",
  "dunno",
  "unknown",
  "n/a",
  "na",
  "null",
  "undefined",
  "user",
  "assistant",
  "persona",
  "agent",
  "bot",
]);

/**
 * Names are one to three short words. Anything sentence-shaped is rejected so
 * a mis-parse ends up as "ask again" rather than a nonsense profile.
 */
export function normalizeName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let v = stripJunk(String(raw))
    .replace(/["'`“”‘’]/g, "")
    .replace(/[.!?,;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!v) return null;
  if (v.length > 40) return null;

  // Letters, marks, digits and the punctuation real names contain. Anything
  // else means we are looking at a sentence or at keyboard mashing.
  if (/[^\p{L}\p{M}0-9'\u2019\-. ]/u.test(v)) return null;

  const words = v.split(" ");
  if (words.length > 3) return null;
  if (words.some((w) => w.length > 20)) return null;
  if (!/\p{L}/u.test(v)) return null;
  // At least one word has to actually be a word.
  if (!words.some((w) => /^[\p{L}\p{M}'\u2019-]{2,}$/u.test(w))) return null;
  // Reject bare filler and obvious non-answers.
  if (words.every((w) => NAME_STOPWORDS.has(w.toLowerCase()))) return null;
  // Reject anything that reads like a sentence fragment with a verb we know.
  if (/\b(?:don'?t|doesn'?t|won'?t|can'?t|not|never|rather|prefer)\b/i.test(v))
    return null;

  v = words
    .map((w) => {
      if (/^[\p{Lu}0-9.]{2,}$/u.test(w)) return w; // keep acronyms like "AJ"
      if (w.includes("-")) {
        return w
          .split("-")
          .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
          .join("-");
      }
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ");
  return v;
}

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

/**
 * Speech recognition renders addresses as "daniel dot edgar at gmail dot com",
 * sometimes with spaces inside the local part. This puts them back together.
 */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let v = String(raw).trim().toLowerCase();

  v = v
    .replace(/[<>(),;"'`]/g, " ")
    .replace(/\bunderscore\b|\bunder score\b/g, "_")
    .replace(/\bdash\b|\bhyphen\b|\bminus\b/g, "-")
    .replace(/\bplus\b/g, "+")
    .replace(/\s+at sign\s+|\s+at\s+|\s*@\s*/g, "@")
    .replace(/\s*(?:dot|period|point)\s*/g, ".")
    .replace(/\s+/g, "")
    .replace(/\.+/g, ".")
    .replace(/^[.@]+|[.@]+$/g, "");

  // "danielgmail.com" -> unrecoverable; require exactly one @.
  const at = v.split("@");
  if (at.length !== 2) return null;
  if (!EMAIL_RE.test(v)) return null;
  if (v.length > 254) return null;
  return v;
}

export function isGmailAddress(email: string): boolean {
  return /@(?:gmail\.com|googlemail\.com)$/i.test(email);
}

const NEED_LEAD =
  /^(?:i(?:'?d)?\s+(?:really\s+)?(?:need|want|would like|could use)\s+(?:some\s+)?help\s+(?:with\s+|on\s+)?|help\s+me\s+(?:with\s+)?|i\s+need\s+|i\s+want\s+|can you\s+(?:help\s+me\s+)?(?:with\s+)?|please\s+)/i;

/** "help staying on top of X" reads better stored as "staying on top of X". */
const NEED_BARE_HELP = /^help\s+(?=\w+ing\b)/i;

/**
 * The "what do you need help with" slot.
 *
 * Stored the way it will be read back in a summary, so the preamble people
 * naturally speak gets trimmed off the front.
 */
export function normalizeNeed(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let v = String(raw).replace(/\s+/g, " ").trim();
  const trimmed = v.replace(NEED_LEAD, "").replace(NEED_BARE_HELP, "").trim();
  if (trimmed.length >= 3) v = trimmed;
  if (!v) return null;
  if (v.length < 3) return null;
  if (v.length > 400) v = `${v.slice(0, 397).trimEnd()}...`;
  const bare = v.toLowerCase().replace(/[^a-z]/g, "");
  if (!bare) return null;
  if (
    ["idk", "dunno", "nothing", "none", "na", "unsure", "notsure"].includes(
      bare,
    )
  )
    return null;
  return v;
}

export function normalizeSlot(id: SlotId, raw: string | null | undefined) {
  switch (id) {
    case "agentName":
    case "userName":
      return normalizeName(raw);
    case "gmail":
      return normalizeEmail(raw);
    case "need":
      return normalizeNeed(raw);
  }
}

/* ------------------------------------------------------------------ *
 * Progress
 * ------------------------------------------------------------------ */

export function filled(p: Profile, id: SlotId): boolean {
  return Boolean(p.slots[id].value);
}

export function settled(p: Profile, id: SlotId): boolean {
  return Boolean(p.slots[id].value) || p.slots[id].declined;
}

export function missingSlots(p: Profile): SlotId[] {
  return SLOT_IDS.filter((id) => !settled(p, id));
}

export function collectedCount(p: Profile): number {
  return SLOT_IDS.filter((id) => filled(p, id)).length;
}

/** Everything a call can collect. The agent's own name is chosen in the app. */
export const CALL_SLOTS: SlotId[] = ["userName", "gmail", "need"];

export function callWouldHelp(p: Profile): boolean {
  if (p.callRefused) return false;
  return CALL_SLOTS.some((id) => !settled(p, id));
}

/**
 * The bar for finishing.
 *
 * Normally: every slot is either answered or explicitly declined. If the user
 * has asked to move on, an agent name plus one more real answer is enough,
 * because holding someone hostage to a form is the failure mode we care about.
 */
export function canGraduate(p: Profile): boolean {
  if (missingSlots(p).length === 0) return true;
  if (!p.wantsToSkip) return false;
  return filled(p, "agentName") && collectedCount(p) >= 2;
}

/** The single thing to steer toward next, or null if we are done. */
export function nextSlot(p: Profile): SlotId | null {
  const order: SlotId[] = ["agentName", "userName", "need", "gmail"];
  for (const id of order) if (!settled(p, id)) return id;
  return null;
}

export function displayAgentName(p: Profile): string {
  return p.slots.agentName.value || "your Persona";
}

export function callSummary(p: Profile): string {
  const last = p.callHistory[p.callHistory.length - 1];
  if (!last) return "";
  const mm = Math.floor(last.secs / 60);
  const ss = last.secs % 60;
  const dur = `${mm}:${String(ss).padStart(2, "0")}`;
  const label: Record<CallOutcome, string> = {
    completed: "Call ended",
    declined: "Call declined",
    hungup: "Call ended early",
    abandoned: "Call dropped",
    failed: "Call failed",
    no_mic: "Call ended",
  };
  return `${label[last.outcome]} · ${dur}`;
}

/* ------------------------------------------------------------------ *
 * Persistence
 * ------------------------------------------------------------------ */

/** Rebuilds a profile from untrusted input (localStorage or a POST body). */
export function coerceProfile(input: unknown): Profile {
  const base = newProfile();
  if (!input || typeof input !== "object") return base;
  const raw = input as Record<string, unknown>;

  const slots = { ...base.slots };
  const rawSlots = (raw.slots ?? {}) as Record<string, unknown>;
  for (const id of SLOT_IDS) {
    const s = rawSlots[id] as Record<string, unknown> | undefined;
    if (!s || typeof s !== "object") continue;
    const value = normalizeSlot(
      id,
      typeof s.value === "string" ? s.value : null,
    );
    slots[id] = {
      value,
      declined: s.declined === true,
      asks: Math.min(Number(s.asks) || 0, 99),
      source:
        typeof s.source === "string"
          ? (s.source as SlotState["source"])
          : undefined,
    };
  }

  const phases = ["welcome", "chat", "call", "ready"] as const;
  const phase = phases.includes(raw.phase as (typeof phases)[number])
    ? (raw.phase as Profile["phase"])
    : "welcome";

  const notes = Array.isArray(raw.notes)
    ? raw.notes
        .filter((n): n is string => typeof n === "string")
        .map((n) => n.slice(0, 240))
        .slice(-8)
    : [];

  const callHistory = Array.isArray(raw.callHistory)
    ? raw.callHistory
        .filter((c): c is { at: number; outcome: CallOutcome; secs: number } =>
          Boolean(c && typeof c === "object"),
        )
        .slice(-6)
    : [];

  return {
    version: 3,
    phase,
    slots,
    notes,
    callHistory,
    callOffered: raw.callOffered === true,
    callRefused: raw.callRefused === true,
    wantsToSkip: raw.wantsToSkip === true,
    startedAt: Number(raw.startedAt) || base.startedAt,
    finishedAt: typeof raw.finishedAt === "number" ? raw.finishedAt : undefined,
  };
}
