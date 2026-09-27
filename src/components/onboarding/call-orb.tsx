"use client";

import { motion } from "motion/react";

import { cn } from "@/lib/utils";

export type OrbMode =
  "idle" | "ringing" | "connecting" | "speaking" | "listening";

/**
 * The thing you look at while you talk.
 *
 * Listening scales with the real microphone level. Speaking uses a steady
 * breathing loop, because the synthesiser gives us no amplitude to read.
 */
export function CallOrb({
  mode,
  level,
  className,
}: {
  mode: OrbMode;
  level: number;
  className?: string;
}) {
  const amp = mode === "listening" ? Math.min(1, level) : 0;

  return (
    <div
      className={cn("relative grid size-44 place-items-center", className)}
      aria-hidden="true"
    >
      {/* Outer halo */}
      <motion.div
        className="absolute inset-0 rounded-full bg-white/10 blur-2xl"
        animate={{
          scale:
            mode === "speaking"
              ? [1, 1.16, 1]
              : mode === "ringing"
                ? [1, 1.25, 1]
                : 1 + amp * 0.3,
          opacity: mode === "idle" ? 0.4 : 0.85,
        }}
        transition={
          mode === "speaking"
            ? { duration: 1.7, repeat: Infinity, ease: "easeInOut" }
            : mode === "ringing"
              ? { duration: 1.4, repeat: Infinity, ease: "easeInOut" }
              : { duration: 0.12 }
        }
      />

      {/* Pulse rings while ringing */}
      {mode === "ringing"
        ? [0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="absolute size-28 rounded-full border border-white/25"
              initial={{ scale: 0.75, opacity: 0.6 }}
              animate={{ scale: 1.65, opacity: 0 }}
              transition={{
                duration: 2.1,
                repeat: Infinity,
                delay: i * 0.7,
                ease: "easeOut",
              }}
            />
          ))
        : null}

      {/* Listening ring follows the voice */}
      <motion.span
        className="absolute rounded-full border border-white/30"
        animate={{
          width: 128 + amp * 54,
          height: 128 + amp * 54,
          opacity: mode === "listening" ? 0.35 + amp * 0.5 : 0,
        }}
        transition={{ duration: 0.14, ease: "easeOut" }}
      />

      {/* Core */}
      <motion.div
        className="relative size-28 rounded-full shadow-[0_10px_50px_-8px_rgba(255,255,255,0.35)]"
        animate={{
          scale:
            mode === "speaking"
              ? [1, 1.06, 0.99, 1.04, 1]
              : mode === "connecting"
                ? [1, 0.97, 1]
                : 1 + amp * 0.1,
        }}
        transition={
          mode === "speaking"
            ? { duration: 1.5, repeat: Infinity, ease: "easeInOut" }
            : mode === "connecting"
              ? { duration: 1, repeat: Infinity, ease: "easeInOut" }
              : { duration: 0.12 }
        }
      >
        {/* A soft top lit sphere rather than a flat disc. */}
        <span className="absolute inset-0 rounded-full bg-[radial-gradient(120%_120%_at_50%_18%,#ffffff_0%,#f4f4f5_46%,#b8b8bd_100%)]" />
        <span className="absolute inset-0 rounded-full bg-[radial-gradient(60%_45%_at_50%_16%,rgba(255,255,255,0.95)_0%,rgba(255,255,255,0)_70%)]" />
        <span className="absolute inset-0 rounded-full ring-1 ring-inset ring-white/60" />
      </motion.div>
    </div>
  );
}
