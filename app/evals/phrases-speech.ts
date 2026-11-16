// Phrases a person would actually say or type, run through the local parsers. Run: npm run test:phrases (add -- -v to see each result).
import { parseUtterance, wordsToDigits } from "../src/lib/benchSpeech.ts";
const f = (id: string, label: string, unit: string) => ({ id, label, unit, formula: "1" });
const one = [f("base", "Base monomer", "g")], mix = [f("rpm", "Speed", "rpm"), f("mix_min", "Time", "min")];
const custom = [f("nacl", "Sodium chloride", "g"), f("water", "Deionized water", "mL"), f("temp", "Temperature", "°C"), f("pct", "Percent", "%")];
const T: [any[], string, Record<string, number>][] = [
 [one,"30.8 grams",{base:30.8}],[one,"thirty point eight grams",{base:30.8}],[one,"thirty one",{base:31}],[one,"it's about 31",{base:31}],
 [one,"30 no 31.2",{base:31.2}],[one,"thirty, sorry, thirty one point two grams",{base:31.2}],[one,"point five",{base:0.5}],
 [one,"two and a half grams",{base:2.5}],[one,"a hundred and five",{base:105}],[one,"one fifty",{base:150}],[one,"30,8",{base:30.8}],
 [one,"for step 1 I weighed 30.15 g",{base:30.15}],[one,"I added it to the cup",{}],[one,"base monomer 30.2",{base:30.2}],[one,"half a gram",{base:0.5}],
 [one,"1,250 grams",{base:1250}],[one,"0.03 kilos",{base:30}],[one,"two minutes",{}],[one,"Thirty-one point five.",{base:31.5}],
 [mix,"mixed at 3000 for 2 minutes",{rpm:3000,mix_min:2}],[mix,"two minutes at three thousand rpm",{rpm:3000,mix_min:2}],[mix,"time 2 speed 3000",{rpm:3000,mix_min:2}],
 [mix,"speed was 2800",{rpm:2800}],[mix,"3k rpm for 2 and a half minutes",{rpm:3000,mix_min:2.5}],[mix,"90 seconds at 3000",{rpm:3000,mix_min:1.5}],[mix,"3000, 2",{rpm:3000,mix_min:2}],
 [custom,"8.6 grams of salt, 900 mils of water",{nacl:8.6,water:900}],[custom,"water 905 milliliters",{water:905}],[custom,"temperature is 24 degrees",{temp:24}],
 [custom,"temperature 24.5",{temp:24.5}],[custom,"five percent",{pct:5}],[custom,"one liter of water",{water:1000}],
 [custom,"deionized water nine hundred, sodium chloride eight point five",{water:900,nacl:8.5}],[custom,"8.5, 900, 25, 5",{nacl:8.5,water:900,temp:25,pct:5}],
 [custom,"900 of water and 8.5 of sodium chloride",{water:900,nacl:8.5}],
];
let bad = 0;
for (const [fs, t, want] of T) { const got = parseUtterance(t, fs).values; const ok = JSON.stringify(Object.entries(got).sort()) === JSON.stringify(Object.entries(want).sort()); if (!ok) { bad++; console.log("FAIL", t, "=>", JSON.stringify(got), "want", JSON.stringify(want), "{" + wordsToDigits(t) + "}"); } }
console.log(T.length - bad, "/", T.length, "spoken phrases pass");
if (bad) process.exit(1);
