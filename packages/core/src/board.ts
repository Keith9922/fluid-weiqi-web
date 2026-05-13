// BoardState — ported from Assets/Scripts/Board/BoardState.cs.
// MVP simplification: square boards only. Spherical and shrink modes are TODO.

import type { BoardSnapshot, StonePlacement, Vec2 } from "./types.ts";

export type BoardConfig = {
	playerCount: number;
	size: number;             // intersections per side; placeable integer coords are 0..size-1
	stoneHardness: number;    // [0, 0.9999]; sharper falloff as it approaches 1
	defaultStrength: number;  // strength assigned to each new stone
};

export const DEFAULT_BOARD_CONFIG: BoardConfig = {
	playerCount: 2,
	size: 19,
	stoneHardness: 0.25,
	defaultStrength: 1,
};

export class BoardState {
	readonly playerCount: number;
	size: number;
	stoneHardness: number;
	shrinkMargin = 0;

	private readonly stonesByPlayer: StonePlacement[][];
	private nextStoneId = 1;

	constructor(config: BoardConfig) {
		this.playerCount = config.playerCount;
		this.size = config.size;
		this.stoneHardness = config.stoneHardness;
		this.stonesByPlayer = Array.from({ length: config.playerCount }, () => []);
	}

	get stones(): readonly (readonly StonePlacement[])[] {
		return this.stonesByPlayer;
	}

	getStones(player: number): readonly StonePlacement[] {
		return this.stonesByPlayer[player] ?? [];
	}

	allStones(): StonePlacement[] {
		return this.stonesByPlayer.flat();
	}

	addStone(player: number, position: Vec2, strength: number): StonePlacement {
		const stone: StonePlacement = {
			id: this.nextStoneId++,
			playerIndex: player,
			position: { x: position.x, y: position.y },
			strength,
		};
		this.stonesByPlayer[player]!.push(stone);
		return stone;
	}

	removeStone(stone: StonePlacement): void {
		const list = this.stonesByPlayer[stone.playerIndex];
		if (!list) return;
		const idx = list.findIndex(s => s.id === stone.id);
		if (idx >= 0) list.splice(idx, 1);
	}

	// Min and max coordinates of the playable area (after shrinkage).
	// For a standard size-N board, the N intersections per side live at integer
	// coords 0..N-1; playableMax therefore returns size-1 (not size). Continuous
	// off-grid placements are allowed anywhere in [min, max].
	get playableMin(): Vec2 {
		return { x: this.shrinkMargin, y: this.shrinkMargin };
	}

	get playableMax(): Vec2 {
		return {
			x: this.size - 1 - this.shrinkMargin,
			y: this.size - 1 - this.shrinkMargin,
		};
	}

	withinBounds(p: Vec2): boolean {
		const min = this.playableMin;
		const max = this.playableMax;
		return p.x >= min.x && p.x <= max.x && p.y >= min.y && p.y <= max.y;
	}

	clone(): BoardState {
		const copy = new BoardState({
			playerCount: this.playerCount,
			size: this.size,
			stoneHardness: this.stoneHardness,
			defaultStrength: 1,
		});
		copy.shrinkMargin = this.shrinkMargin;
		copy.nextStoneId = this.nextStoneId;
		for (let p = 0; p < this.playerCount; ++p) {
			const list = this.stonesByPlayer[p];
			if (!list) continue;
			copy.stonesByPlayer[p] = list.map(s => ({
				...s,
				position: { x: s.position.x, y: s.position.y },
			}));
		}
		return copy;
	}

	toSnapshot(): BoardSnapshot {
		return {
			playerCount: this.playerCount,
			size: this.size,
			stoneHardness: this.stoneHardness,
			shrinkMargin: this.shrinkMargin,
			stones: this.allStones().map(s => ({
				id: s.id,
				playerIndex: s.playerIndex,
				position: { x: s.position.x, y: s.position.y },
				strength: s.strength,
			})),
		};
	}

	static fromSnapshot(snap: BoardSnapshot): BoardState {
		const board = new BoardState({
			playerCount: snap.playerCount,
			size: snap.size,
			stoneHardness: snap.stoneHardness,
			defaultStrength: 1,
		});
		board.shrinkMargin = snap.shrinkMargin;
		let maxId = 0;
		for (const s of snap.stones) {
			const list = board.stonesByPlayer[s.playerIndex];
			if (!list) continue;
			list.push({
				id: s.id,
				playerIndex: s.playerIndex,
				position: { x: s.position.x, y: s.position.y },
				strength: s.strength,
			});
			if (s.id > maxId) maxId = s.id;
		}
		(board as unknown as { nextStoneId: number }).nextStoneId = maxId + 1;
		return board;
	}
}
