/**
 * The onboarding contract.
 *
 * Four facts have to exist before a Persona is usable. Everything else in this
 * app is in service of collecting them without it feeling like a form.
 */
export const SLOT_IDS = ["agentName", "userName", "gmail", "need"] as const;
export type SlotId = (typeof SLOT_IDS)[number];

/** How a slot came to be filled. Used for recovery messaging and analytics. */
export type SlotSource = "chat" | "voice" | "oauth" | "restored";

export type SlotState = {
  value: string | null;
  /** The user explicitly declined this one. We stop asking. */
  declined: boolean;
  /** How many times we have asked. Guards against badgering. */
  asks: number;
  source?: SlotSource;
};

export type Phase =
  /** Nothing collected, nothing said. */
  | "welcome"
  /** Actively collecting over text. */
  | "chat"
  /** A call is ringing, live, or winding down. */
  | "call"
  /** Everything we are going to get, we have. */
  | "ready";

export type CallOutcome =
  "completed" | "declined" | "hungup" | "abandoned" | "failed" | "no_mic";

export type Profile = {
  version: 3;
  phase: Phase;
  slots: Record<SlotId, SlotState>;
  /** Freeform notes the agent chose to remember about the user. */
  notes: string[];
  /** Call attempts so far, with how each one ended. */
  callHistory: { at: number; outcome: CallOutcome; secs: number }[];
  /** True once the user has been offered a call at all. */
  callOffered: boolean;
  /** The user said "no calls". Never offer again. */
  callRefused: boolean;
  /** User asked to skip ahead. Lower the bar for graduating. */
  wantsToSkip: boolean;
  startedAt: number;
  finishedAt?: number;
};

export type Role = "assistant" | "user" | "system";

export type MessageKind =
  "text" | "gmail-card" | "call-summary" | "system-note";

export type Message = {
  id: string;
  role: Role;
  kind: MessageKind;
  text: string;
  at: number;
  /** Spoken during a call rather than typed. */
  viaVoice?: boolean;
  /** Payload for non-text message kinds. */
  data?: Record<string, unknown>;
  /** Quick replies offered alongside this message. */
  suggestions?: string[];
  pending?: boolean;
  errored?: boolean;
};

/** Events the client reports to the server so the agent can react in character. */
export type TurnEvent =
  | { type: "open" }
  | { type: "resume"; awayMs: number }
  | { type: "call_accepted" }
  | { type: "call_declined" }
  | { type: "call_ended"; outcome: CallOutcome; secs: number }
  | { type: "call_failed"; reason: string }
  | { type: "call_silence"; strikes: number }
  | { type: "gmail_connected"; email: string }
  | { type: "gmail_dismissed" };

/** Server actions streamed back to the client. */
export type TurnAction =
  | { kind: "offer_call" }
  | { kind: "place_call" }
  | { kind: "end_call"; reason?: string }
  | { kind: "gmail_connect" }
  | { kind: "graduate" };

export type StreamLine =
  | { t: "delta"; v: string }
  | { t: "patch"; v: Partial<Record<SlotId, string>> & { notes?: string[] } }
  | { t: "declined"; v: SlotId[] }
  | { t: "action"; v: TurnAction }
  | { t: "suggestions"; v: string[] }
  | { t: "error"; v: string }
  | { t: "done" };

export const SLOT_LABEL: Record<SlotId, string> = {
  agentName: "Agent name",
  userName: "Your name",
  gmail: "Gmail",
  need: "First job",
};

export const SLOT_HINT: Record<SlotId, string> = {
  agentName: "What you'll call it",
  userName: "What it calls you",
  gmail: "So it can read the room",
  need: "Where to start",
};
