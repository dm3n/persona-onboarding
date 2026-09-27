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

/** Fake Web Speech so the real voice path runs in a headless browser. */
const SPEECH_STUB = `
(() => {
  const listeners = {};
  window.__speech = { spoken: [], utterances: [], rec: null };

  class FakeRecognition {
    constructor() { this.lang=''; this.continuous=false; this.interimResults=false; this.maxAlternatives=1;
      this.onresult=null; this.onerror=null; this.onend=null; this.onstart=null; this.running=false;
      window.__speech.rec = this; }
    start() { if (this.running) throw new Error('already started'); this.running = true; setTimeout(()=>this.onstart && this.onstart(), 0); }
    stop() { if(!this.running) return; this.running=false; setTimeout(()=>this.onend && this.onend(), 0); }
    abort() { this.running=false; }
  }
  window.SpeechRecognition = FakeRecognition;
  window.webkitSpeechRecognition = FakeRecognition;

  /** Test hook: pretend the user said something. */
  window.__say = (text, final = true) => {
    const rec = window.__speech.rec;
    if (!rec || !rec.running || !rec.onresult) return false;
    const result = [{ transcript: text, confidence: 0.95 }];
    result.isFinal = final;
    rec.onresult({ resultIndex: 0, results: Object.assign([result], { length: 1 }) });
    return true;
  };
  window.__micLive = () => Boolean(window.__speech.rec && window.__speech.rec.running);

  class FakeUtterance {
    constructor(text) { this.text = text; this.onstart=null; this.onend=null; this.onerror=null; }
  }
  window.SpeechSynthesisUtterance = FakeUtterance;
  const synth = {
    speaking: false,
    getVoices: () => [{ name: 'Samantha', lang: 'en-US', localService: true, default: true }],
    speak(u) {
      window.__speech.spoken.push(u.text);
      synth.speaking = true;
      setTimeout(() => { u.onstart && u.onstart(); }, 5);
      // Speak fast so tests do not crawl.
      setTimeout(() => { synth.speaking = false; u.onend && u.onend(); }, 120);
    },
    cancel() { synth.speaking = false; },
    resume() {},
    pause() {},
    addEventListener(){}, removeEventListener(){},
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });

  navigator.mediaDevices = navigator.mediaDevices || {};
  navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop(){} }] });
})();
`;

/** Removes every speech capability, the Firefox case. */
const NO_SPEECH_STUB = `
(() => {
  delete window.SpeechRecognition;
  delete window.webkitSpeechRecognition;
  Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true });
  navigator.mediaDevices = navigator.mediaDevices || {};
  navigator.mediaDevices.getUserMedia = async () => { throw new Error('NotAllowedError'); };
})();
`;

async function open({ speech = 'fake', colorScheme = 'light', width = 1280, height = 860 } = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    colorScheme,
    permissions: [],
  });
  if (speech === 'fake') await ctx.addInitScript(SPEECH_STUB);
  if (speech === 'none') await ctx.addInitScript(NO_SPEECH_STUB);
  const page = await ctx.newPage();
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
