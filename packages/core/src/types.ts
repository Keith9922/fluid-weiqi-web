// Shared types for the Fluid Weiqi web port.
// Mirrors the C# data structures in Assets/Scripts/Board/BoardState.cs and
// Assets/Scripts/Network/NetworkDtos.cs.

export type Vec2 = { x: number; y: number };

export type StonePlacement = {
	id: number;
	playerIndex: number;
	position: Vec2;
	strength: number;
};

export type BoardSnapshot = {
	playerCount: number;
	size: number;
	stoneHardness: number;
	shrinkMargin: number;
	stones: StonePlacement[];
};

export type MatchActionType = "place" | "pass";

export type MatchActionRequest = {
	playerIndex: number;
	actionType: MatchActionType;
	position?: Vec2;
	turnSeq: number;
	actionSeq: number;
};

export type MatchFlowSnapshot = {
	currentPlayerIndex: number;
	turnSeq: number;
	isEnded: boolean;
	passStates: boolean[];
	winnerIndex: number | null;
};

export type MatchSnapshot = {
	board: BoardSnapshot;
	flow: MatchFlowSnapshot;
};

export type MatchActionResult = {
	accepted: boolean;
	reason?: string;
	playerIndex: number;
	actionSeq: number;
	snapshot: MatchSnapshot;
};
