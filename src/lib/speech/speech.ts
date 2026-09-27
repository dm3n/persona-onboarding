"use client";

/**
 * Browser speech, defensively wrapped.
 *
 * Web Speech is uneven: Chrome has both halves, Safari has synthesis and a
 * flaky recogniser, Firefox has neither. Every entry point here reports what it
 * can do so the call UI can degrade to typing instead of breaking.
 */

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  onspeechstart: (() => void) | null;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<
    ArrayLike<{ transcript: string; confidence: number }> & { isFinal: boolean }
  >;
};

type RecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function canListen(): boolean {
  return getRecognitionCtor() !== null;
}

export function canSpeak(): boolean {
  // The property can exist and still be unusable, which is how a call ends up
  // throwing on the first cancel() instead of falling back to captions.
  return (
    typeof window !== "undefined" &&
    typeof window.speechSynthesis?.speak === "function" &&
    typeof window.speechSynthesis?.cancel === "function" &&
    typeof window.SpeechSynthesisUtterance === "function"
  );
}

export type ListenerHandlers = {
  onPartial(text: string): void;
  onFinal(text: string): void;
  onError(
    kind: "denied" | "no-speech" | "network" | "other",
    raw: string,
  ): void;
  onEnd(): void;
};

/**
 * A restarting recogniser.
 *
 * Chrome ends a recognition session on its own every few seconds and after
 * every final result. Left alone that looks like the microphone died mid
 * sentence, so this restarts until it is told to stop.
 */
export class Listener {
  private rec: SpeechRecognitionLike | null = null;
  private wantRunning = false;
  private running = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private muted = false;

  constructor(private handlers: ListenerHandlers) {}

  get supported() {
    return getRecognitionCtor() !== null;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
  }

  start() {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      this.handlers.onError("other", "unsupported");
      return;
    }
    this.wantRunning = true;
    if (this.running) return;

    const rec = new Ctor();
    rec.lang = navigator.language || "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      this.running = true;
    };

    rec.onresult = (event) => {
      if (this.muted) return;
      let partial = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) {
          const clean = text.trim();
          if (clean) this.handlers.onFinal(clean);
        } else {
          partial += text;
        }
      }
      if (partial.trim()) this.handlers.onPartial(partial.trim());
    };

    rec.onerror = (e) => {
      const err = e?.error ?? "other";
      if (err === "not-allowed" || err === "service-not-allowed") {
        this.wantRunning = false;
        this.handlers.onError("denied", err);
      } else if (err === "no-speech") {
        this.handlers.onError("no-speech", err);
      } else if (err === "network") {
        this.handlers.onError("network", err);
      } else if (err !== "aborted") {
        this.handlers.onError("other", err);
      }
    };

    rec.onend = () => {
      this.running = false;
      if (this.wantRunning) {
        // Back off a touch so a hard failure cannot spin.
        this.restartTimer = setTimeout(() => {
          if (this.wantRunning) {
            try {
              rec.start();
              this.running = true;
            } catch {
              /* already started, or torn down */
            }
          }
        }, 220);
      } else {
        this.handlers.onEnd();
      }
    };

    this.rec = rec;
    try {
      rec.start();
    } catch {
      /* Chrome throws if start() races a previous session. onend retries. */
    }
  }

  stop() {
    this.wantRunning = false;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    try {
      this.rec?.abort();
    } catch {
      /* nothing to abort */
    }
    this.running = false;
    this.rec = null;
  }
}

/* ------------------------------------------------------------------ *
 * Synthesis
 * ------------------------------------------------------------------ */

let voicesCache: SpeechSynthesisVoice[] = [];

export function primeVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!canSpeak() || typeof window.speechSynthesis.getVoices !== "function")
    return Promise.resolve([]);
  const existing = window.speechSynthesis.getVoices();
  if (existing.length) {
    voicesCache = existing;
    return Promise.resolve(existing);
  }
  return new Promise((resolve) => {
    const done = () => {
      voicesCache = window.speechSynthesis.getVoices();
      resolve(voicesCache);
    };
    window.speechSynthesis.addEventListener("voiceschanged", done, {
      once: true,
    });
    setTimeout(done, 1200);
  });
}

/** Prefers a natural local English voice over the robotic defaults. */
export function pickVoice(): SpeechSynthesisVoice | null {
  const voices = voicesCache.length
    ? voicesCache
    : canSpeak() && typeof window.speechSynthesis.getVoices === "function"
      ? window.speechSynthesis.getVoices()
      : [];
  if (!voices.length) return null;
  const english = voices.filter((v) => /^en(-|_|$)/i.test(v.lang));
  const pool = english.length ? english : voices;
  const preferred = [
    "Samantha",
    "Google US English",
    "Microsoft Aria",
    "Microsoft Jenny",
    "Ava",
    "Serena",
    "Karen",
    "Moira",
    "Daniel",
  ];
  for (const name of preferred) {
    const hit = pool.find((v) => v.name.includes(name));
    if (hit) return hit;
  }
  return pool.find((v) => v.localService) ?? pool[0];
}

export type SpeakHandle = { cancel(): void };

/**
 * Speaks a line and resolves when it finishes or is cancelled.
 *
 * Long strings are split on sentence boundaries: Chrome truncates utterances
 * past roughly fifteen seconds, and shorter chunks also let a hangup cut the
 * agent off mid thought the way a real one would.
 */
export function speak(
  text: string,
  opts: { onStart?: () => void; onDone?: () => void; rate?: number } = {},
): SpeakHandle {
  if (!canSpeak() || !text.trim()) {
    opts.onDone?.();
    return { cancel() {} };
  }
  const synth = window.speechSynthesis;
  synth.cancel();

  const chunks = splitForSpeech(text);
  const voice = pickVoice();
  let cancelled = false;
  let index = 0;
  let started = false;

  const next = () => {
    if (cancelled) return;
    if (index >= chunks.length) {
      opts.onDone?.();
      return;
    }
    const u = new SpeechSynthesisUtterance(chunks[index++]);
    if (voice) u.voice = voice;
    u.rate = opts.rate ?? 1.04;
    u.pitch = 1;
    u.volume = 1;
    u.onstart = () => {
      if (!started) {
        started = true;
        opts.onStart?.();
      }
    };
    u.onend = () => next();
    u.onerror = () => next();
    synth.speak(u);
  };

  // Chrome occasionally leaves the queue paused after a cancel.
  try {
    synth.resume();
  } catch {
    /* not paused */
  }
  next();

  return {
    cancel() {
      cancelled = true;
      try {
        synth.cancel();
      } catch {
        /* nothing queued */
      }
    },
  };
}

export function splitForSpeech(text: string): string[] {
  const clean = text
    .replace(/\*\*/g, "")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const parts = clean.match(/[^.!?]+[.!?]*/g) ?? [clean];
  const out: string[] = [];
  let buf = "";
  for (const part of parts) {
    if ((buf + part).length > 180) {
      if (buf.trim()) out.push(buf.trim());
      buf = part;
    } else {
      buf += part;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter(Boolean);
}

export function stopSpeaking() {
  if (canSpeak()) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* nothing queued */
    }
  }
}
