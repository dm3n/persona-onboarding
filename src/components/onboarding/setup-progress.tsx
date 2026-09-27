"use client";

import { Check, RotateCcw } from "lucide-react";
import { motion } from "motion/react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  SLOT_HINT,
  SLOT_IDS,
  SLOT_LABEL,
  type Profile,
} from "@/lib/onboarding/types";

export function SetupProgress({
  profile,
  onReset,
}: {
  profile: Profile;
  onReset: () => void;
}) {
  const done = SLOT_IDS.filter((id) => profile.slots[id].value).length;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-2 rounded-full px-2.5 text-muted-foreground hover:text-foreground"
            aria-label={`Setup progress, ${done} of 4 collected`}
          >
            <span className="flex items-center gap-1">
              {SLOT_IDS.map((id) => {
                const filled = Boolean(profile.slots[id].value);
                const skipped = profile.slots[id].declined && !filled;
                return (
                  <motion.span
                    key={id}
                    layout
                    animate={{ scale: filled ? [1, 1.4, 1] : 1 }}
                    transition={{ duration: 0.4 }}
                    className={cn(
                      "size-1.5 rounded-full transition-colors",
                      filled
                        ? "bg-foreground"
                        : skipped
                          ? "bg-muted-foreground/30"
                          : "bg-border",
                    )}
                  />
                );
              })}
            </span>
            <span className="text-[0.75rem] font-medium tabular-nums">
              {done}/4
            </span>
          </Button>
        }
      />
      <PopoverContent align="end" sideOffset={10} className="w-72 p-0">
        <div className="px-4 pb-1 pt-3.5">
          <p className="text-[0.8125rem] font-medium">Setup</p>
          <p className="mt-0.5 text-[0.75rem] text-muted-foreground">
            Anything skipped can be added later.
          </p>
        </div>
        <div className="p-2">
          {SLOT_IDS.map((id) => {
            const slot = profile.slots[id];
            const filled = Boolean(slot.value);
            return (
              <div
                key={id}
                className="flex items-start gap-2.5 rounded-md px-2 py-1.5"
              >
                <span
                  className={cn(
                    "mt-[3px] flex size-4 shrink-0 items-center justify-center rounded-full border",
                    filled
                      ? "border-foreground bg-foreground text-background"
                      : "border-border",
                  )}
                >
                  {filled ? (
                    <Check className="size-2.5" strokeWidth={3} />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.8125rem] leading-tight">
                    {SLOT_LABEL[id]}
                  </span>
                  <span className="mt-0.5 block truncate text-[0.75rem] text-muted-foreground">
                    {filled
                      ? slot.value
                      : slot.declined
                        ? "Skipped"
                        : SLOT_HINT[id]}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
        <Separator />
        <div className="p-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-full justify-start gap-2 text-[0.8125rem] font-normal text-muted-foreground hover:text-foreground"
            onClick={onReset}
          >
            <RotateCcw className="size-3.5" />
            Start over
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
