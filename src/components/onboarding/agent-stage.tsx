"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check } from "lucide-react";

import { PersonaMark } from "@/components/persona-logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Message, StageId } from "@/lib/onboarding/types";

/* ------------------------------------------------------------------ *
 * The shell
 *
 * A small instrument that sits in the conversation. The agent does
 * something in it first, then hands over, and a bar underneath tracks
 * what is left. Whatever the user does becomes an ordinary reply.
 * ------------------------------------------------------------------ */

function StageShell({
  stageId,
  agentName,
  status,
  children,
  caption,
  instruction,
  counter,
  verdict,
  action,
  settled,
}: {
  stageId: StageId;
  agentName: string;
  status: string;
  children: React.ReactNode;
  caption: string | null;
  instruction: string | null;
  counter: string | null;
  verdict: string | null;
  action?: React.ReactNode;
  settled: boolean;
}) {
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      data-stage={stageId}
      data-settled={settled ? "true" : "false"}
      className={cn(
        "w-full max-w-[26rem] overflow-hidden rounded-2xl border border-border bg-card",
        settled && "opacity-70",
      )}
    >
      <div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
        <PersonaMark className="h-3.5 text-foreground" />
        <span className="text-[0.8125rem] font-medium leading-none">
          {agentName}
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
          {!settled ? (
            <motion.span
              className="size-1.5 rounded-full bg-foreground/70"
              animate={{ opacity: [1, 0.25, 1] }}
              transition={{ duration: 1.6, repeat: Infinity }}
            />
          ) : (
            <Check className="size-3" />
          )}
          {status}
        </span>
      </div>

      <div className="relative min-h-[8.5rem] bg-muted/40 px-4 pb-14 pt-4">
        {children}
        <AnimatePresence mode="popLayout">
          {caption ? (
            <motion.p
              key={caption}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.24 }}
              className="absolute inset-x-3 bottom-3.5 mx-auto w-fit max-w-[calc(100%-1.5rem)] rounded-full bg-foreground px-3 py-1.5 text-center text-[0.75rem] leading-snug text-background"
            >
              {caption}
            </motion.p>
          ) : null}
        </AnimatePresence>
      </div>

      {instruction || verdict ? (
        <div className="flex items-center gap-3 border-t border-border px-3.5 py-2.5">
          {verdict ? (
            <p className="flex items-center gap-1.5 text-[0.75rem] text-foreground">
              <Check className="size-3.5 shrink-0" strokeWidth={2.5} />
              {verdict}
            </p>
          ) : (
            <>
              <p className="min-w-0 flex-1 text-[0.75rem] leading-snug text-muted-foreground">
                {instruction}
              </p>
              {counter ? (
                <span className="shrink-0 text-[0.6875rem] tabular-nums text-muted-foreground">
                  {counter}
                </span>
              ) : null}
              {action}
            </>
          )}
        </div>
      ) : null}
    </motion.div>
  );
}

/** Runs a short script of captions, pausing between beats. */
function useScript(beats: { text: string; hold: number }[], run: boolean) {
  const [index, setIndex] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!run) return;
    if (index >= beats.length - 1) return;
    timer.current = setTimeout(
      () => setIndex((i) => Math.min(i + 1, beats.length - 1)),
      beats[index]?.hold ?? 1600,
    );
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [index, run, beats]);

  const done = index >= beats.length - 1;
  return { caption: beats[index]?.text ?? null, done, index };
}

/* ------------------------------------------------------------------ *
 * Naming
 * ------------------------------------------------------------------ */

const NAME_OPTIONS = ["Ada", "Scout", "Goose", "Wren"];

function NameStage({
  settled,
  result,
  onPick,
}: {
  settled: boolean;
  result?: string;
  onPick: (value: string) => void;
}) {
  const beats = useMemo(
    () => [
      { text: "This is me. No name yet.", hold: 1900 },
      { text: "Pick one, or type your own.", hold: 0 },
    ],
    [],
  );
  const { caption, done } = useScript(beats, !settled);
  const [chosen, setChosen] = useState<string | null>(result ?? null);

  const pick = (value: string) => {
    if (settled || chosen) return;
    setChosen(value);
    setTimeout(() => onPick(value), 520);
  };

  const named = Boolean(chosen);

  return (
    <StageShell
      stageId="name"
      agentName={chosen ?? "Persona"}
      status={settled || named ? "Named" : "Unnamed"}
      settled={settled}
      caption={settled ? null : named ? null : caption}
      instruction={settled || named ? null : "Tap a name, or type one below"}
      counter={null}
      verdict={named ? `${chosen}. That will do.` : null}
    >
      <div className="flex flex-col items-center gap-4">
        {/* The agent, unsettled until it has a name. */}
        <motion.div
          className="relative grid size-16 place-items-center"
          animate={
            named
              ? { scale: 1 }
              : { scale: [1, 1.04, 1], rotate: [0, -2.5, 0, 2.5, 0] }
          }
          transition={
            named
              ? { duration: 0.4, ease: [0.22, 1, 0.36, 1] }
              : { duration: 4.5, repeat: Infinity, ease: "easeInOut" }
          }
        >
          <motion.span
            className="absolute inset-0 rounded-full bg-foreground/10 blur-lg"
            animate={{ opacity: named ? 0.8 : [0.3, 0.6, 0.3] }}
            transition={{ duration: 2.4, repeat: named ? 0 : Infinity }}
          />
          <PersonaMark className="relative h-9 text-foreground" />
        </motion.div>

        <AnimatePresence mode="wait">
          {named ? (
            <motion.p
              key="named"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-[1.0625rem] font-medium tracking-tight"
            >
              {chosen}
            </motion.p>
          ) : (
            <motion.div
              key="options"
              initial={{ opacity: 0 }}
              animate={{ opacity: done ? 1 : 0.35 }}
              exit={{ opacity: 0 }}
              className="flex flex-wrap justify-center gap-1.5"
            >
              {NAME_OPTIONS.map((name) => (
                <Button
                  key={name}
                  size="sm"
                  variant="outline"
                  disabled={!done || settled}
                  onClick={() => pick(name)}
                  className="h-7 rounded-full border-border/70 bg-background px-3 text-[0.75rem] font-normal"
                >
                  {name}
                </Button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </StageShell>
  );
}

/* ------------------------------------------------------------------ *
 * Focus
 * ------------------------------------------------------------------ */

type FocusCard = { id: string; label: string; hint: string };

const FOCUS_CARDS: FocusCard[] = [
  { id: "inbox", label: "Inbox triage", hint: "Sort it before you see it" },
  { id: "followups", label: "Follow ups", hint: "Chase what went quiet" },
  { id: "scheduling", label: "Scheduling", hint: "Find the time, book it" },
  { id: "drafting", label: "Drafting replies", hint: "You approve, I send" },
  { id: "research", label: "Digging things up", hint: "Before the meeting" },
  { id: "admin", label: "Receipts and admin", hint: "The boring half" },
];

/** The one the agent volunteers for, before handing over. */
const AGENT_PICK = "inbox";
const MAX_PICKS = 3;

function FocusStage({
  agentName,
  settled,
  result,
  onDone,
}: {
  agentName: string;
  settled: boolean;
  result?: string;
  onDone: (value: string) => void;
}) {
  const beats = useMemo(
    () => [
      { text: "Here is what I am usually handed first.", hold: 1700 },
      { text: "Your turn. Tap what actually eats your week.", hold: 0 },
    ],
    [],
  );
  const { caption, done, index } = useScript(beats, !settled);
  // null means they have not touched it yet, which is when the agent's own
  // pick stands. Derived rather than written from an effect.
  const [touched, setTouched] = useState<string[] | null>(null);
  const [submitted, setSubmitted] = useState(Boolean(result));

  const picked = touched ?? (index >= 1 && !settled ? [AGENT_PICK] : []);

  const toggle = (id: string) => {
    if (settled || submitted) return;
    const current = picked;
    setTouched(
      current.includes(id)
        ? current.filter((x) => x !== id)
        : current.length >= MAX_PICKS
          ? current
          : [...current, id],
    );
  };

  const submit = () => {
    if (!picked.length || submitted) return;
    setSubmitted(true);
    const labels = picked.map(
      (id) => FOCUS_CARDS.find((c) => c.id === id)?.label.toLowerCase() ?? id,
    );
    const phrase =
      labels.length === 1
        ? labels[0]
        : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
    setTimeout(() => onDone(phrase), 480);
  };

  const remaining = MAX_PICKS - picked.length;

  return (
    <StageShell
      stageId="focus"
      agentName={agentName}
      status={settled || submitted ? "Set" : "Waiting on you"}
      settled={settled}
      caption={settled || submitted ? null : caption}
      instruction={
        settled || submitted
          ? null
          : done
            ? "Tap the ones that eat your week"
            : "Watch this"
      }
      counter={
        settled || submitted || !done
          ? null
          : remaining > 0
            ? `${remaining} left`
            : "Full"
      }
      verdict={submitted ? "Right. That is where I will start." : null}
      action={
        done && !settled && !submitted ? (
          <Button
            size="sm"
            disabled={!picked.length}
            onClick={submit}
            className="h-7 rounded-full px-3 text-[0.75rem]"
          >
            Done
          </Button>
        ) : null
      }
    >
      <div className="grid grid-cols-2 gap-1.5">
        {FOCUS_CARDS.map((card) => {
          const on = picked.includes(card.id);
          const byAgent = on && card.id === AGENT_PICK && picked.length === 1;
          return (
            <button
              key={card.id}
              type="button"
              disabled={settled || submitted || !done}
              onClick={() => toggle(card.id)}
              aria-pressed={on}
              className={cn(
                "group rounded-xl border px-2.5 py-2 text-left transition-all",
                "disabled:cursor-default",
                on
                  ? "border-foreground/80 bg-foreground text-background"
                  : "border-border bg-background hover:border-foreground/30",
                !done && !on && "opacity-45",
              )}
            >
              <span className="flex items-center gap-1.5">
                <span className="truncate text-[0.75rem] font-medium leading-tight">
                  {card.label}
                </span>
                {on ? (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="ml-auto shrink-0"
                  >
                    <Check className="size-3" strokeWidth={3} />
                  </motion.span>
                ) : null}
              </span>
              <span
                className={cn(
                  "mt-0.5 block truncate text-[0.6875rem] leading-tight",
                  on ? "text-background/65" : "text-muted-foreground",
                )}
              >
                {byAgent ? "I'll take this one" : card.hint}
              </span>
            </button>
          );
        })}
      </div>
    </StageShell>
  );
}

/* ------------------------------------------------------------------ *
 * Router
 * ------------------------------------------------------------------ */

export function AgentStage({
  message,
  agentName,
  /** True when the slot this panel collects has been filled some other way. */
  answeredElsewhere,
  onComplete,
}: {
  message: Message;
  agentName: string;
  answeredElsewhere: boolean;
  onComplete: (id: string, result: string) => void;
}) {
  const data = (message.data ?? {}) as {
    stageId?: StageId;
    status?: "active" | "done";
    result?: string;
  };
  // Someone who types their answer should not be left looking at a panel that
  // still wants to be tapped.
  const settled = data.status === "done" || answeredElsewhere;

  const complete = useCallback(
    (result: string) => onComplete(message.id, result),
    [message.id, onComplete],
  );

  if (data.stageId === "name")
    return (
      <NameStage settled={settled} result={data.result} onPick={complete} />
    );
  if (data.stageId === "focus")
    return (
      <FocusStage
        agentName={agentName}
        settled={settled}
        result={data.result}
        onDone={complete}
      />
    );
  return null;
}
