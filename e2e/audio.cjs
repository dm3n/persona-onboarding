/**
 * Test audio, built on demand.
 *
 * Nothing binary lives in the repo: silence is synthesised, and the spoken
 * lines come from the text to speech API and are cached locally. Everything
 * stays at one sample rate so the pieces can be concatenated as raw PCM
 * without pulling in an audio toolchain.
 */
const fs = require('fs');
const path = require('path');

const RATE = 24000;
const CACHE = path.join(__dirname, '.cache');

function header(dataBytes) {
  const b = Buffer.alloc(44);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + dataBytes, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(1, 22); // mono
  b.writeUInt32LE(RATE, 24);
  b.writeUInt32LE(RATE * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(dataBytes, 40);
  return b;
}

function silenceBytes(seconds) {
  return Buffer.alloc(Math.round(RATE * seconds) * 2);
}

function wav(pcm) {
  return Buffer.concat([header(pcm.length), pcm]);
}

/** Strips the header off a PCM wav, whatever extra chunks it carries. */
function pcmOf(buf) {
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'data') return buf.subarray(off + 8, off + 8 + size);
    off += 8 + size + (size % 2);
  }
  throw new Error('no data chunk in wav');
}

function silenceFile(seconds = 30) {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, `silence-${seconds}s.wav`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, wav(silenceBytes(seconds)));
  return file;
}

/** The key, from the environment or the local env file the app already uses. */
function openaiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  try {
    const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
    const line = env.split('\n').find((l) => l.startsWith('OPENAI_API_KEY='));
    if (line) return line.slice('OPENAI_API_KEY='.length).trim();
  } catch {
    /* no local env file */
  }
  return null;
}

async function speak(text) {
  const key = openaiKey();
  if (!key) throw new Error('OPENAI_API_KEY is needed to build the spoken track');
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts',
      voice: 'ash',
      input: text,
      response_format: 'wav',
    }),
  });
  if (!res.ok) throw new Error(`tts ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return pcmOf(Buffer.from(await res.arrayBuffer()));
}

/**
 * One track: a lead-in, then each line with room after it for a reply.
 * Generous gaps, because a rushed turn is a flaky test.
 */
async function spokenTrack(lines, { leadIn = 12, gap = 13, tail = 20 } = {}) {
  fs.mkdirSync(CACHE, { recursive: true });
  const key = require('crypto')
    .createHash('sha1')
    .update(JSON.stringify({ lines, leadIn, gap, tail }))
    .digest('hex')
    .slice(0, 12);
  const file = path.join(CACHE, `spoken-${key}.wav`);
  if (fs.existsSync(file)) return file;

  const parts = [silenceBytes(leadIn)];
  for (let i = 0; i < lines.length; i++) {
    parts.push(await speak(lines[i]));
    parts.push(silenceBytes(i === lines.length - 1 ? tail : gap));
  }
  fs.writeFileSync(file, wav(Buffer.concat(parts)));
  return file;
}

module.exports = { silenceFile, spokenTrack, RATE };
