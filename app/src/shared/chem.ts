// The arithmetic of an acid meeting a carbonate, for the SOPs that are that reaction. Numbers only: nothing here
// is a model's guess. NaHCO3 + CH3COOH -> CO2 + H2O + CH3COONa, one mole of gas for one of each reagent.
export const M_SODA = 84.01, M_ACETIC = 60.05, L_PER_MOL = 24; // g/mol, g/mol, litres of gas per mole near room temperature

export interface Prediction { acid_mol: number; base_mol: number; limiting: "acid" | "base" | "neither"; co2_l: number; left_g: number; left_of: "baking soda" | "acetic acid" | "nothing" }

/** What `vinegar_g` of vinegar (a fraction `acid_frac` acetic acid) and `soda_g` of baking soda can make. */
export function predict(soda_g: number, vinegar_g: number, acid_frac = 0.05): Prediction {
  const acid_mol = (vinegar_g * acid_frac) / M_ACETIC, base_mol = soda_g / M_SODA;
  const used = Math.min(acid_mol, base_mol);
  const limiting = Math.abs(acid_mol - base_mol) <= 0.02 * Math.max(acid_mol, base_mol) ? "neither" : acid_mol < base_mol ? "acid" : "base";
  return {
    acid_mol, base_mol, limiting, co2_l: used * L_PER_MOL,
    left_g: limiting === "acid" ? (base_mol - used) * M_SODA : limiting === "base" ? (acid_mol - used) * M_ACETIC : 0,
    left_of: limiting === "acid" ? "baking soda" : limiting === "base" ? "acetic acid" : "nothing",
  };
}

// What was asked for, out loud, about the chemistry. The trial view answers; a recording's overlay draws it.
export const ASKS_MOLECULES = /\b(molecules?|electro\s?negativit\w*|structures?)\b/i;
export const ASKS_HYPOTHESIS = /\b(hypothes\w*|my guess|i (?:think|expect|bet|predict) (?:that )?(?:the |this |that )?(?:hydrogen|proton|atom|oxygen|acid)|proton (?:hops?|transfer|jumps?|moves?))\b/i;
export const ASKS_PREDICTION = /\b(how much (?:gas|co2|c o 2|carbon dioxide|foam)|what (?:should|do) (?:i|we) expect|predict\w*|expected (?:gas|volume|co2))\b/i;
