import { describe, expect, it } from "vitest";
import { normalizeForSpeech as n } from "./normalize";

describe("normalizeForSpeech", () => {
  it.each([
    ["Add 1/2 cup milk", "Add one half cup milk"],
    ["Add 1 1/2 cups flour", "Add 1 and one half cups flour"],
    ["Add ½ tsp salt", "Add one half teaspoon salt"],
    ["Add 1½ cups stock", "Add 1 and one half cups stock"],
    ["Bake at 350°F", "Bake at 350 degrees Fahrenheit"],
    ["Preheat to 200 °C (400°F).", "Preheat to 200 degrees Celsius (400 degrees Fahrenheit)."],
    ["Add 2 tbsp oil", "Add 2 tablespoons oil"],
    ["Add 1 tbsp. butter", "Add 1 tablespoon butter"],
    ["Add 1 tsp cumin", "Add 1 teaspoon cumin"],
    ["Add 200g spinach", "Add 200 grams spinach"],
    ["Pour in 120 ml buttermilk", "Pour in 120 millilitres buttermilk"],
    ["Simmer for 10–15 minutes", "Simmer for 10 to 15 minutes"],
    ["Cook 4-5 minutes", "Cook 4 to 5 minutes"],
    ["Make the stir-fry sauce", "Make the stir-fry sauce"],
    ["Add the eggs and grate the garlic", "Add the eggs and grate the garlic"],
  ])("%s", (input, out) => expect(n(input)).toBe(out));
});
