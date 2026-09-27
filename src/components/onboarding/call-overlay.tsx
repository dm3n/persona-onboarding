"use client";

import { useEffect, useMemo, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Keyboard, Mic, MicOff, Phone, PhoneOff } from "lucide-react";

import { PersonaMark } from "@/components/persona-logo";
import { Composer } from "@/components/onboarding/composer";
import { CallOrb, type OrbMode } from "@/components/onboarding/call-orb";
import { Button } from "@/components/ui/button";
import { useMicLevel } from "@/lib/speech/use-mic-level";
import type { CallState } from "@/lib/onboarding/use-onboarding";
import type { Message, Profile } from "@/lib/onboarding/types";
import { displayAgentName } from "@/lib/onboarding/slots";
import { cn } from "@/lib/utils";

function clock(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function CallOverlay({
  call,
  profile,
  messages,
  busy,
  onAnswer,
  onDecline,
  onEnd,
  onToggleMute,
  onToggleTextMode,
  onSend,
}: {
  call: CallState;
  profile: Profile;
  messages: Message[];
  busy: boolean;
  onAnswer: () => void;
  onDecline: () => void;
  onEnd: () => void;
  onToggleMute: () => void;
  onToggleTextMode: () => void;
  onSend: (text: string) => void;
}) {
  const visible = call.status !== "idle";
  const live = call.status === "live";
  const { level } = useMicLevel(live && !call.muted && !call.textMode);
  const name = displayAgentName(profile);

  // Escape hangs up, the way it closes anything else.
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (call.status === "ringing") onDecline();
      else onEnd();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, call.status, onDecline, onEnd]);

  const lastAgent = useMemo(() => {
    const m = [...messages]
      .reverse()
      .find(
        (x) => x.role === "assistant" && x.kind === "text" && x.text.trim(),
      );
    return m?.text ?? "";
  }, [messages]);

  const lastUser = useMemo(() => {
    const m = [...messages].reverse().find((x) => x.role === "user");
    return m?.viaVoice ? m.text : "";
  }, [messages]);

  const mode: OrbMode =
    call.status === "ringing"
      ? "ringing"
      : call.status === "connecting"
        ? "connecting"
        : call.agentSpeaking || busy
          ? "speaking"
          : call.listening
            ? "listening"
            : "idle";

  const status =
    call.status === "ringing"
      ? "Incoming call"
      : call.status === "connecting"
        ? "Connecting"
        : call.agentSpeaking
          ? "Speaking"
          : busy
            ? "Thinking"
            : call.muted
              ? "Muted"
              : call.textMode
                ? "Type your answer"
                : call.listening
                  ? "Listening"
                  : "Go ahead";

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          key="call"
          role="dialog"
          aria-modal="true"
          aria-label={`Call with ${name}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-neutral-950 px-6 py-8 text-white sm:py-12"
        >
          {/* Ambient wash */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute left-1/2 top-[28%] size-[42rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/[0.06] blur-[120px]" />
          </div>

          {/* Top bar */}
          <div className="relative z-10 flex w-full max-w-md items-center justify-between">
            <span className="inline-flex items-center gap-2 text-white/50">
              <PersonaMark className="h-4" />
              <span className="text-[0.75rem] font-medium tracking-tight">
                Persona
              </span>
            </span>
            {live ? (
              <span className="font-mono text-[0.75rem] tabular-nums text-white/50">
                {clock(call.secs)}
              </span>
            ) : null}
          </div>

          {/* Middle */}
          <div className="relative z-10 flex w-full max-w-md flex-1 flex-col items-center justify-center gap-6 py-6">
            <CallOrb mode={mode} level={level} />

            <div className="text-center">
              <p className="text-[1.375rem] font-medium tracking-tight">
                {name}
              </p>
              <motion.p
                key={status}
                initial={{ opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-1 text-[0.8125rem] text-white/45"
              >
                {status}
              </motion.p>
            </div>

            {live ? (
              <Captions
                agent={lastAgent}
                user={call.partial || lastUser}
                userIsPartial={Boolean(call.partial)}
              />
            ) : null}

            {call.notice ? (
              <p className="max-w-xs text-center text-[0.75rem] leading-relaxed text-amber-200/70">
                {call.notice}
              </p>
            ) : null}
          </div>

          {/* Controls */}
          <div className="relative z-10 flex w-full max-w-md flex-col items-center gap-5">
            {live && call.textMode ? (
              <div className="w-full">
                <Composer
                  variant="call"
                  placeholder="Type your answer"
                  onSend={onSend}
                  disabled={busy}
                  autoFocus
                />
              </div>
            ) : null}

            {call.status === "ringing" ? (
              <div className="flex items-center gap-14">
                <CallButton
                  label="Decline"
                  onClick={onDecline}
                  className="bg-white/10 text-white hover:bg-white/15"
                >
                  <PhoneOff className="size-6" />
                </CallButton>
                <motion.div
                  animate={{ scale: [1, 1.06, 1] }}
                  transition={{ duration: 1.4, repeat: Infinity }}
                >
                  <CallButton
                    label="Answer"
                    onClick={onAnswer}
                    className="bg-emerald-500 text-white hover:bg-emerald-400"
                  >
                    <Phone className="size-6" />
                  </CallButton>
                </motion.div>
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <CallButton
                  label={call.muted ? "Unmute" : "Mute"}
                  onClick={onToggleMute}
                  disabled={call.textMode}
                  small
                  className={cn(
                    "bg-white/10 text-white hover:bg-white/15",
                    call.muted && "bg-white text-neutral-900 hover:bg-white/90",
                    call.textMode && "opacity-40",
                  )}
                >
                  {call.muted ? (
                    <MicOff className="size-5" />
                  ) : (
                    <Mic className="size-5" />
                  )}
                </CallButton>

                <CallButton
                  label="End call"
                  onClick={onEnd}
                  className="bg-red-500 text-white hover:bg-red-400"
                >
                  <PhoneOff className="size-6" />
                </CallButton>

                <CallButton
                  label={call.textMode ? "Use voice" : "Type instead"}
                  onClick={onToggleTextMode}
                  disabled={call.micDenied}
                  small
                  className={cn(
                    "bg-white/10 text-white hover:bg-white/15",
                    call.textMode &&
                      "bg-white text-neutral-900 hover:bg-white/90",
                    call.micDenied && "opacity-40",
                  )}
                >
                  <Keyboard className="size-5" />
                </CallButton>
              </div>
            )}

            <p className="text-center text-[0.6875rem] text-white/30">
              {call.status === "ringing"
                ? "Simulated call. Nothing dials out."
                : "Press Esc to hang up"}
            </p>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function Captions({
  agent,
  user,
  userIsPartial,
}: {
  agent: string;
  user: string;
  userIsPartial: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [agent]);

  return (
    <div
      ref={scroller}
      className="flex min-h-[6.5rem] w-full flex-col items-center justify-start gap-2.5 px-2"
      aria-live="polite"
    >
      {agent ? (
        // Keyed so each new line fades in. No exit animation, because two
        // captions dissolving through each other is unreadable.
        <motion.p
          key={agent.slice(0, 48)}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-md text-center text-[0.9375rem] leading-relaxed text-white/85"
        >
          {agent}
        </motion.p>
      ) : null}
      {user ? (
        <p
          className={cn(
            "max-w-md text-center text-[0.8125rem] leading-snug",
            userIsPartial ? "text-white/35" : "text-white/55",
          )}
        >
          {user}
        </p>
      ) : null}
    </div>
  );
}

function CallButton({
  children,
  label,
  onClick,
  className,
  small,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  className?: string;
  small?: boolean;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "rounded-full transition-transform active:scale-95",
        small ? "size-12" : "size-16",
        className,
      )}
    >
      {children}
    </Button>
  );
}
