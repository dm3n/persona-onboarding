# Persona onboarding

A conversational onboarding that collects four things without ever feeling like a form:
what you want to call your agent, what it should call you, the Gmail it works in, and
one real job to start on. It offers to do most of that over a voice call, and it holds
together when people do not cooperate.

Live: https://persona-setup.vercel.app

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

**The call is the product demo.** It is a real voice call in the browser, running
on OpenAI's Realtime API over WebRTC: the agent speaks, listens, hears you and
reacts in the same breath. It just does not dial a phone number.

**Nobody answers a question twice.** Anything you have given survives a hangup, a
refusal, a reload, and a browser with no microphone.

## Voice

Audio goes straight from the microphone to OpenAI and back over WebRTC, so the
only thing this app sits in the middle of is the conversation. The browser never
sees the API key: the server mints a token that is good for one short session,
and that is what signs the handshake.

The call does not take the screen away. It docks into a bar where the composer
was, and everything else stays live: the transcript fills in as you both talk,
the panels stay tappable, and typing still works mid call. Speak, tap or type,
in any order.

The voice agent has the same tools the text agent has, so both channels collect
into the same contract and neither can take a shortcut the other cannot. What it
hears goes through the same validation too, which is why saying "call me" out
loud does not end up as your name. And what ends up on your screen is the state
machine's decision, not something the agent is trusted to have done: a voice
agent will cheerfully tell you it has put a button in front of you and then not
call the tool that does it.

Your own words appear as you say them. Transcription runs alongside the model
rather than ahead of it, so a turn claims its place in the transcript the moment
you start talking and fills in from there, which keeps what you said above the
answer to it.

Turn taking is semantic rather than gap-based, so it waits for a finished
thought instead of cutting in at the first pause, and it stops the moment you
start talking. It will never ask you to say an email address out loud, because
addresses do not survive a microphone; it puts a button on your screen instead.

Calls end themselves after five minutes, or after a stretch of silence in both
directions. Live audio is metered by the minute and onboarding is meant to take
one.

## The panels

Two moments are too good to leave as plain text, so the agent drops a small
interactive panel into the conversation instead. Each one follows the same
grammar: the agent does something first, then hands over, and a bar underneath
tracks what is left.

**Naming.** The agent is in the box, unsettled and unnamed. Tap a name and it
settles into it, with a verdict line to close the moment.

**The job board.** Six kinds of work. The agent takes one itself, then hands
over: tap whichever others actually eat your week, up to three, and a counter
runs down. What you pick becomes the job it starts on.

Tapping is just another way of replying. Whatever you choose is turned back into
an ordinary message, so the agent reacts the same way and the transcript reads
the same whether you tapped or typed. Answer by typing instead and the panel
settles itself rather than sitting there still wanting a tap.

Both are decided by the server before the turn runs, the same way the call offer
is, so the agent's words and the panel on screen can never disagree.

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
  components/onboarding/
    agent-stage.tsx       the interactive panels
  lib/speech/
    use-realtime-call.ts  the WebRTC call: audio, events, tools
  app/api/realtime/       mints the short lived session token
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
cp .env.example .env.local     # an AI Gateway key, and an OpenAI key for voice
pnpm dev
```

Text works without the OpenAI key; voice reports itself unavailable and the
onboarding carries on typing.

```bash
pnpm test:e2e                  # the full matrix above, against localhost
VOICE_LIVE=1 pnpm test:e2e     # also place real calls, which cost real credit
node e2e/stress.cjs voiceRing  # one scenario
BASE=https://... pnpm test:e2e # against a deployment
pnpm check:slots               # the normalisers, against their awkward cases
pnpm typecheck && pnpm lint
```

The voice tests speak to it for real: the lines are generated with text to
speech, stitched together with pauses, and played into the page as the
microphone, then the four fields are checked at the other end. Nothing binary is
committed; the audio is built on demand and cached.

Voice needs WebRTC and a microphone, which is every current browser. Where it is
unavailable or refused, the onboarding says so and finishes in text, which is a
supported path rather than a failure.

## Notes

Nothing here touches a real mailbox. The Gmail step is a simulated handshake, labelled as
one, and the address stays in the browser. The profile lives in `localStorage` only.
