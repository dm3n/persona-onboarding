"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type { Profile } from "@/lib/onboarding/types";

export type RealtimeStatus =
  "idle" | "connecting" | "live" | "ending" | "failed";

export type RealtimeFailure =
  "mic_denied" | "unsupported" | "no_token" | "network" | "dropped";

export type RealtimeHandlers = {
  /** They have started talking. Nothing transcribed yet. */
  onUserStarted(): void;
  /** The user's words as they are still being transcribed. */
  onUserPartial(text: string): void;
  /** A finished thing the user said. */
  onUserSaid(text: string): void;
  /** A finished thing the agent said. */
  onAgentSaid(text: string): void;
  /** The agent's sentence as it is being spoken. */
  onAgentPartial(text: string): void;
  /** A tool the agent called. Whatever is returned goes back to the model. */
  onTool(name: string, args: Record<string, unknown>): unknown;
  onStatus(status: RealtimeStatus): void;
  onFailure(kind: RealtimeFailure, detail?: string): void;
};

type Levels = { input: number; output: number };

/**
 * A live call with the model, over WebRTC.
 *
 * Audio goes straight from the microphone to OpenAI and back, so the only
 * thing this app is in the middle of is the conversation itself. The browser
 * never sees the API key: the server mints a token that is good for one short
 * session, and that is what signs the handshake.
 */
export function useRealtimeCall(handlers: RealtimeHandlers) {
  const [status, setStatus] = useState<RealtimeStatus>("idle");
  const [muted, setMuted] = useState(false);
  const [levels, setLevels] = useState<Levels>({ input: 0, output: 0 });

  const pc = useRef<RTCPeerConnection | null>(null);
  const channel = useRef<RTCDataChannel | null>(null);
  const localStream = useRef<MediaStream | null>(null);
  const audioEl = useRef<HTMLAudioElement | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const raf = useRef<number | null>(null);
  const partial = useRef("");
  const heardSoFar = useRef("");
  const stopped = useRef(false);
  const dropTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Handlers change every render; the connection outlives them, so it reads
  // through a ref that is refreshed before anything can fire.
  const h = useRef(handlers);
  useLayoutEffect(() => {
    h.current = handlers;
  }, [handlers]);

  const move = useCallback((next: RealtimeStatus) => {
    setStatus(next);
    h.current.onStatus(next);
  }, []);

  const teardown = useCallback(() => {
    stopped.current = true;
    if (dropTimer.current) clearTimeout(dropTimer.current);
    dropTimer.current = null;
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    try {
      channel.current?.close();
    } catch {
      /* already gone */
    }
    channel.current = null;
    try {
      pc.current?.getSenders().forEach((s) => s.track?.stop());
      pc.current?.close();
    } catch {
      /* already gone */
    }
    pc.current = null;
    localStream.current?.getTracks().forEach((t) => t.stop());
    localStream.current = null;
    if (audioEl.current) {
      audioEl.current.srcObject = null;
      audioEl.current.remove();
      audioEl.current = null;
    }
    void audioCtx.current?.close().catch(() => {});
    audioCtx.current = null;
    partial.current = "";
    heardSoFar.current = "";
    setLevels({ input: 0, output: 0 });
  }, []);

  const send = useCallback((payload: Record<string, unknown>) => {
    const ch = channel.current;
    if (!ch || ch.readyState !== "open") return;
    try {
      ch.send(JSON.stringify(payload));
    } catch {
      /* the socket went away mid turn */
    }
  }, []);

  const stop = useCallback(() => {
    if (status === "idle") return;
    move("ending");
    teardown();
    move("idle");
  }, [move, status, teardown]);

  const toggleMute = useCallback(() => {
    setMuted((was) => {
      const next = !was;
      localStream.current?.getAudioTracks().forEach((t) => {
        t.enabled = !next;
      });
      return next;
    });
  }, []);

  /** Meters both directions so the orb can react to whoever is talking. */
  const meter = useCallback((local: MediaStream, remote: MediaStream) => {
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new Ctor();
      audioCtx.current = ctx;

      const make = (stream: MediaStream) => {
        const node = ctx.createAnalyser();
        node.fftSize = 512;
        node.smoothingTimeConstant = 0.7;
        ctx.createMediaStreamSource(stream).connect(node);
        // Backed explicitly so the buffer type is not widened to SharedArrayBuffer.
        const buf = new Float32Array(new ArrayBuffer(node.fftSize * 4));
        return { node, buf };
      };
      const a = make(local);
      const b = make(remote);

      const rms = ({
        node,
        buf,
      }: {
        node: AnalyserNode;
        buf: Float32Array<ArrayBuffer>;
      }) => {
        node.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        return Math.sqrt(sum / buf.length);
      };

      const tick = () => {
        if (stopped.current) return;
        const input = Math.min(1, rms(a) * 7);
        const output = Math.min(1, rms(b) * 7);
        setLevels((prev) => ({
          input: prev.input + (input - prev.input) * 0.35,
          output: prev.output + (output - prev.output) * 0.35,
        }));
        raf.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      /* metering is decoration; the call works without it */
    }
  }, []);

  const handleEvent = useCallback(
    (event: Record<string, unknown>) => {
      const type = String(event.type ?? "");
      if (
        process.env.NODE_ENV !== "production" &&
        typeof window !== "undefined"
      ) {
        // A tap for local debugging and the end to end probe. Realtime is
        // chatty and this is the cheapest way to see what actually arrived.
        const w = window as unknown as { __rtEvents?: string[] };
        (w.__rtEvents ??= []).push(type);
      }

      switch (type) {
        case "input_audio_buffer.speech_started": {
          /*
           * Claim their place in the transcript the moment they open their
           * mouth. Transcription runs alongside the model rather than ahead of
           * it, so waiting for the first word would file what they said after
           * the answer to it.
           */
          heardSoFar.current = "";
          h.current.onUserStarted();
          break;
        }
        case "conversation.item.input_audio_transcription.delta": {
          heardSoFar.current += String(event.delta ?? "");
          h.current.onUserPartial(heardSoFar.current);
          break;
        }
        case "conversation.item.input_audio_transcription.completed": {
          const text = String(event.transcript ?? heardSoFar.current).trim();
          heardSoFar.current = "";
          h.current.onUserPartial("");
          if (text) h.current.onUserSaid(text);
          break;
        }
        case "response.output_audio_transcript.delta": {
          partial.current += String(event.delta ?? "");
          h.current.onAgentPartial(partial.current);
          break;
        }
        case "response.output_audio_transcript.done": {
          const text = String(event.transcript ?? partial.current).trim();
          partial.current = "";
          h.current.onAgentPartial("");
          if (text) h.current.onAgentSaid(text);
          break;
        }
        case "response.done": {
          const response = event.response as
            | {
                output?: {
                  type?: string;
                  name?: string;
                  call_id?: string;
                  arguments?: string;
                }[];
              }
            | undefined;
          const calls = (response?.output ?? []).filter(
            (o) => o?.type === "function_call",
          );
          if (!calls.length) break;
          for (const call of calls) {
            let args: Record<string, unknown> = {};
            try {
              args = call.arguments ? JSON.parse(call.arguments) : {};
            } catch {
              args = {};
            }
            const result = h.current.onTool(String(call.name ?? ""), args);
            send({
              type: "conversation.item.create",
              item: {
                type: "function_call_output",
                call_id: call.call_id,
                output: JSON.stringify(result ?? { ok: true }),
              },
            });
          }
          // Let it speak again now that it has the results.
          send({ type: "response.create" });
          break;
        }
        case "error": {
          const err = event.error as { message?: string } | undefined;
          console.warn("[realtime] server error", err?.message);
          break;
        }
        default:
          break;
      }
    },
    [send],
  );

  const start = useCallback(
    async (profile: Profile) => {
      if (status !== "idle" && status !== "failed") return;
      stopped.current = false;
      move("connecting");

      if (
        typeof RTCPeerConnection === "undefined" ||
        !navigator.mediaDevices?.getUserMedia
      ) {
        h.current.onFailure("unsupported");
        move("failed");
        return;
      }

      let token: string;
      try {
        const res = await fetch("/api/realtime/token", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ profile }),
        });
        if (!res.ok) throw new Error(`token_${res.status}`);
        const data = (await res.json()) as { value?: string };
        if (!data.value) throw new Error("no_token");
        token = data.value;
      } catch (err) {
        h.current.onFailure("no_token", String(err));
        move("failed");
        return;
      }
      if (stopped.current) return;

      let mic: MediaStream;
      try {
        mic = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch {
        h.current.onFailure("mic_denied");
        move("failed");
        return;
      }
      if (stopped.current) {
        mic.getTracks().forEach((t) => t.stop());
        return;
      }
      localStream.current = mic;

      try {
        const connection = new RTCPeerConnection();
        pc.current = connection;

        const el = document.createElement("audio");
        el.autoplay = true;
        el.style.display = "none";
        document.body.appendChild(el);
        audioEl.current = el;

        const remote = new MediaStream();
        connection.ontrack = (e) => {
          e.streams[0]?.getAudioTracks().forEach((t) => remote.addTrack(t));
          el.srcObject = e.streams[0] ?? remote;
          void el.play().catch(() => {});
          meter(mic, e.streams[0] ?? remote);
        };

        connection.onconnectionstatechange = () => {
          const s = connection.connectionState;
          if (stopped.current) return;
          if (dropTimer.current) {
            clearTimeout(dropTimer.current);
            dropTimer.current = null;
          }
          if (s === "failed" || s === "closed") {
            h.current.onFailure("dropped", s);
            teardown();
            move("failed");
            return;
          }
          if (s === "disconnected") {
            /*
             * A blip, usually. WebRTC reports "disconnected" for a lost packet
             * run and then heals itself a second later, so ending the call on
             * the first one hangs up on people who never lost the thread.
             */
            dropTimer.current = setTimeout(() => {
              if (stopped.current) return;
              if (connection.connectionState === "connected") return;
              h.current.onFailure("dropped", connection.connectionState);
              teardown();
              move("failed");
            }, 5000);
          }
        };

        mic.getTracks().forEach((t) => connection.addTrack(t, mic));

        const ch = connection.createDataChannel("oai-events");
        channel.current = ch;
        ch.onmessage = (e) => {
          try {
            handleEvent(JSON.parse(e.data as string));
          } catch {
            /* a frame we do not understand is not fatal */
          }
        };
        ch.onopen = () => {
          if (stopped.current) return;
          move("live");
          // The model waits to be spoken to unless told otherwise.
          send({ type: "response.create" });
        };

        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);

        const sdp = await fetch("https://api.openai.com/v1/realtime/calls", {
          method: "POST",
          body: offer.sdp,
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/sdp",
          },
        });
        if (!sdp.ok) throw new Error(`sdp_${sdp.status}`);
        const answer = await sdp.text();
        if (stopped.current) return;
        await connection.setRemoteDescription({ type: "answer", sdp: answer });
      } catch (err) {
        console.warn("[realtime] connect failed", err);
        h.current.onFailure("network", String(err));
        teardown();
        move("failed");
      }
    },
    [handleEvent, meter, move, send, status, teardown],
  );

  useEffect(() => teardown, [teardown]);

  return {
    status,
    muted,
    levels,
    start,
    stop,
    toggleMute,
    /** Type at the agent mid call. It answers out loud. */
    sendText: useCallback(
      (text: string) => {
        const clean = text.trim();
        if (!clean) return;
        send({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: clean }],
          },
        });
        send({ type: "response.create" });
      },
      [send],
    ),
    /** Tell the agent something that happened on screen, out of band. */
    nudge: useCallback(
      (instruction: string) => {
        send({
          type: "response.create",
          response: { instructions: instruction },
        });
      },
      [send],
    ),
  };
}
