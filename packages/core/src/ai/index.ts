// AI public interface — factory + types.

import { EasyAi } from "./easy.ts";
import { MediumAi } from "./medium.ts";
import { HardAi } from "./hard.ts";
import { HellAi } from "./hell.ts";
import type { AiLevel, AiStrategy } from "./types.ts";

export * from "./types.ts";
export { evaluateBoard, evaluateFast } from "./eval.ts";
export { gridCandidates, rankedCandidates, isFullyLegal } from "./moveGen.ts";

export function createAi(level: AiLevel): AiStrategy {
	switch (level) {
		case "easy":   return new EasyAi();
		case "medium": return new MediumAi();
		case "hard":   return new HardAi();
		case "hell":   return new HellAi();
	}
}
