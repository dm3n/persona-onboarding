import { cn } from "@/lib/utils";

/**
 * The Persona mark: two petals sharing a top apex and a bottom fork.
 * Drawn as strokes so it stays crisp at any size and inherits currentColor.
 */
export function PersonaMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 45 44"
      className={cn("h-full w-auto", className)}
      role="presentation"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={4.65}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22.6 2.3C17.6 2.6 13.6 5.4 10.1 10.2 5.5 16.6 2.3 24.6 2.2 31.2c-.1 6.2 2.9 10.4 7.6 10.5 4.4.1 8.8-3.1 12.1-7.5 3.3 4.4 7.7 7.6 12.1 7.5 4.7-.1 8.7-4.3 8.6-10.5-.1-6.6-3.3-14.6-7.9-21C31.2 5.4 27.6 2.6 22.6 2.3Z" />
      <path d="M22.6 2.3c3.8 3.3 6 7.4 5.9 11.9-.1 6.4-2.3 13.2-6.6 20" />
    </svg>
  );
}

export function PersonaLogo({
  className,
  wordmark = true,
}: {
  className?: string;
  wordmark?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex select-none items-center gap-[0.42em] text-foreground",
        className,
      )}
    >
      <PersonaMark className="h-[1.38em]" />
      {wordmark ? (
        <span className="text-[1em] font-medium leading-none tracking-[-0.021em]">
          Persona
        </span>
      ) : null}
      <span className="sr-only">Persona</span>
    </span>
  );
}
