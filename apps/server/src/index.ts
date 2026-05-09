// Fluid Weiqi WebSocket relay server.
//
// Protocol: see packages/core/src/protocol.ts. JSON messages over a single
// WebSocket. State lives in-memory (no DB), so this is "kill the process =
// kill all rooms" — fine for MVP.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import {
	DEFAULT_GAME_CONFIG,
	matchConfigFromGameConfig,
	Match,
	type ClientMessage,
	type GameConfig,
	type ServerActionAccepted,
	type ServerActionRejected,
	type ServerError,
	type ServerRoomState,
} from "@fluid/core";
import { Room, RoomStore, type Connection } from "./room.ts";
import { maybeScheduleAi } from "./aiOrchestrator.ts";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "0.0.0.0";

const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
	if (req.url === "/" || req.url === "/health") {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ ok: true, rooms: store.size }));
		return;
	}
	res.writeHead(404);
	res.end();
});

const wss = new WebSocketServer({ server: httpServer });
const store = new RoomStore();

// Track which connection is in which room.
const connectionRoom = new WeakMap<WebSocket, { room: Room; conn: Connection }>();

wss.on("connection", socket => {
	socket.on("message", buf => handleMessage(socket, buf.toString()));
	socket.on("close", () => handleClose(socket));
	socket.on("error", () => handleClose(socket));
});

function handleMessage(socket: WebSocket, raw: string): void {
	let msg: ClientMessage;
	try {
		msg = JSON.parse(raw) as ClientMessage;
	} catch {
		return sendError(socket, "invalid JSON");
	}

	switch (msg.t) {
		case "createRoom": {
			const config = sanitizeConfig(msg.gameConfig ?? DEFAULT_GAME_CONFIG);
			const room = store.create(config);
			joinHumanToRoom(socket, room, msg.playerName || "P1");
			break;
		}
		case "createAiRoom": {
			const config = sanitizeConfig(msg.gameConfig ?? DEFAULT_GAME_CONFIG);
			const room = store.create(config);
			const humanFirst = msg.humanPlaysFirst !== false;
			const humanSlot = humanFirst ? 0 : 1;
			const aiSlot = 1 - humanSlot;
			room.addAi(aiSlot, msg.aiLevel);
			joinHumanToRoom(socket, room, msg.playerName || "Player", humanSlot);
			// If the AI is slot 0 (human played second), trigger AI to move first.
			maybeScheduleAi(room);
			break;
		}
		case "joinRoom": {
			const room = store.get(msg.roomCode);
			if (!room) return sendError(socket, `room ${msg.roomCode} not found`);
			joinHumanToRoom(socket, room, msg.playerName || "P?");
			break;
		}
		case "action": {
			const entry = connectionRoom.get(socket);
			if (!entry) return sendError(socket, "not in a room");
			const { room, conn } = entry;
			if (conn.playerIndex < 0)
				return sendError(socket, "spectators cannot act");
			if (conn.playerIndex !== msg.action.playerIndex)
				return sendError(socket, "playerIndex mismatch");

			const before = countStones(room);
			const result = room.match.apply(msg.action);
			const after = countStones(room);
			const captured = Math.max(0, before + (msg.action.actionType === "place" ? 1 : 0) - after);

			if (!result.accepted) {
				const rej: ServerActionRejected = {
					t: "actionRejected",
					reason: result.reason ?? "rejected",
					snapshot: result.snapshot,
				};
				safeSend(socket, rej);
				return;
			}

			const acc: ServerActionAccepted = {
				t: "actionAccepted",
				snapshot: result.snapshot,
				captured,
			};
			room.broadcast(acc);

			// If the next turn is an AI, kick off its computation.
			maybeScheduleAi(room);
			break;
		}
		case "leaveRoom": {
			const entry = connectionRoom.get(socket);
			if (!entry) return;
			const { room, conn } = entry;
			room.removeConnection(conn);
			connectionRoom.delete(socket);
			room.broadcast(buildRoomState(room, conn));
			if (room.connections.size === 0 && !room.hasAiPlayer) store.delete(room.code);
			break;
		}
	}
}

function handleClose(socket: WebSocket): void {
	const entry = connectionRoom.get(socket);
	if (!entry) return;
	const { room, conn } = entry;
	room.removeConnection(conn);
	connectionRoom.delete(socket);
	if (room.connections.size === 0) {
		// Even AI-only rooms get cleaned up when the human leaves.
		store.delete(room.code);
		return;
	}
	for (const c of room.connections) {
		safeSend(c.socket, buildRoomState(room, c));
	}
}

function joinHumanToRoom(
	socket: WebSocket,
	room: Room,
	name: string,
	preferSlot?: number,
): void {
	// If preferSlot is set and that slot is empty, fill it; else fall back to addHuman.
	if (preferSlot !== undefined) {
		const s = room.getSlot(preferSlot);
		if (s && s.kind === "empty") {
			const conn: Connection = { socket, playerIndex: preferSlot, name };
			(room as unknown as { slots: unknown[] }).slots[preferSlot] = { kind: "human", conn };
			room.connections.add(conn);
			connectionRoom.set(socket, { room, conn });
			for (const c of room.connections) {
				safeSend(c.socket, buildRoomState(room, c));
			}
			return;
		}
	}
	const conn = room.addHuman(socket, name);
	connectionRoom.set(socket, { room, conn });
	for (const c of room.connections) {
		safeSend(c.socket, buildRoomState(room, c));
	}
}

function buildRoomState(room: Room, viewer: Connection): ServerRoomState {
	return {
		t: "roomState",
		roomCode: room.code,
		yourPlayerIndex: viewer.playerIndex,
		players: room.playerInfo(),
		matchStarted: room.matchStarted,
		snapshot: room.match.snapshot(),
		gameConfig: room.gameConfig,
	};
}

function sanitizeConfig(c: GameConfig): GameConfig {
	// Round-trip through Match's clamp so the server never honors out-of-range
	// values from clients.
	const matchConfig = matchConfigFromGameConfig(c);
	return {
		boardSize: matchConfig.board.size,
		stoneHardness: matchConfig.board.stoneHardness,
		stoneStrength: matchConfig.stoneStrength,
	};
}

function countStones(room: Room): number {
	return room.match.board.allStones().length;
}

function safeSend(socket: WebSocket, msg: object): void {
	if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
}

function sendError(socket: WebSocket, reason: string): void {
	const err: ServerError = { t: "error", reason };
	safeSend(socket, err);
}

httpServer.listen(PORT, HOST, () => {
	console.log(`[fluid-weiqi server] listening on http://${HOST}:${PORT}`);
});

// Reference Match to silence unused-import lints during dev.
void Match;
