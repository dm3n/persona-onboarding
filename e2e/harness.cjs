/**
 * End to end harness for the onboarding.
 *
 * Drives a real browser against a running app. Web Speech is stubbed so the
 * voice path can be exercised headlessly, and a second stub removes speech
 * entirely to cover browsers that have none.
 *
 * Usage: pnpm dev, then `pnpm test:e2e` (or `node e2e/stress.cjs <scenario>`).
 * Point it elsewhere with BASE=https://... .
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });

const { silenceFile, spokenTrack } = require('./audio.cjs');

/**
 * A silent microphone.
 *
 * Chrome falls through to the real input device unless it is handed a file,
 * and a test run has no business recording anybody's room.
 */
const MEDIA_ARGS = [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-capture',
  `--use-file-for-fake-audio-capture=${silenceFile(30)}`,
  '--autoplay-policy=no-user-gesture-required',
];

/**
 * Replaces the microphone with a recording.
 *
 * Chrome's fake capture device does not survive the audio processing a real
 * call asks for, so the stream is built in WebAudio instead: decode the file,
 * pipe it into a MediaStreamDestination, and hand that back from getUserMedia.
 * Everything downstream of that is the real path.
 */
const INJECT_AUDIO = `
navigator.mediaDevices.getUserMedia = async () => {
  const ctx = new AudioContext({ sampleRate: 48000 });
  await ctx.resume();
  const res = await fetch('/__spoken.wav');
  const buf = await ctx.decodeAudioData(await res.arrayBuffer());
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const dest = ctx.createMediaStreamDestination();
  const gain = ctx.createGain();
  gain.gain.value = 1.6;
  src.connect(gain).connect(dest);
  src.start();
  return dest.stream;
};
`;

async function open({
  colorScheme = 'light',
  width = 1280,
  height = 860,
  /** 'granted' wires a silent mic; 'denied' makes getUserMedia throw. */
  mic = 'granted',
  /** Make the token endpoint fail, to exercise the fallback. */
  breakVoice = false,
  /** Lines to say out loud, in order, as the microphone. */
  speaks = null,
} = {}) {
  const browser = await chromium.launch({ args: MEDIA_ARGS });
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    colorScheme,
    permissions: mic === 'granted' ? ['microphone'] : [],
  });
  if (mic === 'denied') {
    await ctx.addInitScript(`
      navigator.mediaDevices.getUserMedia = async () => {
        throw new DOMException('Permission denied', 'NotAllowedError');
      };
    `);
  }
  if (speaks) await ctx.addInitScript(INJECT_AUDIO);
  const page = await ctx.newPage();
  if (speaks) {
    const track = await spokenTrack(speaks);
    await page.route('**/__spoken.wav', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'audio/wav',
        body: require('fs').readFileSync(track),
      }),
    );
  }
  if (breakVoice) {
    await page.route('**/api/realtime/token', (route) =>
      route.fulfill({ status: 503, body: '{"error":"voice_unavailable"}' }),
    );
  }
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-hydrated="true"]', { timeout: 15000 });
  await page.waitForSelector('textarea', { timeout: 15000 });
  // Wait for the opening line to paint so screenshots are never of a blank column.
  await page
    .waitForFunction(() => document.body.innerText.includes("what do you want to call me"), { timeout: 8000 })
    .catch(() => {});
  await page.waitForTimeout(500);
  return { browser, ctx, page, errors };
}

async function type(page, text) {
  const ta = page.locator('textarea').first();
  await ta.click();
  await ta.fill(text);
  await ta.press('Enter');
}

/** Waits until the agent has stopped streaming and any queued action has run. */
async function settle(page, ms = 40000) {
  // Give the turn a moment to start before declaring it finished.
  await page.waitForTimeout(250);
  await page
    .waitForFunction(() => document.querySelector('[data-busy="false"]'), { timeout: ms })
    .catch(() => {});
  // Actions (call, graduate) are scheduled up to 1.2s after the text lands.
  await page.waitForTimeout(1500);
  await page
    .waitForFunction(() => document.querySelector('[data-busy="false"]'), { timeout: ms })
    .catch(() => {});
}

function state(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-phase]');
    return el
      ? {
          phase: el.dataset.phase,
          busy: el.dataset.busy,
          call: el.dataset.call,
          collected: Number(el.dataset.collected),
        }
      : null;
  });
}

async function transcript(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem('persona.onboarding.v3');
    if (!raw) return null;
    const d = JSON.parse(raw);
    return {
      profile: d.profile,
      messages: d.messages.map((m) => `${m.role}${m.viaVoice ? '(voice)' : ''}: ${m.text || '[' + m.kind + ']'}`),
    };
  });
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), caret: 'initial' });
}

module.exports = { open, type, settle, state, transcript, shot, BASE, OUT };
