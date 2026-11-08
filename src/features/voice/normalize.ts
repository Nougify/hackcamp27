// SPEC F13: ElevenLabs Flash v2.5 doesn't normalize numbers, so recipe text is spelled out first.
const UNICODE_FRACTIONS: Record<string, string> = { "½": "1/2", "¼": "1/4", "¾": "3/4", "⅓": "1/3", "⅔": "2/3", "⅛": "1/8" };
const FRACTIONS: Record<string, string> = {
  "1/2": "one half", "1/4": "one quarter", "3/4": "three quarters", "1/3": "one third",
  "2/3": "two thirds", "1/8": "one eighth", "3/8": "three eighths",
};
// [singular, plural]
const UNITS: Record<string, [string, string]> = {
  tbsp: ["tablespoon", "tablespoons"], tbs: ["tablespoon", "tablespoons"], tsp: ["teaspoon", "teaspoons"],
  g: ["gram", "grams"], kg: ["kilogram", "kilograms"], mg: ["milligram", "milligrams"],
  ml: ["millilitre", "millilitres"], oz: ["ounce", "ounces"], lb: ["pound", "pounds"], lbs: ["pound", "pounds"],
  cm: ["centimetre", "centimetres"], mm: ["millimetre", "millimetres"],
};

const NUM = String.raw`\d+(?:[.,]\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+`;

export function normalizeForSpeech(text: string): string {
  let s = text.replace(/[½¼¾⅓⅔⅛]/g, (f, i) => (i > 0 && /\d/.test(text[i - 1]) ? " " : "") + UNICODE_FRACTIONS[f]);

  // 10–15 / 10-15 → 10 to 15 (numbers only, so "stir-fry" is untouched)
  s = s.replace(/(\d)\s*[–—-]\s*(\d)/g, "$1 to $2");

  // 350°F → 350 degrees Fahrenheit
  s = s.replace(/(\d)\s*°\s*([FC])\b/g, (_, d, u) => `${d} degrees ${u === "F" ? "Fahrenheit" : "Celsius"}`);
  s = s.replace(/°/g, " degrees");

  // 2 tbsp / 1 tsp / 200g → spelled-out unit, singular for exactly one (or a lone fraction)
  s = s.replace(new RegExp(String.raw`(${NUM})\s*(${Object.keys(UNITS).join("|")})\.?(?![\w])`, "gi"), (_, n: string, u: string) => {
    const [one, many] = UNITS[u.toLowerCase()];
    const singular = n === "1" || /^\d+\/\d+$/.test(n);
    return `${n} ${singular ? one : many}`;
  });

  // 1 1/2 → 1 and one half; 1/2 → one half
  s = s.replace(/(\d+)\s+(\d+\/\d+)/g, (m, whole, f) => (FRACTIONS[f] ? `${whole} and ${FRACTIONS[f]}` : m));
  s = s.replace(/\b(\d+\/\d+)\b/g, (m, f) => FRACTIONS[f] ?? m.replace("/", " over "));

  return s.replace(/\s{2,}/g, " ").trim();
}
