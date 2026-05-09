// Fluid Weiqi WebSocket relay server.
//
// Protocol: see packages/core/src/protocol.ts. JSON messages over a single
// WebSocket. State lives in-memory (no DB), so this is "kill the process =
// kill all rooms" — fine for MVP.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type {
	ClientMessage,
	ServerActionAccepted,
	ServerActionRejected,
	ServerError,
	ServerRoomState,
} from "@fluid/core";
import { Room, RoomStore, type Connection } from "./room.ts";

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
			const room = store.create();
			joinRoom(socket, room, msg.playerName || "P1");
			break;
		}
		case "joinRoom": {
			const room = store.get(msg.roomCode);
			if (!room) return sendError(socket, `room ${msg.roomCode} not found`);
			joinRoom(socket, room, msg.playerName || "P?");
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
			const captured = Math.max(0, before - after);

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
			break;
		}
		case "leaveRoom": {
			const entry = connectionRoom.get(socket);
			if (!entry) return;
			const { room, conn } = entry;
			room.remove(conn);
			connectionRoom.delete(socket);
			room.broadcast(buildRoomState(room, conn));
			if (room.connections.size === 0) store.delete(room.code);
			break;
		}
	}
}

function handleClose(socket: WebSocket): void {
	const entry = connectionRoom.get(socket);
	if (!entry) return;
	const { room, conn } = entry;
	room.remove(conn);
	connectionRoom.delete(socket);
	if (room.connections.size === 0) {
		store.delete(room.code);
		return;
	}
	// Notify remaining clients of the slot state change.
	for (const c of room.connections) {
		safeSend(c.socket, buildRoomState(room, c));
	}
}

function joinRoom(socket: WebSocket, room: Room, name: string): void {
	const conn = room.addPlayer(socket, name);
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
