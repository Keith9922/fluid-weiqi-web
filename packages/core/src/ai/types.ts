// AI public types.

import type { BoardState } from "../board.ts";
import type { MatchActionRequest, Vec2 } from "../types.ts";

export type AiLevel = "easy" | "medium" | "hard" | "hell";

export const AI_LABELS: Record<AiLevel, { zh: string; en: string }> = {
	easy:   { zh: "简单",   en: "Easy"   },
	medium: { zh: "中级",   en: "Medium" },
	hard:   { zh: "困难",   en: "Hard"   },
	hell:   { zh: "地狱",   en: "Hell"   },
};

// The AI returns either a place action or a pass.
export type AiDecision =
	| { type: "place"; position: Vec2 }
	| { type: "pass" };

// All AI strategies implement this interface.
export interface AiStrategy {
	readonly level: AiLevel;
	chooseMove(board: BoardState, playerIndex: number, stoneStrength: number): AiDecision;
}

// Convenience: turn an AI decision into a MatchActionRequest.
export function decisionToAction(
	decision: AiDecision,
	playerIndex: number,
	turnSeq: number,
	actionSeq: number,
): MatchActionRequest {
	if (decision.type === "place") {
		return { playerIndex, actionType: "place", position: decision.position, turnSeq, actionSeq };
	}
	return { playerIndex, actionType: "pass", turnSeq, actionSeq };
}
