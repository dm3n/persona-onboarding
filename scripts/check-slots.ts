import { normalizeEmail, normalizeName, normalizeNeed } from "@/lib/onboarding/slots";

const names: [string, string | null][] = [
  ["Ada", "Ada"],
  ["call it Goose", "Goose"],
  ["my name is daniel", "Daniel"],
  ["I'm Daniel Edgar", "Daniel Edgar"],
  ["call me", null],
  ["I'd rather not say", null],
  ["asdkjhasd ;;;; 8888", null],
  ["I don't want to tell you", null],
  ["let's go with Scout", "Scout"],
  ["mary-jane", "Mary-Jane"],
  ["AJ", "AJ"],
  ["a very long sentence that is clearly not a name at all", null],
  ["nothing", null],
];
const emails: [string, string | null][] = [
  ["daniel at gmail dot com", "daniel@gmail.com"],
  ["Daniel.Edgar@Gmail.COM", "daniel.edgar@gmail.com"],
  ["d a n underscore e at nodebase dot ca", "dan_e@nodebase.ca"],
  ["not an email", null],
  ["me@@x.com", null],
  ["<daniel@nodebase.ca>", "daniel@nodebase.ca"],
];
const needs: [string, string | null][] = [
  ["I need help staying on top of investor follow ups", "staying on top of investor follow ups"],
  ["help me with my inbox", "my inbox"],
  ["my inbox is a disaster", "my inbox is a disaster"],
  ["idk", null],
  ["ok", null],
];

let bad = 0;
const run = <T,>(label: string, fn: (s: string) => T, cases: [string, T][]) => {
  for (const [input, want] of cases) {
    const got = fn(input);
    if (got !== want) {
      bad++;
      console.log(`  ${label}: ${JSON.stringify(input)} -> ${JSON.stringify(got)} (wanted ${JSON.stringify(want)})`);
    }
  }
};
run("name", normalizeName, names);
run("email", normalizeEmail, emails);
run("need", normalizeNeed, needs);
console.log(bad ? `${bad} mismatches` : "all normalisers agree");
