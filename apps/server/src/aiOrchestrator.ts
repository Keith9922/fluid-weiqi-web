// Server-side AI scheduler.
//
// After every applied move, we check whether the next player slot is an AI.
// If so, we broadcast an "aiThinking" notification, sleep a bit (so the human
// sees the previous move land before the AI replies), compute the AI move on
// the main thread, apply it via Match.apply, and broadcast the result.
//
// Computing on the main thread is OK because each room is independent and
// because we only run one AI computation at a time per room. With a 2-vCPU
// box this is fine for a handful of concurrent matches.

import { decisionToAction, type ServerActionAccepted, type ServerAiThinking } from "@fluid/core";
import type { Room } from "./room.ts";

const MIN_THINK_MS: Record<string, number> = {
	easy: 250,
	medium: 350,
	hard: 500,
	hell: 600,
};

// Schedule the AI to play if the current turn belongs to an AI slot and the
// match is in progress. Idempotent — safe to call after every player action.
export function maybeScheduleAi(room: Room): void {
	if (room.match.isEnded) return;
	const idx = room.match.currentPlayerIndex;
	const slot = room.getSlot(idx);
	if (!slot || slot.kind !== "ai") return;

	// Notify clients that the AI is thinking.
	const thinking: ServerAiThinking = { t: "aiThinking", playerIndex: idx };
	room.broadcast(thinking);

	const minMs = MIN_THINK_MS[slot.level] ?? 300;

	const start = Date.now();
	const board = room.match.board.clone();
	const stoneStrength = room.gameConfig.stoneStrength;

	// Compute the move synchronously (single-threaded JS).
	const decision = slot.ai.chooseMove(board, idx, stoneStrength);
	const elapsed = Date.now() - start;

	// Add a small delay so super-fast moves don't feel like a bug.
	const remaining = Math.max(0, minMs - elapsed);
	setTimeout(() => {
		if (room.match.isEnded) return;
		const action = decisionToAction(decision, idx, room.match.turnSeq, room.match.nextActionSeq());
		const before = room.match.board.allStones().length;
		const result = room.match.apply(action);
		const after = room.match.board.allStones().length;

		if (result.accepted) {
			const captured = Math.max(0, before + (action.actionType === "place" ? 1 : 0) - after);
			const acc: ServerActionAccepted = {
				t: "actionAccepted",
				snapshot: result.snapshot,
				captured,
			};
			room.broadcast(acc);
			// Recurse — if the next slot is also AI (shouldn't happen with two slots
			// but defensive), schedule the next AI move.
			maybeScheduleAi(room);
		} else {
			// AI returned an illegal move (would be a bug). Pass instead.
			const passAction = {
				playerIndex: idx,
				actionType: "pass" as const,
				turnSeq: room.match.turnSeq,
				actionSeq: room.match.nextActionSeq(),
			};
			const passResult = room.match.apply(passAction);
			if (passResult.accepted) {
				const acc: ServerActionAccepted = {
					t: "actionAccepted",
					snapshot: passResult.snapshot,
					captured: 0,
				};
				room.broadcast(acc);
				maybeScheduleAi(room);
			}
		}
	}, remaining);
}
