"use client";

import { useState } from "react";
import { Check, Loader2, Mail, ShieldCheck } from "lucide-react";
import { motion } from "motion/react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { normalizeEmail, isGmailAddress } from "@/lib/onboarding/slots";
import { cn } from "@/lib/utils";

const SCOPES = [
  "Read and search your mail",
  "Draft and send replies you approve",
  "See who you talk to most",
];

/** The inline card the agent drops into the conversation. */
export function GmailCard({
  connected,
  email,
  onOpen,
}: {
  connected: boolean;
  email: string | null;
  onOpen: () => void;
}) {
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="w-full max-w-[24rem]"
    >
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-full border",
              connected
                ? "border-foreground/15 bg-foreground text-background"
                : "border-border bg-muted text-muted-foreground",
            )}
          >
            {connected ? (
              <Check className="size-4" strokeWidth={2.5} />
            ) : (
              <Mail className="size-4" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[0.875rem] font-medium leading-tight">
              {connected ? "Gmail connected" : "Connect Gmail"}
            </p>
            <p
              className={cn(
                "mt-1 text-[0.8125rem] leading-snug text-muted-foreground",
                connected && "truncate",
              )}
            >
              {connected
                ? email
                : "Read only until you approve anything that goes out."}
            </p>
          </div>
        </div>
        {!connected ? (
          <Button
            size="sm"
            className="mt-3.5 h-9 w-full rounded-lg text-[0.8125rem]"
            onClick={onOpen}
          >
            Connect
          </Button>
        ) : null}
      </div>
    </motion.div>
  );
}

type GmailDialogProps = {
  open: boolean;
  suggestedName: string | null;
  onConnect: (email: string) => void;
  onClose: (opts: { connected: boolean }) => void;
};

/**
 * Remounted on every open so the form always starts clean, rather than
 * resetting itself through an effect after the sheet is already visible.
 */
export function GmailDialog(props: GmailDialogProps) {
  return <GmailDialogInner key={props.open ? "open" : "closed"} {...props} />;
}

function GmailDialogInner({
  open,
  suggestedName,
  onConnect,
  onClose,
}: GmailDialogProps) {
  const [value, setValue] = useState("");
  const [state, setState] = useState<"idle" | "working" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const email = normalizeEmail(value);
    if (!email) {
      setError("That does not look like an email address.");
      return;
    }
    setError(null);
    setState("working");
    // The handshake is simulated. Nothing leaves the browser.
    setTimeout(() => {
      setState("done");
      setTimeout(() => onConnect(email), 620);
    }, 900);
  };

  const email = normalizeEmail(value);
  const notGmail = Boolean(email) && !isGmailAddress(email!);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && state !== "working")
          onClose({ connected: state === "done" });
      }}
    >
      <DialogContent
        className="sm:max-w-[26rem]"
        showCloseButton={state !== "working"}
      >
        <DialogHeader>
          <DialogTitle className="text-[1.0625rem]">
            {state === "done" ? "Connected" : "Connect Gmail"}
          </DialogTitle>
          <DialogDescription className="text-[0.8125rem]">
            {state === "done"
              ? "That is everything I need to start reading the room."
              : "Give your Persona access to the inbox it will work in."}
          </DialogDescription>
        </DialogHeader>

        {state === "done" ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center gap-3 py-6"
          >
            <span className="flex size-12 items-center justify-center rounded-full bg-foreground text-background">
              <Check className="size-6" strokeWidth={2.5} />
            </span>
            <p className="text-[0.875rem] font-medium">{email}</p>
          </motion.div>
        ) : (
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <label
                htmlFor="gmail-address"
                className="text-[0.8125rem] font-medium"
              >
                Google account
              </label>
              <Input
                id="gmail-address"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoFocus
                disabled={state === "working"}
                placeholder={
                  suggestedName
                    ? `${suggestedName.split(" ")[0]?.toLowerCase()}@gmail.com`
                    : "you@gmail.com"
                }
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  if (error) setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
                aria-invalid={Boolean(error)}
              />
              {error ? (
                <p className="text-[0.75rem] text-destructive">{error}</p>
              ) : notGmail ? (
                <p className="text-[0.75rem] text-muted-foreground">
                  Not a Gmail address, but it will work the same way here.
                </p>
              ) : null}
            </div>

            <div className="rounded-xl border border-border bg-muted/40 p-3">
              <p className="text-[0.75rem] font-medium text-muted-foreground">
                Persona will be able to
              </p>
              <ul className="mt-2 space-y-1.5">
                {SCOPES.map((s) => (
                  <li
                    key={s}
                    className="flex items-start gap-2 text-[0.8125rem] leading-snug"
                  >
                    <Check className="mt-[3px] size-3 shrink-0 text-muted-foreground" />
                    {s}
                  </li>
                ))}
              </ul>
            </div>

            <p className="flex items-start gap-1.5 text-[0.75rem] leading-snug text-muted-foreground">
              <ShieldCheck className="mt-[1px] size-3.5 shrink-0" />
              Demo environment. No Google account is contacted and the address
              stays in this browser.
            </p>
          </div>
        )}

        {state !== "done" ? (
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="ghost"
              disabled={state === "working"}
              onClick={() => onClose({ connected: false })}
            >
              Not now
            </Button>
            <Button onClick={submit} disabled={state === "working"}>
              {state === "working" ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Connecting
                </>
              ) : (
                "Allow access"
              )}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
