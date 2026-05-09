// WebSocket protocol between web client and server.
// All messages are JSON. `t` (type) is a discriminated tag.

import type { MatchActionRequest, MatchSnapshot } from "./types.ts";

// ---- Client -> Server ----------------------------------------------------

export type ClientCreateRoom = {
	t: "createRoom";
	playerName: string;
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
	| ClientJoinRoom
	| ClientAction
	| ClientLeaveRoom;

// ---- Server -> Client ----------------------------------------------------

export type RoomPlayerInfo = {
	playerIndex: number;
	name: string;
	connected: boolean;
};

export type ServerRoomState = {
	t: "roomState";
	roomCode: string;
	yourPlayerIndex: number;        // -1 if spectator (room full or no slot yet)
	players: RoomPlayerInfo[];
	matchStarted: boolean;
	snapshot: MatchSnapshot | null;
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
	| ServerError;
