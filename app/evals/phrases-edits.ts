// Phrases a person would actually say or type, run through the local parsers. Run: npm run test:phrases (add -- -v to see each result).
import { parseSopEdit, diffProtocols } from "../src/lib/sopEdit.ts";
import { protocolFromText } from "../src/lib/sopLibrary.ts";
import { notebook } from "../src/data/notebook.ts";
const p = notebook.bench![0];
const c = protocolFromText("Buffer prep", "1. Weigh 8.5 g of sodium chloride\n2. Add 900 mL of deionized water\n3. Stir at 300 rpm for 10 min\n4. Label and store", "shreya" as any);
const EXPECT_MISS = new Set(["what is the batch size", "make it better", "set mix to 3"]); // questions, vague asks, and a toss-up between two settings
let bad = 0, total = 0;
const run = (proto: any, asks: string[]) => { for (const a of asks) { total++; let n: any = null; try { n = parseSopEdit(a, proto); } catch (e) { bad++; console.log("THROW", a, (e as Error).message); continue; } if (!!n === EXPECT_MISS.has(a)) { bad++; console.log("FAIL", a); } else if (process.argv.includes("-v")) console.log(a, "=>", n ? diffProtocols(proto, n).join(" | ") || "no change" : "(not understood, as expected)"); } };
run(p, ["set batch to 100","make it a 100 g batch","change batch size to 100g","double the batch","halve the batch","increase diluent to 40%","increase diluent by 2","lower the batch by 10%","diluent 40","set the mix time to 3 minutes","mix at 2500 rpm","change mix speed to 2500","set photoinitiator to 2","Please set the batch to 75 g.",
"set timer on degas to 15 min","add a 5 minute timer to step 4","step 5 timer 15","degas timer to 90 seconds","remove the timer from step 4",
"Add step: preheat oven before step 1","add a step to rinse the parts after printing","add step Rinse at the end","add step Soak for 10 min after degas","add a step called Clean up","insert a step to label the cup first",
"delete the last step","remove step 6","remove the degas step","rename step 4 to Mix 3 min","rename diluent to Thinner","move step 3 before step 2","move degas to the end","swap steps 2 and 3","move step 1 after step 2",
"add a setting called temperature = 25 °C","add setting Temperature 25 C","add amount 5 g of pigment to step 2","add 5 g of pigment to step 2","add amount Pigment = batch_g * 0.01 g to step 2",
"add a note to step 1: wear gloves","in step 1, add wear gloves","add wear gloves to step 1","add instruction Wear gloves to step 1","add a reminder to the mix step: scrape the walls",
"add photo to step 5","remove the photo","change the instrument of step 2 to mixer","step 4 should use the mixer","do step 2 on the mixer",
"change diluent formula to batch_g * 0.4","what is the batch size","make it better","set mix to 3"]);
console.log("--- custom SOP");
run(c, ["set sodium chloride to 9","double the sodium chloride","water 950 mL","stir at 350 rpm","add a 5 min timer to step 2","add a step to filter after stirring","delete the last step","add a setting called batch = 1 L","rename step 4 to Label, date and store"]);
console.log(total - bad, "/", total, "edit requests pass");
if (bad) process.exit(1);
