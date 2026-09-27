"use client";

import { AnimatePresence, motion } from "motion/react";
import { Mic, PhoneOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Message } from "@/lib/onboarding/types";

export function TypingDots({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-1" aria-live="polite">
      <span className="sr-only">{label ?? "Typing"}</span>
      <span className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="size-1.5 rounded-full bg-muted-foreground/60"
            animate={{ opacity: [0.25, 1, 0.25], y: [0, -2, 0] }}
            transition={{
              duration: 1.1,
              repeat: Infinity,
              delay: i * 0.14,
              ease: "easeInOut",
            }}
          />
        ))}
      </span>
    </div>
  );
}

function Paragraphs({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).filter((b) => b.trim());
  return (
    <>
      {blocks.map((block, i) => (
        <p key={i} className={cn(i > 0 && "mt-3")}>
          {block.split("\n").map((line, j, arr) => (
            <span key={j}>
              {line}
              {j < arr.length - 1 ? <br /> : null}
            </span>
          ))}
        </p>
      ))}
    </>
  );
}

export function AssistantMessage({
  message,
  onSuggestion,
  showSuggestions,
}: {
  message: Message;
  onSuggestion: (value: string) => void;
  showSuggestions: boolean;
}) {
  const empty = !message.text.trim();
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="w-full max-w-[36rem]"
    >
      {empty && message.pending ? (
        <TypingDots />
      ) : (
        <div
          className={cn(
            "text-[0.9375rem] leading-[1.65] text-foreground",
            message.errored && "text-muted-foreground",
          )}
        >
          <Paragraphs text={message.text} />
          {message.pending ? (
            <span className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[0.18em] animate-pulse rounded-full bg-foreground/50 align-middle" />
          ) : null}
        </div>
      )}

      <AnimatePresence>
        {showSuggestions && message.suggestions?.length ? (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, delay: 0.06 }}
            className="mt-3 flex flex-wrap gap-2"
          >
            {message.suggestions.map((s) => (
              <Button
                key={s}
                type="button"
                size="sm"
                variant="outline"
                className="h-8 rounded-full border-border/70 bg-transparent px-3.5 text-[0.8125rem] font-normal text-muted-foreground transition-colors hover:border-border hover:bg-accent hover:text-foreground"
                onClick={() => onSuggestion(s)}
              >
                {s}
              </Button>
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}

export function UserMessage({ message }: { message: Message }) {
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      className="flex w-full justify-end"
    >
      <div className="max-w-[80%] rounded-2xl rounded-br-md bg-muted px-4 py-2.5 text-[0.9375rem] leading-[1.6] text-foreground">
        {message.viaVoice ? (
          <span className="mr-1.5 inline-flex translate-y-[-1px] items-center text-muted-foreground">
            <Mic className="size-3.5" aria-label="Said on the call" />
          </span>
        ) : null}
        {message.text}
      </div>
    </motion.div>
  );
}

export function CallSummaryMessage({ message }: { message: Message }) {
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex w-full items-center gap-3 py-1"
    >
      <span className="h-px flex-1 bg-border" />
      <span className="inline-flex items-center gap-1.5 text-[0.75rem] font-medium text-muted-foreground">
        <PhoneOff className="size-3" />
        {message.text}
      </span>
      <span className="h-px flex-1 bg-border" />
    </motion.div>
  );
}
