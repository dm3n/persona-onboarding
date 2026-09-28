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
  useRealtimeCall,
  type RealtimeFailure,
  type RealtimeStatus,
} from "@/lib/speech/use-realtime-call";

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
  normalizeSlot,
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

/** Hidden tab for longer than this during a call counts as walking away. */
const ABANDON_MS = 30_000;
/** Nobody picked up. */
const RING_MS = 20_000;
/** Dead air in both directions for this long and the call closes itself. */
const DEAD_AIR_MS = 75_000;
/**
 * A hard ceiling on one call.
 *
 * Onboarding is meant to take a minute. Anything past five is either someone
 * exploring or a tab left open, and live audio is metered by the minute.
 */
const MAX_CALL_MS = 5 * 60_000;

export type CallStatus =
  "idle" | "ringing" | "connecting" | "live" | "ending" | "failed";

export type CallState = {
  status: CallStatus;
  startedAt: number | null;
  secs: number;
  muted: boolean;
  /** Microphone and speaker levels, 0 to 1, for the orb. */
  levels: { input: number; output: number };
  notice: string | null;
};

const IDLE_CALL: CallState = {
  status: "idle",
  startedAt: null,
  secs: 0,
  muted: false,
  levels: { input: 0, output: 0 },
  notice: null,
};

const FAILURE_NOTICE: Record<RealtimeFailure, string> = {
  mic_denied: "Your mic is blocked, so we will keep going here instead.",
  unsupported: "This browser cannot do live voice, so we will keep typing.",
  no_token: "Voice is not available right now. Typing works just as well.",
  network: "The call could not connect. Carrying on here.",
  dropped: "The call dropped. Picking up where we left off.",
};

type LateBound = {
  endCall: (outcome: CallOutcome) => void;
  startCall: () => void;
  runTurn: (opts: {
    channel: "chat" | "voice";
    event?: TurnEvent;
    history?: Message[];
  }) => void;
  applyActions: (actions: TurnAction[], hasText: boolean) => void;
};

function noop() {}

function uid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto)
    return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** The opening: a line, then the agent itself, waiting to be named. */
function openingMessages(): Message[] {
  const at = Date.now();
  return [
    { id: uid(), role: "assistant", kind: "text", text: OPENING_MESSAGE, at },
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
   * Every piece of state has a ref written synchronously. Turns, call events
   * and timers all run outside React's render cycle and need the truth now,
   * not on the next render.
   */
  const profileRef = useRef(profile);
  const messagesRef = useRef(messages);
  const callRef = useRef(call);
  const busyRef = useRef(busy);

  const abortRef = useRef<AbortController | null>(null);
  const hiddenSinceRef = useRef<number | null>(null);
  const gmailShownRef = useRef(false);
  const stagesShownRef = useRef<Set<StageId>>(new Set());
  const turnSeq = useRef(0);
  const liveAgentId = useRef<string | null>(null);
  const deadAir = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const callStatus = useCallback((): CallStatus => callRef.current.status, []);
  const onCall = useCallback(() => {
    const s = callRef.current.status;
    return s === "live" || s === "connecting";
  }, []);

  /** Late bound, because the call loop is genuinely circular. */
  const fns = useRef<LateBound>({
    endCall: noop,
    startCall: noop,
    runTurn: noop,
    applyActions: noop,
  });

  /* -------------------------------------------------------------- *
   * Hydrate and persist
   * -------------------------------------------------------------- */
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

  const pushMessage = useCallback(
    (m: Omit<Message, "id" | "at"> & Partial<Pick<Message, "id" | "at">>) => {
      const full: Message = {
        id: m.id ?? uid(),
        at: m.at ?? Date.now(),
        ...m,
      } as Message;
      setMessages((prev) => [...prev, full]);
      return full.id;
    },
    [setMessages],
  );

  /* -------------------------------------------------------------- *
   * Shared side effects, used by both channels
   * -------------------------------------------------------------- */
  const showGmailCard = useCallback(() => {
    if (gmailShownRef.current) return false;
    gmailShownRef.current = true;
    pushMessage({ role: "assistant", kind: "gmail-card", text: "" });
    return true;
  }, [pushMessage]);

  const showStage = useCallback(
    (stage: StageId) => {
      if (stagesShownRef.current.has(stage)) return false;
      stagesShownRef.current.add(stage);
      pushMessage({
        role: "assistant",
        kind: "stage",
        text: "",
        data: { stageId: stage, status: "active" },
      });
      return true;
    },
    [pushMessage],
  );

  const saveSlots = useCallback(
    (input: Record<string, unknown>) => {
      const saved: SlotId[] = [];
      setProfile((prev) => {
        const slots = { ...prev.slots };
        const notes = [...prev.notes];
        for (const id of [
          "agentName",
          "userName",
          "gmail",
          "need",
        ] as SlotId[]) {
          const raw = input[id];
          if (typeof raw === "string") {
            // The same cleaning the text channel gets. A voice agent hearing
            // "call me" as a name would otherwise write it straight in.
            const asIntent = readIntent(raw);
            const blocked =
              asIntent.refusesCall ||
              asIntent.wantsCall ||
              asIntent.wantsSkip ||
              asIntent.refuses ||
              asIntent.isBareGreeting;
            const value = blocked ? null : normalizeSlot(id, raw);
            if (value) {
              slots[id] = {
                ...slots[id],
                value,
                declined: false,
                source: "voice",
              };
              saved.push(id);
            }
          }
          if (input[`${id}Declined`] === true && !slots[id].value) {
            slots[id] = { ...slots[id], declined: true };
          }
        }
        if (typeof input.note === "string" && input.note.trim()) {
          const note = input.note.trim().slice(0, 240);
          if (!notes.includes(note)) notes.push(note);
        }
        return { ...prev, slots, notes: notes.slice(-8) };
      });
      return saved;
    },
    [setProfile],
  );

  const graduateNow = useCallback(() => {
    setProfile((p) =>
      p.phase === "ready"
        ? p
        : { ...p, phase: "ready", finishedAt: Date.now() },
    );
  }, [setProfile]);

  /* -------------------------------------------------------------- *
   * The live call
   * -------------------------------------------------------------- */
  const armDeadAir = useCallback(() => {
    if (deadAir.current) clearTimeout(deadAir.current);
    deadAir.current = setTimeout(() => {
      if (callRef.current.status === "live") fns.current.endCall("abandoned");
    }, DEAD_AIR_MS);
  }, []);

  const realtime = useRealtimeCall({
    onUserSaid: useCallback(
      (text) => {
        armDeadAir();
        pushMessage({ role: "user", kind: "text", text, viaVoice: true });
      },
      [armDeadAir, pushMessage],
    ),

    onAgentPartial: useCallback(
      (text) => {
        armDeadAir();
        if (!text) return;
        if (!liveAgentId.current) {
          liveAgentId.current = pushMessage({
            role: "assistant",
            kind: "text",
            text,
            viaVoice: true,
            pending: true,
          });
          return;
        }
        patchMessage(liveAgentId.current, { text, pending: true });
      },
      [armDeadAir, patchMessage, pushMessage],
    ),

    onAgentSaid: useCallback(
      (text) => {
        armDeadAir();
        if (liveAgentId.current) {
          patchMessage(liveAgentId.current, { text, pending: false });
          liveAgentId.current = null;
          return;
        }
        pushMessage({
          role: "assistant",
          kind: "text",
          text,
          viaVoice: true,
        });
      },
      [armDeadAir, patchMessage, pushMessage],
    ),

    onTool: useCallback(
      (name, args) => {
        switch (name) {
          case "remember": {
            const saved = saveSlots(args);
            return { saved: saved.length ? saved : "nothing new" };
          }
          case "show_board": {
            const shown = showStage("focus");
            return shown
              ? { shown: true, note: "The board is on their screen now." }
              : { shown: false, note: "It is already on their screen." };
          }
          case "connect_gmail": {
            const shown = showGmailCard();
            return shown
              ? { shown: true, note: "The connect button is on their screen." }
              : { shown: false, note: "It is already on their screen." };
          }
          case "finish": {
            if (!canGraduate(profileRef.current)) {
              const left = missingSlots(profileRef.current);
              return {
                done: false,
                reason: `Not yet. Still open: ${left.join(", ")}. Ask for ${left[0]}.`,
              };
            }
            setTimeout(() => {
              fns.current.endCall("completed");
              graduateNow();
            }, 2200);
            return { done: true };
          }
          case "hang_up": {
            setTimeout(() => fns.current.endCall("completed"), 1600);
            return { ended: true };
          }
          default:
            return { ok: false, note: "No such tool." };
        }
      },
      [graduateNow, saveSlots, showGmailCard, showStage],
    ),

    onStatus: useCallback(
      (s: RealtimeStatus) => {
        if (s === "live") {
          setCall((c) => ({
            ...c,
            status: "live",
            startedAt: c.startedAt ?? Date.now(),
            notice: null,
          }));
          setProfile((p) => ({ ...p, phase: "call", callOffered: true }));
          armDeadAir();
        } else if (s === "connecting") {
          setCall((c) => ({ ...c, status: "connecting" }));
        }
      },
      [armDeadAir, setCall, setProfile],
    ),

    onFailure: useCallback(
      (kind: RealtimeFailure, detail?: string) => {
        console.warn("[call] failed", kind, detail);
        const notice = FAILURE_NOTICE[kind];
        setCall({ ...IDLE_CALL, status: "idle", notice });
        setProfile((p) => ({ ...p, phase: "chat", callOffered: true }));
        // Let the text agent pick it up in its own words.
        fns.current.runTurn({
          channel: "chat",
          event: { type: "call_failed", reason: kind },
        });
      },
      [setCall, setProfile],
    ),
  });

  // Mirror the live meters onto the call state for the orb.
  useEffect(() => {
    if (callRef.current.status !== "live") return;
    setCall((c) =>
      c.status === "live" ? { ...c, levels: realtime.levels } : c,
    );
  }, [realtime.levels, setCall]);

  useEffect(() => {
    setCall((c) =>
      c.muted === realtime.muted ? c : { ...c, muted: realtime.muted },
    );
  }, [realtime.muted, setCall]);

  /* -------------------------------------------------------------- *
   * The text turn
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
          case "stage":
            showStage(action.stage);
            break;
          case "gmail_connect":
            showGmailCard();
            break;
          case "graduate":
            setTimeout(
              () => {
                if (callRef.current.status !== "idle")
                  fns.current.endCall("completed");
                graduateNow();
              },
              hasText ? 900 : 0,
            );
            break;
        }
      }
    },
    [graduateNow, setMessages, setProfile, showGmailCard, showStage],
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
        },
      ]);

      let full = "";
      const actions: TurnAction[] = [];
      let suggestions: string[] = [];

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
                    source: "chat",
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

      patchMessage(assistantId, {
        text: finalText,
        pending: false,
        errored: !full.trim(),
        suggestions: suggestions.length ? suggestions : undefined,
      });
      markBusy(false);
      applyActions(actions, Boolean(finalText));
    },
    [applyActions, markBusy, patchMessage, setMessages, setProfile],
  );

  /* -------------------------------------------------------------- *
   * Call lifecycle
   * -------------------------------------------------------------- */
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

  const startCall = useCallback(() => {
    if (profileRef.current.callRefused) return;
    const s = callStatus();
    if (s !== "idle" && s !== "failed") return;
    setCall({ ...IDLE_CALL, status: "ringing" });
  }, [callStatus, setCall]);

  const answerCall = useCallback(() => {
    if (callStatus() === "live" || callStatus() === "connecting") return;
    setCall((c) => ({ ...c, status: "connecting", startedAt: Date.now() }));
    void realtime.start(profileRef.current);
  }, [callStatus, realtime, setCall]);

  const declineCall = useCallback(() => {
    if (callStatus() === "idle") return;
    setCall(IDLE_CALL);
    setProfile((p) => ({ ...p, callOffered: true, phase: "chat" }));
    void runTurnFor({ channel: "chat", event: { type: "call_declined" } });
  }, [callStatus, runTurnFor, setCall, setProfile]);

  const endCall = useCallback(
    (outcome: CallOutcome) => {
      const c = callRef.current;
      if (c.status === "idle") return;
      if (deadAir.current) clearTimeout(deadAir.current);
      realtime.stop();
      liveAgentId.current = null;

      const secs = c.startedAt
        ? Math.round((Date.now() - c.startedAt) / 1000)
        : 0;
      setCall(IDLE_CALL);

      const updated = setProfile((p) => ({
        ...p,
        phase: p.phase === "ready" ? "ready" : "chat",
        callOffered: true,
        callHistory: [
          ...p.callHistory,
          { at: Date.now(), outcome, secs },
        ].slice(-6),
      }));

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

      if (updated.phase !== "ready") {
        void runTurnFor({
          channel: "chat",
          event: { type: "call_ended", outcome, secs },
          history,
        });
      }
    },
    [realtime, runTurnFor, setCall, setMessages, setProfile],
  );

  /* -------------------------------------------------------------- *
   * Public actions
   * -------------------------------------------------------------- */
  const reset = useCallback(() => {
    abortRef.current?.abort();
    turnSeq.current++;
    realtime.stop();
    if (deadAir.current) clearTimeout(deadAir.current);
    gmailShownRef.current = false;
    stagesShownRef.current = new Set();
    liveAgentId.current = null;
    persist.clear();
    setCall(IDLE_CALL);
    setProfile({ ...newProfile(), phase: "chat" });
    setMessages(openingMessages());
    markBusy(false);
  }, [markBusy, realtime, setCall, setMessages, setProfile]);

  const send = useCallback(
    (raw: string) => {
      const text = raw.trim().slice(0, 2000);
      if (!text) return;
      if (profileRef.current.phase === "ready") return;

      if (readIntent(text).wantsRestart) {
        reset();
        return;
      }

      // Typing mid call goes to the agent that is already listening.
      if (onCall()) {
        pushMessage({ role: "user", kind: "text", text, viaVoice: false });
        applyLocalIntent(text);
        realtime.sendText(text);
        return;
      }

      abortRef.current?.abort();
      turnSeq.current++;
      const history = setMessages((prev) => [
        ...prev.filter((m) => !(m.pending && !m.text.trim())),
        { id: uid(), role: "user", kind: "text", text, at: Date.now() },
      ]);
      applyLocalIntent(text);
      void runTurnFor({ channel: "chat", history });
    },
    [
      applyLocalIntent,
      onCall,
      pushMessage,
      realtime,
      reset,
      runTurnFor,
      setMessages,
    ],
  );

  const completeStage = useCallback(
    (messageId: string, result: string) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, data: { ...(m.data ?? {}), status: "done", result } }
            : m,
        ),
      );
      if (onCall()) {
        // The agent is mid sentence somewhere. Tell it what just happened
        // rather than making it guess from a transcript it never heard.
        pushMessage({ role: "user", kind: "text", text: result });
        realtime.nudge(
          `They just used the panel on their screen and chose: ${result}. Save it with remember, acknowledge it in a few words, and carry on.`,
        );
        return;
      }
      send(result);
    },
    [onCall, pushMessage, realtime, send, setMessages],
  );

  const connectGmail = useCallback(
    (email: string) => {
      setGmailOpen(false);
      if (onCall()) {
        setProfile((p) => ({
          ...p,
          slots: {
            ...p.slots,
            gmail: {
              ...p.slots.gmail,
              value: email,
              declined: false,
              source: "oauth",
            },
          },
        }));
        realtime.nudge(
          `They just connected ${email}. Acknowledge it in a few words and move to whatever is still open.`,
        );
        return;
      }
      void runTurnFor({
        channel: "chat",
        event: { type: "gmail_connected", email },
      });
    },
    [onCall, realtime, runTurnFor, setProfile],
  );

  const dismissGmail = useCallback(
    (opts: { connected: boolean }) => {
      setGmailOpen(false);
      if (opts.connected || profileRef.current.slots.gmail.value) return;
      if (onCall()) {
        realtime.nudge(
          "They closed the Gmail sheet without connecting. Do not push, say you can come back to it, and move on.",
        );
        return;
      }
      void runTurnFor({ channel: "chat", event: { type: "gmail_dismissed" } });
    },
    [onCall, realtime, runTurnFor],
  );

  const openGmail = useCallback(() => setGmailOpen(true), []);

  const graduate = useCallback(() => {
    abortRef.current?.abort();
    turnSeq.current++;
    if (callStatus() !== "idle") endCall("completed");
    markBusy(false);
    graduateNow();
  }, [callStatus, endCall, graduateNow, markBusy]);

  // Close the cycle for the callbacks defined before these.
  useLayoutEffect(() => {
    fns.current = {
      endCall,
      startCall,
      runTurn: (o) => void runTurnFor(o),
      applyActions,
    };
  }, [applyActions, endCall, runTurnFor, startCall]);

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
    if (call.status !== "live" || !call.startedAt) return;
    const left = Math.max(0, call.startedAt + MAX_CALL_MS - Date.now());
    const id = setTimeout(() => {
      if (callRef.current.status === "live") endCall("completed");
    }, left);
    return () => clearTimeout(id);
  }, [call.status, call.startedAt, endCall]);

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
        return;
      }
      const away = hiddenSinceRef.current
        ? Date.now() - hiddenSinceRef.current
        : 0;
      hiddenSinceRef.current = null;

      if (callRef.current.status === "live") {
        if (away > ABANDON_MS) endCall("abandoned");
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
  }, [endCall, runTurnFor]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (deadAir.current) clearTimeout(deadAir.current);
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
    toggleMute: realtime.toggleMute,
    openGmail,
    connectGmail,
    dismissGmail,
    graduate,
    reset,
    completeStage,
  };
}
