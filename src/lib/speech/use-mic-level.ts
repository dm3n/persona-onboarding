"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Root mean square of the microphone, 0 to 1, smoothed for display.
 *
 * Purely cosmetic: it drives the orb. If the browser refuses the stream the
 * hook simply reports silence and the call carries on.
 */
export function useMicLevel(active: boolean) {
  const [level, setLevel] = useState(0);
  const [granted, setGranted] = useState<boolean | null>(null);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let cancelled = false;

    const run = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setGranted(false);
          return;
        }
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        setGranted(true);
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        ctx = new Ctor();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.75;
        source.connect(analyser);
        const buf = new Float32Array(analyser.fftSize);

        const tick = () => {
          if (cancelled) return;
          analyser.getFloatTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
          const rms = Math.sqrt(sum / buf.length);
          setLevel((prev) => {
            const target = Math.min(1, rms * 7);
            return prev + (target - prev) * 0.35;
          });
          raf.current = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        setGranted(false);
      }
    };
    void run();

    return () => {
      cancelled = true;
      if (raf.current) cancelAnimationFrame(raf.current);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close().catch(() => {});
    };
  }, [active]);

  // Reported as silence while inactive rather than reset through an effect.
  return { level: active ? level : 0, granted };
}
