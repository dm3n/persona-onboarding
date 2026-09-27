/**
 * House style, enforced rather than requested.
 *
 * Models drift back to em dashes, bullet lists and stage directions no matter
 * how the prompt is worded, so the stream is cleaned on the way out. Applied
 * per chunk, which is safe because every replacement is local to a few
 * characters and the sentinel handles a dash that lands on a chunk boundary.
 */
export function createScrubber(channel: "chat" | "voice") {
  let atStart = true;
  let endedOnSpace = true;

  return function scrub(chunk: string): string {
    let out = chunk;

    // Em and en dashes become ordinary punctuation.
    out = out.replace(/\s*[—–]\s*/g, ", ");

    // Stage directions and speaker labels some models prepend.
    if (atStart) {
      out = out.replace(/^\s*\*[^*]{0,40}\*\s*/, "");
      out = out.replace(/^\s*\[[^\]]{0,40}\]\s*/, "");
      out = out.replace(/^\s*[A-Z][a-zA-Z ]{0,20}:\s(?=[A-Z])/, "");
      if (out.trim()) atStart = false;
    }

    // Markdown emphasis never renders here, so it only shows up as litter.
    out = out.replace(/\*\*/g, "").replace(/(^|\s)_(?=\S)/g, "$1");

    if (channel === "voice") {
      // Nothing on a call should be read aloud as punctuation furniture.
      out = out.replace(/^\s*[-*•]\s+/gm, "");
      out = out.replace(/^#{1,6}\s+/gm, "");
      out = out.replace(/\n{2,}/g, " ");
      out = out.replace(/\n/g, " ");
    }

    // A tool call between two text blocks leaves a doubled space at the seam.
    if (endedOnSpace) out = out.replace(/^[ \t]+/, "");
    out = out.replace(/[ \t]{2,}/g, " ");
    if (out) endedOnSpace = /[\s]$/.test(out);

    return out;
  };
}

/** Collapses the double spaces a scrubbed stream can leave behind. */
export function tidy(text: string): string {
  return text
    .replace(/ {2,}/g, " ")
    .replace(/ ,/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/\s+([.!?])/g, "$1")
    .trim();
}
