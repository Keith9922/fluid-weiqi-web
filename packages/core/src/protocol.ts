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

// Room visibility — public rooms appear in the live lounge; private rooms
// require the host to share the room code out-of-band (legacy flow).
export type RoomVisibility = "public" | "private";

// Lifecycle of a room from the lounge's perspective.
//   waiting — created, waiting for a second player (PvP) or AI to seat
//   playing — match in progress
//   ended   — match concluded; room may still be open for review but no new
//             players will be accepted
export type RoomLifecycleStage = "waiting" | "playing" | "ended";

// ---- Client -> Server ----------------------------------------------------

export type ClientCreateRoom = {
	t: "createRoom";
	playerName: string;
	gameConfig?: GameConfig;
	// New (optional for backward compat):
	roomName?: string;          // display name; defaults to "{playerName} 的房间"
	visibility?: RoomVisibility; // default "public" — appears in the lounge list
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

// Subscribe to live lounge updates. Server replies with a `loungeSnapshot`,
// then streams `loungeRoomUpdate` events until the client unsubscribes or
// disconnects.
export type ClientSubscribeLounge = {
	t: "subscribeLounge";
};

export type ClientUnsubscribeLounge = {
	t: "unsubscribeLounge";
};

// Join a room as a spectator. Spectator sees the full board state including
// the territory bar but cannot place / pass / resign. `yourPlayerIndex` in
// the resulting roomState is -1.
export type ClientSpectateRoom = {
	t: "spectateRoom";
	roomCode: string;
	viewerName?: string;    // optional; defaults to "观众"
};

export type ClientMessage =
	| ClientCreateRoom
	| ClientCreateAiRoom
	| ClientJoinRoom
	| ClientAction
	| ClientLeaveRoom
	| ClientSubscribeLounge
	| ClientUnsubscribeLounge
	| ClientSpectateRoom;

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
	// Optional metadata used by the lounge/spectator UI. Older clients ignore.
	roomName?: string;
	visibility?: RoomVisibility;
	stage?: RoomLifecycleStage;
	spectatorCount?: number;
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

// Public-facing summary of a room, sent to lounge subscribers.
export type LoungeRoomSummary = {
	roomCode: string;
	roomName: string;
	visibility: RoomVisibility;
	stage: RoomLifecycleStage;
	players: {
		name: string;
		playerIndex: number;
		isAi: boolean;
		aiLevel?: AiLevel;
		connected: boolean;
	}[];
	playerCount: number;        // currently seated (excludes empty slots)
	capacity: number;           // total seats (2 for now)
	spectatorCount: number;
	boardSize: number;
	createdAt: number;          // unix ms
};

// Initial dump of all public rooms after `subscribeLounge`.
export type ServerLoungeSnapshot = {
	t: "loungeSnapshot";
	rooms: LoungeRoomSummary[];
	serverTime: number;         // unix ms, so clients can render "x 秒前"
};

// Incremental update: a public room was added, updated, or removed/closed.
// For "removed", the `summary` field is omitted.
export type ServerLoungeRoomUpdate = {
	t: "loungeRoomUpdate";
	kind: "added" | "updated" | "removed";
	roomCode: string;
	summary?: LoungeRoomSummary;
};

export type ServerMessage =
	| ServerRoomState
	| ServerActionAccepted
	| ServerActionRejected
	| ServerAiThinking
	| ServerError
	| ServerLoungeSnapshot
	| ServerLoungeRoomUpdate;
