import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Appearance } from "../shared/types.js";

const optionSchema = z.object({
  id: z.string().min(1), label: z.string().min(1), description: z.string().min(1),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
});
const catalogSchema = z.array(z.object({
  id: z.string(), label: z.string(), question: z.string(), default: z.string(),
  options: z.array(optionSchema).min(2),
}));
export const catalog = catalogSchema.parse(JSON.parse(
  readFileSync(new URL("./data/options.json", import.meta.url), "utf8"),
));
for (const category of catalog) {
  if (!category.options.some(option => option.id === category.default) ||
      new Set(category.options.map(option => option.id)).size !== category.options.length) {
    throw new Error(`Invalid options for ${category.id}`);
  }
}
export const defaults: Appearance = Object.fromEntries(catalog.map(c => [c.id, c.default]));

export function validateAppearance(value: unknown): Appearance {
  const parsed = z.record(z.string(), z.string()).parse(value);
  if (Object.keys(parsed).length !== catalog.length ||
      catalog.some(c => !c.options.some(o => o.id === parsed[c.id]))) {
    throw new Error("Choose one valid option for every appearance category.");
  }
  return parsed;
}

export function colorFor(appearance: Appearance, category: string): string {
  const option = catalog.find(c => c.id === category)?.options.find(o => o.id === appearance[category]);
  if (!option?.color) throw new Error(`No color for ${category}`);
  return option.color;
}
