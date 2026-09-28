"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Mic } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const MAX = 2000;

export function Composer({
  onSend,
  onCall,
  disabled,
  placeholder,
  showCall,
  autoFocus = true,
  variant = "page",
}: {
  onSend: (text: string) => void;
  onCall?: () => void;
  disabled?: boolean;
  placeholder: string;
  showCall?: boolean;
  autoFocus?: boolean;
  variant?: "page" | "call";
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow with the content, up to a point, then scroll.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [value]);

  useEffect(() => {
    if (autoFocus && !disabled) ref.current?.focus();
  }, [autoFocus, disabled]);

  const submit = () => {
    const text = value.trim();
    if (!text) return;
    setValue("");
    onSend(text);
    requestAnimationFrame(() => ref.current?.focus());
  };

  const overLimit = value.length > MAX;

  return (
    <div
      className={cn(
        "group relative flex w-full items-end gap-2 rounded-2xl border border-border bg-background px-2.5 py-2 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-all",
        "focus-within:border-foreground/25 focus-within:shadow-[0_2px_12px_rgba(0,0,0,0.06)]",
        variant === "call" &&
          "border-white/15 bg-white/8 backdrop-blur focus-within:border-white/35",
        overLimit && "border-destructive/60",
      )}
    >
      <textarea
        ref={ref}
        rows={1}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        aria-label="Message"
        onChange={(e) => setValue(e.target.value.slice(0, MAX + 200))}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        className={cn(
          "max-h-[168px] min-h-[36px] flex-1 resize-none border-0 bg-transparent px-2 py-1.5 text-[0.9375rem] leading-[1.5] outline-none",
          "placeholder:text-muted-foreground/70 disabled:opacity-60",
          variant === "call" && "text-white placeholder:text-white/40",
        )}
      />

      <div className="flex shrink-0 items-center gap-1 pb-0.5">
        {showCall && onCall ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="Talk instead of typing"
                  className={cn(
                    "size-9 rounded-full border border-border text-foreground/80",
                    "hover:border-foreground/30 hover:bg-accent hover:text-foreground",
                    // Voice is the point. When the box is empty it is the
                    // brighter of the two things you can do.
                    !value.trim() && "border-foreground/25",
                  )}
                  onClick={onCall}
                  disabled={disabled}
                >
                  <Mic className="size-4" />
                </Button>
              }
            />
            <TooltipContent side="top">Talk to it</TooltipContent>
          </Tooltip>
        ) : null}
        <Button
          type="button"
          size="icon"
          aria-label="Send"
          className={cn(
            "size-9 rounded-full transition-opacity",
            !value.trim() && "opacity-35",
            variant === "call" && "bg-white text-neutral-900 hover:bg-white/90",
          )}
          onClick={submit}
          disabled={disabled || !value.trim() || overLimit}
        >
          <ArrowUp className="size-4" />
        </Button>
      </div>

      {overLimit ? (
        <span className="absolute -top-5 right-1 text-[0.6875rem] text-destructive">
          {value.length}/{MAX}
        </span>
      ) : null}
    </div>
  );
}
