// Match — turn-based driver, ported from Assets/Scripts/Match/Match.cs.
// MVP: 2 players, place / pass actions, two consecutive passes => end.

import { BoardState, DEFAULT_BOARD_CONFIG, type BoardConfig } from "./board.ts";
import { buildAnalysis, findCapturedStones, isSuicide } from "./capture.ts";
import type { GameConfig } from "./protocol.ts";
import type {
	EndReason,
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

// Convert from the network-protocol GameConfig into an internal MatchConfig.
export function matchConfigFromGameConfig(gc: GameConfig): MatchConfig {
	const boardSize = clampInt(gc.boardSize, 5, 25);
	const hardness = clampNum(gc.stoneHardness, 0, 0.99);
	const strength = clampNum(gc.stoneStrength, 0.1, 5);
	return {
		board: {
			playerCount: 2,
			size: boardSize,
			stoneHardness: hardness,
			defaultStrength: strength,
		},
		stoneStrength: strength,
	};
}

function clampNum(v: number, lo: number, hi: number): number {
	if (Number.isNaN(v)) return (lo + hi) / 2;
	return Math.min(hi, Math.max(lo, v));
}
function clampInt(v: number, lo: number, hi: number): number {
	return Math.round(clampNum(v, lo, hi));
}

export class Match {
	readonly board: BoardState;
	readonly config: MatchConfig;
	currentPlayerIndex = 0;
	turnSeq = 0;
	private actionSeq = 0;
	isEnded = false;
	winnerIndex: number | null = null;
	endReason: EndReason | undefined;
	finalScore: { player: number; cells: number; percent: number }[] | undefined;
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
			case "resign":
				return this.applyResign(request);
			default:
				return reject(`unknown action type: ${(request as { actionType: string }).actionType}`);
		}
	}

	private applyResign(request: MatchActionRequest): MatchActionResult {
		// 投子认输 — opponent wins immediately. Traditional Go convention:
		// the resigning player loses regardless of board position.
		const opponent = (request.playerIndex + 1) % this.board.playerCount;
		this.endMatch("resign", opponent);
		return {
			accepted: true,
			playerIndex: request.playerIndex,
			actionSeq: request.actionSeq,
			snapshot: this.snapshot(),
		};
	}

	private applyPass(request: MatchActionRequest): MatchActionResult {
		this.passStates[request.playerIndex] = true;

		const allPassed = this.passStates.every(Boolean);
		if (allPassed) {
			this.endMatch("two-passes");
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

	private endMatch(reason: EndReason, forcedWinner?: number): void {
		this.isEnded = true;
		this.endReason = reason;

		// Score by TERRITORY: count cells where each player controls the
		// influence field (total >= 1 with that player dominant). This matches
		// the live territory bar and the upstream BoardDistribution.compute
		// CSAccumulateAreaPixelCounts kernel.
		const grid = buildAnalysis(this.board, 64);
		const cellsByPlayer = new Array(this.board.playerCount).fill(0);
		const total = grid.territory.length;
		for (let i = 0; i < total; ++i) {
			const owner = grid.territory[i] ?? -1;
			if (owner >= 0 && owner < this.board.playerCount) {
				cellsByPlayer[owner]++;
			}
		}
		this.finalScore = cellsByPlayer.map((cells, player) => ({
			player,
			cells,
			percent: (cells / total) * 100,
		}));

		if (forcedWinner !== undefined) {
			// Resign overrides territory scoring.
			this.winnerIndex = forcedWinner;
			return;
		}

		// Territory tally: highest cell count wins; ties produce no winner.
		let bestCells = -1;
		let winner: number | null = null;
		for (let p = 0; p < this.board.playerCount; ++p) {
			const cells = cellsByPlayer[p];
			if (cells > bestCells) {
				bestCells = cells;
				winner = p;
			} else if (cells === bestCells) {
				winner = null;
			}
		}
		this.winnerIndex = winner;
	}

	flowSnapshot(): MatchFlowSnapshot {
		const snap: MatchFlowSnapshot = {
			currentPlayerIndex: this.currentPlayerIndex,
			turnSeq: this.turnSeq,
			isEnded: this.isEnded,
			passStates: [...this.passStates],
			winnerIndex: this.winnerIndex,
		};
		if (this.endReason) snap.endReason = this.endReason;
		if (this.finalScore) snap.finalScore = this.finalScore;
		return snap;
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
