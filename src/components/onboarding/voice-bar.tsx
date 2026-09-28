"use client";

import { useMemo } from "react";
import { motion } from "motion/react";
import { Mic, MicOff, Phone, PhoneOff } from "lucide-react";

import { PersonaMark } from "@/components/persona-logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CallState } from "@/lib/onboarding/use-onboarding";

function clock(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Twelve bars that lean toward whoever is talking. */
function Waveform({
  input,
  output,
  idle,
}: {
  input: number;
  output: number;
  idle: boolean;
}) {
  const bars = useMemo(() => Array.from({ length: 14 }, (_, i) => i), []);
  const speaking = output > input;
  const level = Math.max(input, output);

  return (
    <div className="flex h-6 flex-1 items-center justify-center gap-[3px]">
      {bars.map((i) => {
        // A fixed shape so the middle is tallest, scaled by how loud it is.
        const center =
          1 - Math.abs(i - (bars.length - 1) / 2) / (bars.length / 2);
        const height = idle
          ? 3
          : 3 + center * 18 * Math.min(1, level * 1.35 + 0.08);
        return (
          <motion.span
            key={i}
            className={cn(
              "w-[3px] rounded-full",
              idle
                ? "bg-muted-foreground/25"
                : speaking
                  ? "bg-foreground"
                  : "bg-foreground/55",
            )}
            animate={{ height }}
            transition={{ duration: 0.09, ease: "easeOut" }}
          />
        );
      })}
    </div>
  );
}

export function VoiceBar({
  call,
  agentName,
  onEnd,
  onToggleMute,
}: {
  call: CallState;
  agentName: string;
  onEnd: () => void;
  onToggleMute: () => void;
}) {
  const connecting = call.status === "connecting";
  const { input, output } = call.levels;

  const status = connecting
    ? "Connecting"
    : call.muted
      ? "Muted"
      : output > input && output > 0.05
        ? "Speaking"
        : input > 0.05
          ? "Listening"
          : // A beat of quiet early on is the agent getting started; later it
            // is the agent waiting on you.
            call.secs > 3
            ? "Go ahead"
            : "Listening";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="flex items-center gap-3 rounded-2xl border border-foreground/15 bg-foreground/[0.04] px-3 py-2.5 backdrop-blur"
      role="status"
      aria-live="polite"
    >
      <span className="relative grid size-9 shrink-0 place-items-center">
        <motion.span
          className="absolute inset-0 rounded-full bg-foreground/10"
          animate={{
            scale: connecting
              ? [1, 1.15, 1]
              : 1 + Math.max(input, output) * 0.45,
            opacity: connecting ? [0.4, 0.8, 0.4] : 0.5,
          }}
          transition={
            connecting
              ? { duration: 1.2, repeat: Infinity }
              : { duration: 0.12 }
          }
        />
        <PersonaMark className="relative h-4 text-foreground" />
      </span>

      <span className="min-w-0 shrink-0">
        <span className="block truncate text-[0.8125rem] font-medium leading-tight">
          {agentName}
        </span>
        <span className="block text-[0.6875rem] leading-tight text-muted-foreground">
          {status}
          {call.status === "live" ? ` · ${clock(call.secs)}` : ""}
        </span>
      </span>

      <Waveform input={input} output={output} idle={connecting || call.muted} />

      <span className="flex shrink-0 items-center gap-1.5">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={call.muted ? "Unmute" : "Mute"}
          onClick={onToggleMute}
          className={cn(
            "size-9 rounded-full",
            call.muted &&
              "bg-foreground text-background hover:bg-foreground/90",
          )}
        >
          {call.muted ? (
            <MicOff className="size-4" />
          ) : (
            <Mic className="size-4" />
          )}
        </Button>
        <Button
          type="button"
          size="icon"
          aria-label="End call"
          onClick={onEnd}
          className="size-9 rounded-full bg-red-500 text-white hover:bg-red-500/90"
        >
          <PhoneOff className="size-4" />
        </Button>
      </span>
    </motion.div>
  );
}

/** The compact ring. It sits above the composer rather than taking the screen. */
export function IncomingCall({
  agentName,
  onAnswer,
  onDecline,
}: {
  agentName: string;
  onAnswer: () => void;
  onDecline: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="flex items-center gap-3 rounded-2xl border border-border bg-card px-3 py-2.5"
      role="alertdialog"
      aria-label={`${agentName} is calling`}
    >
      <motion.span
        className="relative grid size-9 shrink-0 place-items-center"
        animate={{ rotate: [0, -8, 8, -6, 0] }}
        transition={{ duration: 1.1, repeat: Infinity, repeatDelay: 0.5 }}
      >
        <span className="absolute inset-0 rounded-full bg-emerald-500/15" />
        <Phone className="relative size-4 text-emerald-600 dark:text-emerald-400" />
      </motion.span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.8125rem] font-medium leading-tight">
          {agentName} is calling
        </span>
        <span className="block text-[0.6875rem] leading-tight text-muted-foreground">
          Under a minute, and you can still type
        </span>
      </span>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onDecline}
        className="h-8 rounded-full px-3 text-[0.75rem] text-muted-foreground"
      >
        Not now
      </Button>
      <Button
        type="button"
        size="sm"
        onClick={onAnswer}
        className="h-8 rounded-full bg-emerald-600 px-3.5 text-[0.75rem] text-white hover:bg-emerald-600/90"
      >
        Answer
      </Button>
    </motion.div>
  );
}
