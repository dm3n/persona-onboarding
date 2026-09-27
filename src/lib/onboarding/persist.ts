"use client";

import { coerceProfile, newProfile } from "./slots";
import type { Message, Profile } from "./types";

const KEY = "persona.onboarding.v3";

export type Saved = { profile: Profile; messages: Message[]; savedAt: number };

export function load(): Saved | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Saved>;
    const profile = coerceProfile(parsed.profile);
    const messages = Array.isArray(parsed.messages)
      ? parsed.messages
          .filter(
            (m): m is Message =>
              Boolean(m) &&
              typeof m === "object" &&
              typeof (m as Message).text === "string",
          )
          .slice(-80)
          .map((m) => ({ ...m, pending: false }))
      : [];
    if (!messages.length) return null;
    return { profile, messages, savedAt: Number(parsed.savedAt) || Date.now() };
  } catch {
    return null;
  }
}

export function save(profile: Profile, messages: Message[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        profile,
        messages: messages.filter((m) => !m.pending).slice(-80),
        savedAt: Date.now(),
      }),
    );
  } catch {
    /* private mode, or quota. Losing the transcript is survivable. */
  }
}

export function clear() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

export { newProfile };
