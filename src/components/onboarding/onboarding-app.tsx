"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { AnimatePresence } from "motion/react";

import { PersonaLogo } from "@/components/persona-logo";
import { IncomingCall, VoiceBar } from "@/components/onboarding/voice-bar";
import { Composer } from "@/components/onboarding/composer";
import { GmailCard, GmailDialog } from "@/components/onboarding/gmail-connect";
import { AgentStage } from "@/components/onboarding/agent-stage";
import {
  AssistantMessage,
  CallSummaryMessage,
  UserMessage,
} from "@/components/onboarding/message-view";
import { ReadyScreen } from "@/components/onboarding/ready-screen";
import { SetupProgress } from "@/components/onboarding/setup-progress";
import { useOnboarding } from "@/lib/onboarding/use-onboarding";
import { displayAgentName } from "@/lib/onboarding/slots";
import type { StageId } from "@/lib/onboarding/types";
import { cn } from "@/lib/utils";

export function OnboardingApp() {
  const o = useOnboarding();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // Follow the conversation unless the reader has scrolled up to re-read.
  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottom.current = distance < 120;
  }, []);

  useLayoutEffect(() => {
    if (!stickToBottom.current) return;
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [o.messages, o.busy]);

  useEffect(() => {
    stickToBottom.current = true;
  }, [o.profile.phase]);

  const lastAssistantId = [...o.messages]
    .reverse()
    .find((m) => m.role === "assistant" && m.kind === "text")?.id;

  const agentName = displayAgentName(o.profile);
  const inCall = o.call.status === "live" || o.call.status === "connecting";
  const ready = o.profile.phase === "ready";

  const placeholder = !o.profile.slots.agentName.value
    ? "Name your Persona"
    : o.busy
      ? `${agentName} is thinking`
      : "Reply";

  return (
    <div
      className="relative flex h-dvh flex-col overflow-hidden"
      // Stable hooks for end to end tests; nothing reads these at runtime.
      data-phase={o.profile.phase}
      data-busy={o.busy ? "true" : "false"}
      data-call={o.call.status}
      data-collected={o.collected}
      data-hydrated={o.hydrated ? "true" : "false"}
    >
      {/* Quiet corner chrome */}
      <header className="z-20 flex shrink-0 items-center justify-between gap-4 px-5 pb-4 pt-5 sm:px-8 sm:pt-6">
        <PersonaLogo className="text-[0.9375rem] text-foreground/85" />
        {!ready ? (
          <SetupProgress profile={o.profile} onReset={o.reset} />
        ) : null}
      </header>

      {ready ? (
        <main className="min-h-0 flex-1 overflow-y-auto">
          <ReadyScreen
            profile={o.profile}
            onBack={() => o.send("Actually, let's keep going.")}
            onReset={o.reset}
          />
        </main>
      ) : (
        <main className="flex min-h-0 flex-1 flex-col">
          <div
            ref={scrollerRef}
            onScroll={onScroll}
            className="flex-1 overflow-y-auto overscroll-contain scrollbar-stable"
          >
            <div
              className={cn(
                "mx-auto flex min-h-full w-full max-w-[40rem] flex-col gap-5 px-5 pb-6 pt-10 sm:px-8",
                // The opening sits in the middle of the screen like a title
                // card. Once there is a conversation it behaves like one.
                o.messages.length <= 2 ? "justify-center" : "justify-end",
              )}
            >
              <AnimatePresence initial={false} mode="popLayout">
                {o.messages.map((m) => {
                  if (m.kind === "call-summary")
                    return <CallSummaryMessage key={m.id} message={m} />;
                  if (m.kind === "stage") {
                    const stageId = (m.data as { stageId?: StageId })?.stageId;
                    const slot = stageId === "name" ? "agentName" : "need";
                    return (
                      <AgentStage
                        key={m.id}
                        message={m}
                        agentName={agentName}
                        answeredElsewhere={Boolean(
                          o.profile.slots[slot].value ||
                          o.profile.slots[slot].declined,
                        )}
                        onComplete={o.completeStage}
                      />
                    );
                  }
                  if (m.kind === "gmail-card")
                    return (
                      <GmailCard
                        key={m.id}
                        connected={Boolean(o.profile.slots.gmail.value)}
                        email={o.profile.slots.gmail.value}
                        onOpen={o.openGmail}
                      />
                    );
                  if (m.role === "user")
                    return <UserMessage key={m.id} message={m} />;
                  return (
                    <AssistantMessage
                      key={m.id}
                      message={m}
                      onSuggestion={o.send}
                      showSuggestions={m.id === lastAssistantId && !o.busy}
                    />
                  );
                })}
              </AnimatePresence>
              <div ref={endRef} className="h-px" />
            </div>
          </div>

          <div className="shrink-0 bg-gradient-to-t from-background via-background to-transparent pb-5 pt-3 sm:pb-7">
            <div className="mx-auto w-full max-w-[40rem] px-5 sm:px-8">
              <AnimatePresence mode="popLayout">
                {o.call.status === "ringing" ? (
                  <div key="ring" className="mb-2.5">
                    <IncomingCall
                      agentName={agentName}
                      onAnswer={o.answerCall}
                      onDecline={o.declineCall}
                    />
                  </div>
                ) : inCall ? (
                  <div key="live" className="mb-2.5">
                    <VoiceBar
                      call={o.call}
                      agentName={agentName}
                      onEnd={() => o.endCall("hungup")}
                      onToggleMute={o.toggleMute}
                    />
                  </div>
                ) : null}
              </AnimatePresence>

              <Composer
                onSend={o.send}
                onCall={o.startCall}
                showCall={!o.profile.callRefused && !inCall}
                placeholder={
                  inCall ? "Type instead, I'm still listening" : placeholder
                }
              />
              <p className="mt-2.5 text-center text-[0.6875rem] text-muted-foreground/60">
                {o.call.notice
                  ? o.call.notice
                  : inCall
                    ? "Live voice. Everything on screen still works."
                    : o.canGraduate && !o.busy
                      ? "Say the word and I'll get out of your way."
                      : "A simulated onboarding. Nothing leaves this browser."}
              </p>
            </div>
          </div>
        </main>
      )}

      <GmailDialog
        open={o.gmailOpen}
        suggestedName={o.profile.slots.userName.value}
        onConnect={o.connectGmail}
        onClose={o.dismissGmail}
      />
    </div>
  );
}
