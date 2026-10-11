import type { DecisionOption } from "../../engine/index.ts";
import { scorer } from "../builtin/score.ts";
import type { DecisionRequest } from "../maker.ts";

/** Keep engine ids and offered order; ties in score prefer the earlier option. */
export function narrow(request: DecisionRequest): readonly DecisionOption[] | "too many" {
  const { kind, options } = request.decision;
  if (kind !== "build" || options.length <= 60) {
    return options.length > 255 ? "too many" : options;
  }
  const evaluate = scorer(request);
  const ranked = options
    .filter((option) => option.id !== "skip")
    .map((option, index) => ({ option, index, value: evaluate(option) }))
    .sort((a, b) => b.value - a.value || a.index - b.index);
  const keep = new Set(options.filter((option) => option.id === "skip").map((o) => o.id));
  const modules = new Set<string>();
  for (const { option } of ranked) {
    // Engine Build options identify a physical Module, including duplicate cards.
    const module = typeof option.card === "string" ? option.card : option.id;
    if (!modules.has(module)) {
      modules.add(module);
      keep.add(option.id);
    }
  }
  // 60 is a target: never lose a Module if an unusually large hand exceeds it.
  if (keep.size > 255) return "too many";
  for (const { option } of ranked) {
    if (keep.size >= 60) break;
    keep.add(option.id);
  }
  return options.filter((option) => keep.has(option.id));
}
