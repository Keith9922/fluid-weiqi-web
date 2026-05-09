// Match — turn-based driver, ported from Assets/Scripts/Match/Match.cs.
// MVP: 2 players, place / pass actions, two consecutive passes => end.

import { BoardState, DEFAULT_BOARD_CONFIG, type BoardConfig } from "./board.ts";
import { findCapturedStones, isSuicide } from "./capture.ts";
import type {
	MatchActionRequest,
	MatchActionResult,
	MatchFlowSnapshot,
	MatchSnapshot,
	StonePlacement,
	Vec2,
} from "./types.ts";

export type MatchConfig = {
	board: BoardConfig;
	stoneStrength: number;       // strength assigned to each newly placed stone
};

export const DEFAULT_MATCH_CONFIG: MatchConfig = {
	board: DEFAULT_BOARD_CONFIG,
	stoneStrength: 1,
};

export class Match {
	readonly board: BoardState;
	readonly config: MatchConfig;
	currentPlayerIndex = 0;
	turnSeq = 0;
	private actionSeq = 0;
	isEnded = false;
	winnerIndex: number | null = null;
	readonly passStates: boolean[];

	constructor(config: MatchConfig = DEFAULT_MATCH_CONFIG) {
		this.config = config;
		this.board = new BoardState(config.board);
		this.passStates = Array.from({ length: config.board.playerCount }, () => false);
	}

	apply(request: MatchActionRequest): MatchActionResult {
		const reject = (reason: string): MatchActionResult => ({
			accepted: false,
			reason,
			playerIndex: request.playerIndex,
			actionSeq: request.actionSeq,
			snapshot: this.snapshot(),
		});

		if (this.isEnded) return reject("match already ended");
		if (request.playerIndex !== this.currentPlayerIndex)
			return reject(`not player ${request.playerIndex}'s turn`);

		switch (request.actionType) {
			case "pass":
				return this.applyPass(request);
			case "place":
				if (!request.position) return reject("place action missing position");
				return this.applyPlace(request, request.position);
			default:
				return reject(`unknown action type: ${(request as { actionType: string }).actionType}`);
		}
	}

	private applyPass(request: MatchActionRequest): MatchActionResult {
		this.passStates[request.playerIndex] = true;

		const allPassed = this.passStates.every(Boolean);
		if (allPassed) {
			this.endMatch();
		} else {
			this.advanceTurn(/* clearPassOfNext */ false);
		}

		return {
			accepted: true,
			playerIndex: request.playerIndex,
			actionSeq: request.actionSeq,
			snapshot: this.snapshot(),
		};
	}

	private applyPlace(request: MatchActionRequest, position: Vec2): MatchActionResult {
		const reject = (reason: string): MatchActionResult => ({
			accepted: false,
			reason,
			playerIndex: request.playerIndex,
			actionSeq: request.actionSeq,
			snapshot: this.snapshot(),
		});

		if (!this.board.withinBounds(position)) return reject("out of bounds");

		// Reject "stacking" — disallow placing right on top of an existing stone
		// (matches the "occupied-point blocking" rule in the original test build).
		const minDist = 0.05; // sub-grid cell, matches preview snap visual spacing
		for (const s of this.board.allStones()) {
			const dx = s.position.x - position.x;
			const dy = s.position.y - position.y;
			if (dx * dx + dy * dy < minDist * minDist)
				return reject("position is occupied");
		}

		// Tentatively add the stone. If the placement turns out to be suicide
		// (and captures nothing), roll back.
		const stone = this.board.addStone(
			request.playerIndex,
			position,
			this.config.stoneStrength,
		);

		const captured = findCapturedStones(this.board, request.playerIndex);
		for (const s of captured) this.board.removeStone(s);

		if (isSuicide(this.board, stone)) {
			// Roll back capture + placement.
			this.board.removeStone(stone);
			for (const s of captured) {
				this.board.addStone(s.playerIndex, s.position, s.strength);
			}
			return reject("suicide is not allowed");
		}

		// Move accepted. Reset all pass flags; advance.
		this.passStates.fill(false);
		this.advanceTurn();

		this.actionSeq++;

		return {
			accepted: true,
			playerIndex: request.playerIndex,
			actionSeq: request.actionSeq,
			snapshot: this.snapshot(),
		};
	}

	private advanceTurn(clearPassOfNext = true): void {
		this.turnSeq++;
		this.currentPlayerIndex =
			(this.currentPlayerIndex + 1) % this.board.playerCount;
		if (clearPassOfNext) this.passStates[this.currentPlayerIndex] = false;
	}

	private endMatch(): void {
		this.isEnded = true;
		// Simple scoring: territory (number of stones surviving). The original
		// uses controlled-pixel area; we'll tally stones for MVP and iterate
		// later if the user wants richer scoring.
		let bestScore = -1;
		let winner: number | null = null;
		for (let p = 0; p < this.board.playerCount; ++p) {
			const score = this.board.getStones(p).length;
			if (score > bestScore) {
				bestScore = score;
				winner = p;
			} else if (score === bestScore) {
				winner = null; // tie
			}
		}
		this.winnerIndex = winner;
	}

	flowSnapshot(): MatchFlowSnapshot {
		return {
			currentPlayerIndex: this.currentPlayerIndex,
			turnSeq: this.turnSeq,
			isEnded: this.isEnded,
			passStates: [...this.passStates],
			winnerIndex: this.winnerIndex,
		};
	}

	snapshot(): MatchSnapshot {
		return { board: this.board.toSnapshot(), flow: this.flowSnapshot() };
	}

	nextActionSeq(): number {
		return ++this.actionSeq;
	}

	captureSummary(player: number): readonly StonePlacement[] {
		return this.board.getStones(player);
	}
}
