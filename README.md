# Persona onboarding

A conversational onboarding that collects four things without ever feeling like a form:
what you want to call your agent, what it should call you, the Gmail it works in, and
one real job to start on. It offers to do most of that over a voice call, and it holds
together when people do not cooperate.

Live: https://persona-onboarding.vercel.app

## The idea

Onboarding is the first thing a product says about itself. A form says "fill this in
and we will see". A conversation says "I am already working". So the agent talks, reacts
to what you actually said, and lets you leave early if you already know what you want.

Three decisions shaped everything else.

**The server owns the contract, the model owns the words.** A state machine decides what
is still missing, when the call gets offered, when the Gmail button appears and when you
are allowed to graduate. The model writes the sentences and proposes values. Every value
it proposes is normalised and validated before it reaches the profile, so a confused turn
produces "ask again", never a corrupted setup.

**The call is the product demo.** It is a real voice call in the browser: the agent
speaks, listens, hears you, and reacts. It just does not dial a phone number.

**Nobody answers a question twice.** Anything you have given survives a hangup, a
refusal, a reload, and a browser with no microphone.

## Flow

```
name your agent  ──►  it offers to call you  ──►  call collects the rest
      │                        │                         │
      │                        └── declined ──┐          ├── hung up
      │                                       ▼          ▼
      └──────────────────────────────►  chat collects the rest  ──►  ready
                                                  ▲
                              "just let me in" ───┘ (graduates early)
```

The agent's own name is the one thing the call cannot collect, because the agent
introduces itself by it. Everything else can come from either channel.

## When people do not play along

Each of these is covered by a scenario in `e2e/stress.cjs`.

| What they do                         | What happens                                                                                                            |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Hangs up mid sentence                | Speech stops instantly, the call is logged in the transcript, and the agent picks up in text without re-asking anything |
| Declines the call                    | Accepted once, never offered again                                                                                      |
| Has no microphone, or blocks it      | The call still connects, the agent still speaks, and a text box appears inside the call                                 |
| Uses a browser with no speech at all | Same, plus captions carry the conversation                                                                              |
| Says nothing                         | Checked on once, then the agent ends the call warmly and continues in text                                              |
| "I am not giving you my email"       | That slot is marked declined and never raised again. Only that slot                                                     |
| "Skip all this, just let me in"      | Graduates as soon as there is enough, and says what is still missing                                                    |
| Gives everything in one sentence     | All four are taken at once and onboarding ends                                                                          |
| Types gibberish                      | The agent says it missed that, and nothing junk is saved                                                                |
| Reloads halfway                      | Profile and transcript restore, and a call in progress lands safely back in chat                                        |
| Sends six messages in two seconds    | Earlier turns are aborted, no empty bubbles, no duplicate state                                                         |
| "Ignore previous instructions..."    | Declined in one clause, then the question it was going to ask anyway                                                    |

## How it works

```
src/
  app/api/onboarding/     one turn: prompt, tools, stream, guarantees
  app/api/plan/           the three things the agent will do first
  lib/onboarding/
    types.ts              the contract
    slots.ts              normalisation, validation, graduation rules
    intent.ts             deterministic reads of a message
    prompt.ts             the system prompt, rebuilt every turn from state
    rescue.ts             second pass when a turn captured nothing
    scrub.ts              house style enforced on the way out
    use-onboarding.ts     the client state machine and call loop
  lib/speech/             Web Speech, defensively wrapped
```

Turns stream newline delimited JSON, so on a call each finished sentence is spoken while
the next one is still being written.

**Guarantees.** After the model has had its say, the server checks the things it is not
trusted to remember: that a call actually starts when someone asks for one, that an
impatient user is let out, that the call is offered exactly once, and that the Gmail
button appears when Gmail is the only thing left.

**The rescue pass.** If a turn captured nothing while a slot was still open, a small
model re-reads the exchange with one job. It only ever fills values. Declining is decided
by pattern, so it can never quietly close a slot nobody refused.

**Degrading.** No speech synthesis falls back to captions with a reading delay. No
recognition falls back to typing inside the call. A failed turn falls back to a written
question, and deterministic parsing still records the answer.

## Running it

```bash
pnpm install
cp .env.example .env.local     # add an AI Gateway key
pnpm dev
```

```bash
pnpm test:e2e                  # the full matrix above, against localhost
node e2e/stress.cjs call       # one scenario
BASE=https://... pnpm test:e2e # against a deployment
```

Speech recognition needs Chrome or Edge. Everywhere else the call runs with captions and
typed replies, which is a supported path rather than a failure.

## Notes

Nothing here touches a real mailbox. The Gmail step is a simulated handshake, labelled as
one, and the address stays in the browser. The profile lives in `localStorage` only.
