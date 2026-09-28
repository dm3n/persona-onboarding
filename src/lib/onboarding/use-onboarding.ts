"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  Listener,
  canListen,
  canSpeak,
  primeVoices,
  speak,
  splitForSpeech,
  stopSpeaking,
  type SpeakHandle,
} from "@/lib/speech/speech";

import { runTurn } from "./client";
import { readIntent } from "./intent";
import * as persist from "./persist";
import { OPENING_MESSAGE } from "./prompt";
import {
  callSummary,
  canGraduate,
  collectedCount,
  missingSlots,
  newProfile,
  nextSlot,
} from "./slots";
import type {
  CallOutcome,
  Message,
  Profile,
  SlotId,
  StageId,
  TurnAction,
  TurnEvent,
} from "./types";

/** How long the agent waits on a silent line before checking in. */
const SILENCE_MS = 7500;
/** Hidden tab for longer than this during a call counts as walking away. */
const ABANDON_MS = 25_000;
/** Nobody picked up. */
const RING_MS = 22_000;

export type CallStatus = "idle" | "ringing" | "connecting" | "live" | "ended";

export type CallState = {
  status: CallStatus;
  startedAt: number | null;
  secs: number;
  agentSpeaking: boolean;
  listening: boolean;
  muted: boolean;
  textMode: boolean;
  micDenied: boolean;
  partial: string;
  notice: string | null;
  silenceStrikes: number;
};

const IDLE_CALL: CallState = {
  status: "idle",
  startedAt: null,
  secs: 0,
  agentSpeaking: false,
  listening: false,
  muted: false,
  textMode: false,
  micDenied: false,
  partial: "",
  notice: null,
  silenceStrikes: 0,
};

function uid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto)
    return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type LateBound = {
  drain: () => void;
  handOver: () => void;
  startCall: () => void;
  endCall: (outcome: CallOutcome) => void;
  runTurn: (opts: {
    channel: "chat" | "voice";
    event?: TurnEvent;
    history?: Message[];
  }) => void;
};

function noop() {}

/** The opening: a line, then the agent itself, waiting to be named. */
function openingMessages(): Message[] {
  const at = Date.now();
  return [
    {
      id: uid(),
      role: "assistant",
      kind: "text",
      text: OPENING_MESSAGE,
      at,
    },
    {
      id: uid(),
      role: "assistant",
      kind: "stage",
      text: "",
      at: at + 1,
      data: { stageId: "name", status: "active" },
    },
  ];
}

export function useOnboarding() {
  const [profile, setProfileState] = useState<Profile>(() => ({
    ...newProfile(),
    phase: "chat",
  }));
  const [messages, setMessagesState] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [call, setCallState] = useState<CallState>(IDLE_CALL);
  const [gmailOpen, setGmailOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  /*
   * Every piece of state has a ref that is written synchronously.
   *
   * Turns, speech callbacks and timers all run outside React's render cycle
   * and need to see the truth immediately. Reading `profile` from a closure
   * that was created one render ago is how a call ends up talking to itself.
   */
  const profileRef = useRef(profile);
  const messagesRef = useRef(messages);
  const callRef = useRef(call);
  const busyRef = useRef(busy);

  const abortRef = useRef<AbortController | null>(null);
  const speakRef = useRef<SpeakHandle | null>(null);
  const listenerRef = useRef<Listener | null>(null);
  const silenceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hiddenSinceRef = useRef<number | null>(null);
  const gmailShownRef = useRef(false);
  const stagesShownRef = useRef<Set<StageId>>(new Set());
  const speechQueue = useRef<{ text: string; last: boolean }[]>([]);
  const speakingRef = useRef(false);
  const turnSeq = useRef(0);

  const setProfile = useCallback(
    (update: Profile | ((prev: Profile) => Profile)) => {
      const next =
        typeof update === "function"
          ? (update as (p: Profile) => Profile)(profileRef.current)
          : update;
      profileRef.current = next;
      setProfileState(next);
      return next;
    },
    [],
  );

  const setMessages = useCallback(
    (update: Message[] | ((prev: Message[]) => Message[])) => {
      const next =
        typeof update === "function"
          ? (update as (m: Message[]) => Message[])(messagesRef.current)
          : update;
      messagesRef.current = next;
      setMessagesState(next);
      return next;
    },
    [],
  );

  const setCall = useCallback(
    (update: CallState | ((prev: CallState) => CallState)) => {
      const next =
        typeof update === "function"
          ? (update as (c: CallState) => CallState)(callRef.current)
          : update;
      callRef.current = next;
      setCallState(next);
      return next;
    },
    [],
  );

  const markBusy = useCallback((value: boolean) => {
    busyRef.current = value;
    setBusy(value);
  }, []);

  /* -------------------------------------------------------------- *
   * Hydrate and persist
   * -------------------------------------------------------------- */
  // localStorage cannot be read while rendering on the server, so the restore
  // has to happen once the client is alive.
  useEffect(() => {
    const saved = persist.load();
    if (saved) {
      // A call cannot survive a reload. Land back in chat and pick up there.
      setProfile({
        ...saved.profile,
        phase: saved.profile.phase === "call" ? "chat" : saved.profile.phase,
      });
      setMessages(saved.messages);
      gmailShownRef.current = saved.messages.some(
        (m) => m.kind === "gmail-card",
      );
      for (const m of saved.messages) {
        const id = (m.data as { stageId?: StageId } | undefined)?.stageId;
        if (id) stagesShownRef.current.add(id);
      }
    } else {
      setMessages(openingMessages());
    }
    // localStorage is not readable during render, so the one place this hook
    // sets state from an effect is the restore on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHydrated(true);
    void primeVoices();
  }, [setMessages, setProfile]);

  useEffect(() => {
    if (!hydrated) return;
    persist.save(profile, messages);
  }, [profile, messages, hydrated]);

  const patchMessage = useCallback(
    (id: string, patch: Partial<Message>) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, ...patch } : m)),
      );
    },
    [setMessages],
  );

  /* -------------------------------------------------------------- *
   * Speech out
   * -------------------------------------------------------------- */
  const clearSilence = useCallback(() => {
    if (silenceRef.current) clearTimeout(silenceRef.current);
    silenceRef.current = null;
  }, []);

  /**
   * Late bound handles.
   *
   * The call loop is genuinely circular: speaking hands over to listening,
   * listening starts a turn, a turn can end the call, ending the call starts
   * another turn. Rather than hoist everything into one unreadable function,
   * the cycle is broken here and closed in an effect below.
   */
  const fns = useRef<LateBound>({
    drain: noop,
    handOver: noop,
    startCall: noop,
    endCall: noop,
    runTurn: noop,
  });

  /** Reads through the ref without letting the compiler narrow it. */
  const callStatus = useCallback((): CallStatus => callRef.current.status, []);

  const drainSpeech = useCallback(() => {
    if (speakingRef.current) return;
    const next = speechQueue.current.shift();
    if (!next) return;

    const finish = () => {
      speakingRef.current = false;
      speakRef.current = null;
      if (speechQueue.current.length) {
        fns.current.drain();
        return;
      }
      setCall((c) =>
        c.status === "live" ? { ...c, agentSpeaking: false } : c,
      );
      if (next.last) fns.current.handOver();
    };

    speakingRef.current = true;
    setCall((c) => (c.status === "live" ? { ...c, agentSpeaking: true } : c));

    if (!canSpeak()) {
      // No synthesis in this browser. The captions carry the conversation.
      const readingTime = Math.min(6000, 400 + next.text.length * 45);
      setTimeout(finish, readingTime);
      return;
    }
    speakRef.current = speak(next.text, { onDone: finish });
  }, [setCall]);

  const enqueueSpeech = useCallback(
    (text: string, last: boolean) => {
      if (callRef.current.status !== "live") return;
      if (!text.trim()) return;
      speechQueue.current.push({ text, last });
      drainSpeech();
    },
    [drainSpeech],
  );

  const stopSpeech = useCallback(() => {
    speechQueue.current = [];
    speakingRef.current = false;
    speakRef.current?.cancel();
    speakRef.current = null;
    stopSpeaking();
  }, []);

  /* -------------------------------------------------------------- *
   * The turn
   * -------------------------------------------------------------- */
  const applyActions = useCallback(
    (actions: TurnAction[], hasText: boolean) => {
      for (const action of actions) {
        switch (action.kind) {
          case "offer_call": {
            setProfile((p) => ({ ...p, callOffered: true }));
            setMessages((prev) => {
              const last = [...prev]
                .reverse()
                .find((m) => m.role === "assistant" && m.kind === "text");
              if (!last) return prev;
              return prev.map((m) =>
                m.id === last.id
                  ? { ...m, suggestions: ["Call me", "Let's just type"] }
                  : m,
              );
            });
            break;
          }
          case "place_call":
            setTimeout(() => fns.current.startCall(), hasText ? 600 : 0);
            break;
          case "end_call":
            setTimeout(() => fns.current.endCall("completed"), 1200);
            break;
          case "stage": {
            if (stagesShownRef.current.has(action.stage)) break;
            stagesShownRef.current.add(action.stage);
            setMessages((prev) => [
              ...prev,
              {
                id: uid(),
                role: "assistant",
                kind: "stage",
                text: "",
                at: Date.now(),
                data: { stageId: action.stage, status: "active" },
              },
            ]);
            break;
          }
          case "gmail_connect": {
            if (gmailShownRef.current) break;
            gmailShownRef.current = true;
            setMessages((prev) => [
              ...prev,
              {
                id: uid(),
                role: "assistant",
                kind: "gmail-card",
                text: "",
                at: Date.now(),
              },
            ]);
            break;
          }
          case "graduate":
            setTimeout(
              () => {
                if (callRef.current.status !== "idle")
                  fns.current.endCall("completed");
                setProfile((p) =>
                  p.phase === "ready"
                    ? p
                    : { ...p, phase: "ready", finishedAt: Date.now() },
                );
              },
              hasText ? 900 : 0,
            );
            break;
        }
      }
    },
    [setMessages, setProfile],
  );

  const runTurnFor = useCallback(
    async (opts: {
      channel: "chat" | "voice";
      event?: TurnEvent;
      history?: Message[];
    }) => {
      const seq = ++turnSeq.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const source = opts.history ?? messagesRef.current;
      const history = source
        .filter((m) => m.kind === "text")
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role as "assistant" | "user", text: m.text }))
        .filter((m) => m.text.trim().length > 0);

      const assistantId = uid();
      const viaVoice = opts.channel === "voice";
      markBusy(true);
      setMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: "assistant",
          kind: "text",
          text: "",
          at: Date.now(),
          pending: true,
          viaVoice,
        },
      ]);

      let full = "";
      let spokenChunks = 0;
      let spokeAnything = false;
      const actions: TurnAction[] = [];
      let suggestions: string[] = [];

      /** Speak whole sentences as they arrive so the line is never dead air. */
      const speakReady = (final: boolean) => {
        if (!viaVoice) return;
        const chunks = splitForSpeech(full);
        const upTo = final ? chunks.length : Math.max(0, chunks.length - 1);
        if (upTo <= spokenChunks) return;
        const say = chunks.slice(spokenChunks, upTo).join(" ");
        spokenChunks = upTo;
        if (!say.trim()) return;
        spokeAnything = true;
        enqueueSpeech(say, final);
      };

      const { ok } = await runTurn(
        {
          profile: profileRef.current,
          channel: opts.channel,
          messages: history,
          event: opts.event,
        },
        {
          onDelta(text) {
            if (turnSeq.current !== seq) return;
            full += text;
            patchMessage(assistantId, { text: full, pending: true });
            speakReady(false);
          },
          onPatch(patch) {
            if (turnSeq.current !== seq) return;
            setProfile((prev) => {
              const slots = { ...prev.slots };
              for (const id of [
                "agentName",
                "userName",
                "gmail",
                "need",
              ] as SlotId[]) {
                const value = patch[id];
                if (typeof value === "string" && value) {
                  slots[id] = {
                    ...slots[id],
                    value,
                    declined: false,
                    source: viaVoice ? "voice" : "chat",
                  };
                }
              }
              return { ...prev, slots, notes: patch.notes ?? prev.notes };
            });
          },
          onDeclined(slots) {
            if (turnSeq.current !== seq) return;
            setProfile((prev) => {
              const next = { ...prev.slots };
              for (const id of slots) {
                if (next[id].value) continue;
                next[id] = { ...next[id], declined: true };
              }
              return { ...prev, slots: next };
            });
          },
          onAsked(slot) {
            if (turnSeq.current !== seq) return;
            setProfile((prev) => ({
              ...prev,
              slots: {
                ...prev.slots,
                [slot]: {
                  ...prev.slots[slot],
                  asks: Math.min(prev.slots[slot].asks + 1, 9),
                },
              },
            }));
          },
          onAction(action) {
            actions.push(action);
          },
          onSuggestions(list) {
            suggestions = list;
          },
        },
        controller.signal,
      );

      if (controller.signal.aborted || turnSeq.current !== seq) return;

      const finalText =
        full.trim() ||
        (ok
          ? "Sorry, I lost that. Try me again."
          : "I dropped that one. Say it again?");
      full = finalText;

      patchMessage(assistantId, {
        text: finalText,
        pending: false,
        errored: !full.trim(),
        suggestions: suggestions.length ? suggestions : undefined,
      });

      speakReady(true);
      markBusy(false);

      // A voice turn must always end with the mic back in the user's hands,
      // including when the model said nothing at all.
      if (viaVoice && !spokeAnything) fns.current.handOver();

      applyActions(actions, Boolean(finalText));
    },
    [
      applyActions,
      enqueueSpeech,
      markBusy,
      patchMessage,
      setMessages,
      setProfile,
    ],
  );

  /* -------------------------------------------------------------- *
   * Call plumbing
   * -------------------------------------------------------------- */
  const armSilence = useCallback(() => {
    clearSilence();
    silenceRef.current = setTimeout(() => {
      const c = callRef.current;
      if (c.status !== "live" || c.agentSpeaking || c.textMode || c.muted)
        return;
      const strikes = c.silenceStrikes + 1;
      setCall((prev) => ({ ...prev, silenceStrikes: strikes }));
      if (strikes >= 3) {
        fns.current.endCall("abandoned");
        return;
      }
      void runTurnFor({
        channel: "voice",
        event: { type: "call_silence", strikes },
      });
    }, SILENCE_MS);
  }, [clearSilence, runTurnFor, setCall]);

  const handOver = useCallback(() => {
    const c = callRef.current;
    if (c.status !== "live") return;
    if (!c.textMode && !c.muted && listenerRef.current) {
      setCall((prev) => ({ ...prev, listening: true }));
      listenerRef.current.start();
    }
    armSilence();
  }, [armSilence, setCall]);

  const applyLocalIntent = useCallback(
    (text: string) => {
      const intent = readIntent(text);
      if (!intent.wantsSkip && !intent.refusesCall) return;
      setProfile((p) => ({
        ...p,
        wantsToSkip: p.wantsToSkip || intent.wantsSkip,
        callRefused: p.callRefused || intent.refusesCall,
        callOffered: p.callOffered || intent.refusesCall,
      }));
    },
    [setProfile],
  );

  const heard = useCallback(
    (text: string, viaVoice: boolean) => {
      const clean = text.trim().slice(0, 2000);
      if (!clean) return;
      if (callRef.current.status !== "live") return;
      clearSilence();
      listenerRef.current?.stop();
      stopSpeech();
      setCall((prev) => ({
        ...prev,
        listening: false,
        agentSpeaking: false,
        partial: "",
        silenceStrikes: 0,
      }));

      const history = setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "user",
          kind: "text",
          text: clean,
          at: Date.now(),
          viaVoice,
        },
      ]);
      applyLocalIntent(clean);
      void runTurnFor({ channel: "voice", history });
    },
    [
      applyLocalIntent,
      clearSilence,
      runTurnFor,
      setCall,
      setMessages,
      stopSpeech,
    ],
  );

  const startCall = useCallback(() => {
    if (profileRef.current.callRefused) return;
    const status = callStatus();
    if (status !== "idle" && status !== "ended") return;
    stopSpeech();
    setCall({ ...IDLE_CALL, status: "ringing" });
  }, [callStatus, setCall, stopSpeech]);

  const answerCall = useCallback(async () => {
    if (callStatus() !== "ringing") return;
    setCall((c) => ({ ...c, status: "connecting" }));

    const supported = canListen();
    let micOk = supported;
    if (supported && navigator.mediaDevices?.getUserMedia) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach((t) => t.stop());
      } catch {
        micOk = false;
      }
    }
    if (callStatus() !== "connecting") return;

    listenerRef.current?.stop();
    listenerRef.current = new Listener({
      onPartial: (t) => setCall((c) => ({ ...c, partial: t })),
      onFinal: (t) => heard(t, true),
      onError: (kind) => {
        if (kind === "denied") {
          setCall((c) => ({
            ...c,
            micDenied: true,
            textMode: true,
            listening: false,
            notice:
              "Your mic is blocked. Type your answers and I'll keep talking.",
          }));
        } else if (kind === "network") {
          setCall((c) => ({
            ...c,
            textMode: true,
            listening: false,
            notice: "Speech recognition dropped out. Typing still works.",
          }));
        }
      },
      onEnd: () => setCall((c) => ({ ...c, listening: false })),
    });

    setProfile((p) => ({ ...p, phase: "call", callOffered: true }));
    setCall({
      ...IDLE_CALL,
      status: "live",
      startedAt: Date.now(),
      micDenied: !micOk,
      textMode: !micOk,
      notice: !supported
        ? "This browser can't listen. Type your answers and I'll talk you through it."
        : !micOk
          ? "Your mic is blocked. Type your answers and I'll keep talking."
          : null,
    });

    void runTurnFor({ channel: "voice", event: { type: "call_accepted" } });
  }, [callStatus, heard, runTurnFor, setCall, setProfile]);

  const declineCall = useCallback(() => {
    if (callRef.current.status === "idle") return;
    setCall(IDLE_CALL);
    setProfile((p) => ({ ...p, callOffered: true, phase: "chat" }));
    void runTurnFor({ channel: "chat", event: { type: "call_declined" } });
  }, [runTurnFor, setCall, setProfile]);

  const endCall = useCallback(
    (outcome: CallOutcome) => {
      const c = callRef.current;
      if (c.status === "idle") return;
      clearSilence();
      stopSpeech();
      listenerRef.current?.stop();
      listenerRef.current = null;
      abortRef.current?.abort();
      turnSeq.current++;
      markBusy(false);

      const secs = c.startedAt
        ? Math.round((Date.now() - c.startedAt) / 1000)
        : 0;
      setCall({ ...IDLE_CALL, status: "ended" });

      const updated = setProfile((p) => ({
        ...p,
        phase: p.phase === "ready" ? "ready" : "chat",
        callOffered: true,
        callHistory: [
          ...p.callHistory,
          { at: Date.now(), outcome, secs },
        ].slice(-6),
      }));

      // Drop the half finished assistant bubble from the call, if any.
      const history = setMessages((prev) => [
        ...prev.filter((m) => !(m.pending && !m.text.trim())),
        {
          id: uid(),
          role: "system",
          kind: "call-summary",
          text: callSummary(updated),
          at: Date.now(),
          data: { outcome, secs },
        },
      ]);

      setTimeout(() => setCall(IDLE_CALL), 350);

      if (updated.phase !== "ready") {
        void runTurnFor({
          channel: "chat",
          event: { type: "call_ended", outcome, secs },
          history,
        });
      }
    },
    [
      clearSilence,
      markBusy,
      runTurnFor,
      setCall,
      setMessages,
      setProfile,
      stopSpeech,
    ],
  );

  const toggleMute = useCallback(() => {
    const c = callRef.current;
    const muted = !c.muted;
    listenerRef.current?.setMuted(muted);
    if (muted) listenerRef.current?.stop();
    else if (!c.agentSpeaking && !c.textMode) listenerRef.current?.start();
    setCall({
      ...c,
      muted,
      listening: muted ? false : c.listening,
      partial: "",
    });
  }, [setCall]);

  const toggleTextMode = useCallback(() => {
    const c = callRef.current;
    const textMode = !c.textMode;
    if (textMode) listenerRef.current?.stop();
    else if (!c.agentSpeaking && !c.muted) listenerRef.current?.start();
    setCall({ ...c, textMode, listening: false, partial: "" });
  }, [setCall]);

  /* -------------------------------------------------------------- *
   * Public actions
   * -------------------------------------------------------------- */
  const reset = useCallback(() => {
    abortRef.current?.abort();
    turnSeq.current++;
    stopSpeech();
    listenerRef.current?.stop();
    listenerRef.current = null;
    clearSilence();
    gmailShownRef.current = false;
    persist.clear();
    setCall(IDLE_CALL);
    setProfile({ ...newProfile(), phase: "chat" });
    setMessages(openingMessages());
    markBusy(false);
  }, [clearSilence, markBusy, setCall, setMessages, setProfile, stopSpeech]);

  const send = useCallback(
    (raw: string) => {
      const text = raw.trim().slice(0, 2000);
      if (!text) return;
      if (profileRef.current.phase === "ready") return;

      if (readIntent(text).wantsRestart) {
        reset();
        return;
      }

      if (callRef.current.status === "live") {
        heard(text, false);
        return;
      }

      abortRef.current?.abort();
      turnSeq.current++;
      const history = setMessages((prev) => [
        ...prev.filter((m) => !(m.pending && !m.text.trim())),
        {
          id: uid(),
          role: "user",
          kind: "text",
          text,
          at: Date.now(),
        },
      ]);
      applyLocalIntent(text);
      void runTurnFor({ channel: "chat", history });
    },
    [applyLocalIntent, heard, reset, runTurnFor, setMessages],
  );

  /**
   * A finished stage becomes a reply.
   *
   * Tapping a name is the same as typing it, so the agent reacts the same way
   * and the transcript reads the same either way.
   */
  const completeStage = useCallback(
    (messageId: string, result: string) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, data: { ...(m.data ?? {}), status: "done", result } }
            : m,
        ),
      );
      send(result);
    },
    [send, setMessages],
  );

  const connectGmail = useCallback(
    (email: string) => {
      setGmailOpen(false);
      void runTurnFor({
        channel: callRef.current.status === "live" ? "voice" : "chat",
        event: { type: "gmail_connected", email },
      });
    },
    [runTurnFor],
  );

  const dismissGmail = useCallback(
    (opts: { connected: boolean }) => {
      setGmailOpen(false);
      if (opts.connected || profileRef.current.slots.gmail.value) return;
      void runTurnFor({
        channel: callRef.current.status === "live" ? "voice" : "chat",
        event: { type: "gmail_dismissed" },
      });
    },
    [runTurnFor],
  );

  const openGmail = useCallback(() => setGmailOpen(true), []);

  const graduate = useCallback(() => {
    abortRef.current?.abort();
    turnSeq.current++;
    if (callRef.current.status !== "idle") endCall("completed");
    stopSpeech();
    markBusy(false);
    setProfile((p) => ({ ...p, phase: "ready", finishedAt: Date.now() }));
  }, [endCall, markBusy, setProfile, stopSpeech]);

  // Close the cycle. A layout effect runs before anything can fire a timer or
  // resolve a turn, so the handles are always current by the time they matter.
  useLayoutEffect(() => {
    fns.current = {
      drain: drainSpeech,
      handOver,
      startCall,
      endCall,
      runTurn: (o) => void runTurnFor(o),
    };
  }, [drainSpeech, endCall, handOver, runTurnFor, startCall]);

  /* -------------------------------------------------------------- *
   * Timers and lifecycle
   * -------------------------------------------------------------- */
  useEffect(() => {
    if (call.status !== "live" || !call.startedAt) return;
    const id = setInterval(() => {
      setCall((c) =>
        c.startedAt && c.status === "live"
          ? { ...c, secs: Math.round((Date.now() - c.startedAt) / 1000) }
          : c,
      );
    }, 1000);
    return () => clearInterval(id);
  }, [call.status, call.startedAt, setCall]);

  useEffect(() => {
    if (call.status !== "ringing") return;
    const id = setTimeout(() => {
      if (callRef.current.status === "ringing") declineCall();
    }, RING_MS);
    return () => clearTimeout(id);
  }, [call.status, declineCall]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        hiddenSinceRef.current = Date.now();
        if (callRef.current.status === "live") stopSpeech();
        return;
      }
      const away = hiddenSinceRef.current
        ? Date.now() - hiddenSinceRef.current
        : 0;
      hiddenSinceRef.current = null;

      if (callRef.current.status === "live") {
        if (away > ABANDON_MS) endCall("abandoned");
        else fns.current.handOver();
        return;
      }
      if (
        away > 120_000 &&
        profileRef.current.phase === "chat" &&
        !busyRef.current
      ) {
        void runTurnFor({
          channel: "chat",
          event: { type: "resume", awayMs: away },
        });
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [endCall, runTurnFor, stopSpeech]);

  useEffect(() => {
    const onUnload = () => {
      stopSpeaking();
    };
    window.addEventListener("pagehide", onUnload);
    return () => window.removeEventListener("pagehide", onUnload);
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      speakRef.current?.cancel();
      stopSpeaking();
      listenerRef.current?.stop();
      if (silenceRef.current) clearTimeout(silenceRef.current);
    };
  }, []);

  /* -------------------------------------------------------------- *
   * Derived
   * -------------------------------------------------------------- */
  const derived = useMemo(
    () => ({
      missing: missingSlots(profile),
      collected: collectedCount(profile),
      next: nextSlot(profile),
      canGraduate: canGraduate(profile),
    }),
    [profile],
  );

  return {
    hydrated,
    profile,
    messages,
    busy,
    call,
    gmailOpen,
    ...derived,
    send,
    startCall,
    answerCall,
    declineCall,
    endCall,
    toggleMute,
    toggleTextMode,
    openGmail,
    connectGmail,
    dismissGmail,
    graduate,
    reset,
    completeStage,
  };
}
