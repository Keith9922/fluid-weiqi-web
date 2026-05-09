// WebSocket protocol between web client and server.
// All messages are JSON. `t` (type) is a discriminated tag.

import type { AiLevel } from "./ai/types.ts";
import type { MatchActionRequest, MatchSnapshot } from "./types.ts";

// Custom game configuration (passed when creating a room).
// Sensible defaults match Match.DEFAULT_MATCH_CONFIG.
export type GameConfig = {
	boardSize: number;       // 9 / 13 / 19, etc.
	stoneHardness: number;   // 0..0.99
	stoneStrength: number;   // 0.5..2.0
};

export const DEFAULT_GAME_CONFIG: GameConfig = {
	boardSize: 19,
	stoneHardness: 0.25,
	stoneStrength: 1.0,
};

// ---- Client -> Server ----------------------------------------------------

export type ClientCreateRoom = {
	t: "createRoom";
	playerName: string;
	gameConfig?: GameConfig;
};

export type ClientCreateAiRoom = {
	t: "createAiRoom";
	playerName: string;
	aiLevel: AiLevel;
	humanPlaysFirst?: boolean;   // default true
	gameConfig?: GameConfig;
};

export type ClientJoinRoom = {
	t: "joinRoom";
	roomCode: string;
	playerName: string;
};

export type ClientAction = {
	t: "action";
	roomCode: string;
	action: MatchActionRequest;
};

export type ClientLeaveRoom = {
	t: "leaveRoom";
	roomCode: string;
};

export type ClientMessage =
	| ClientCreateRoom
	| ClientCreateAiRoom
	| ClientJoinRoom
	| ClientAction
	| ClientLeaveRoom;

// ---- Server -> Client ----------------------------------------------------

export type RoomPlayerInfo = {
	playerIndex: number;
	name: string;
	connected: boolean;
	isAi: boolean;
	aiLevel?: AiLevel;
};

export type ServerRoomState = {
	t: "roomState";
	roomCode: string;
	yourPlayerIndex: number;        // -1 if spectator (room full or no slot yet)
	players: RoomPlayerInfo[];
	matchStarted: boolean;
	snapshot: MatchSnapshot | null;
	gameConfig: GameConfig;
};

export type ServerAiThinking = {
	t: "aiThinking";
	playerIndex: number;
};

export type ServerActionAccepted = {
	t: "actionAccepted";
	snapshot: MatchSnapshot;
	captured: number;               // number of stones removed by the move
};

export type ServerActionRejected = {
	t: "actionRejected";
	reason: string;
	snapshot: MatchSnapshot;
};

export type ServerError = {
	t: "error";
	reason: string;
};

export type ServerMessage =
	| ServerRoomState
	| ServerActionAccepted
	| ServerActionRejected
	| ServerAiThinking
	| ServerError;
