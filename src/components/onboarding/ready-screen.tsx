"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, Check, Plus, RotateCcw } from "lucide-react";

import type { Plan } from "@/app/api/plan/route";
import { PersonaMark } from "@/components/persona-logo";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { displayAgentName } from "@/lib/onboarding/slots";
import { SLOT_IDS, SLOT_LABEL, type Profile } from "@/lib/onboarding/types";
import { cn } from "@/lib/utils";

export function ReadyScreen({
  profile,
  onBack,
  onReset,
}: {
  profile: Profile;
  onBack: () => void;
  onReset: () => void;
}) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const name = displayAgentName(profile);
  const first = profile.slots.userName.value?.split(" ")[0];
  const missing = SLOT_IDS.filter((id) => !profile.slots[id].value);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile }),
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((p: Plan | null) => p && setPlan(p))
      .catch(() => {
        /* the screen reads fine without it */
      });
    return () => controller.abort();
    // Fetched once, on the profile as it stood when onboarding ended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="mx-auto flex w-full max-w-[34rem] flex-col px-6 py-12 sm:py-20"
    >
      <motion.span
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.08, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="mb-7 inline-flex size-12 items-center justify-center rounded-2xl bg-foreground text-background"
      >
        <PersonaMark className="h-6" />
      </motion.span>

      <h1 className="text-[1.75rem] font-medium leading-tight tracking-[-0.02em]">
        {name} is ready{first ? `, ${first}` : ""}.
      </h1>
      <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted-foreground">
        {profile.slots.need.value
          ? "Everything below is set. Here is what happens first."
          : "Everything below is set. Point me at something and I will get going."}
      </p>

      {/* What was collected */}
      <div className="mt-8 rounded-2xl border border-border">
        {SLOT_IDS.map((id, i) => {
          const slot = profile.slots[id];
          const filled = Boolean(slot.value);
          return (
            <div key={id}>
              {i > 0 ? <Separator /> : null}
              <div className="flex items-center gap-3 px-4 py-3">
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full",
                    filled
                      ? "bg-foreground text-background"
                      : "border border-dashed border-border text-muted-foreground",
                  )}
                >
                  {filled ? (
                    <Check className="size-3" strokeWidth={3} />
                  ) : (
                    <Plus className="size-3" />
                  )}
                </span>
                <span className="w-24 shrink-0 text-[0.8125rem] text-muted-foreground">
                  {SLOT_LABEL[id]}
                </span>
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-[0.875rem]",
                    !filled && "text-muted-foreground/70",
                  )}
                  title={slot.value ?? undefined}
                >
                  {slot.value ?? "Add later"}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* The plan */}
      <div className="mt-8">
        <p className="text-[0.75rem] font-medium uppercase tracking-[0.07em] text-muted-foreground">
          First on my list
        </p>
        <AnimatePresence mode="wait">
          {plan ? (
            <motion.div
              key="plan"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
              className="mt-3"
            >
              <p className="text-[0.9375rem] leading-relaxed">{plan.opening}</p>
              <ol className="mt-4 space-y-3.5">
                {plan.steps.map((step, i) => (
                  <motion.li
                    key={step.title}
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 + i * 0.08, duration: 0.3 }}
                    className="flex gap-3"
                  >
                    <span className="mt-[3px] flex size-5 shrink-0 items-center justify-center rounded-full border border-border text-[0.6875rem] font-medium tabular-nums text-muted-foreground">
                      {i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[0.875rem] font-medium leading-snug">
                        {step.title}
                      </span>
                      <span className="mt-0.5 block text-[0.8125rem] leading-relaxed text-muted-foreground">
                        {step.detail}
                      </span>
                    </span>
                  </motion.li>
                ))}
              </ol>
            </motion.div>
          ) : (
            <div key="skeleton" className="mt-3 space-y-3">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          )}
        </AnimatePresence>
      </div>

      <div className="mt-10 flex flex-wrap items-center gap-2">
        <Button variant="outline" className="gap-2" onClick={onBack}>
          <ArrowLeft className="size-4" />
          {missing.length ? "Add what's missing" : "Back to the conversation"}
        </Button>
        <Button
          variant="ghost"
          className="gap-2 text-muted-foreground hover:text-foreground"
          onClick={onReset}
        >
          <RotateCcw className="size-4" />
          Start over
        </Button>
      </div>

      <p className="mt-8 text-[0.75rem] leading-relaxed text-muted-foreground/70">
        This is where onboarding hands off to the product. Nothing here touches
        a real mailbox.
      </p>
    </motion.div>
  );
}
