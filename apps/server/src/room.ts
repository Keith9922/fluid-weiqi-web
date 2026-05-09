// In-memory room store. One Match per room, capacity = 2 players for MVP.

import { Match, type ClientMessage, type ServerMessage } from "@fluid/core";
import type { WebSocket } from "ws";

export type Connection = {
	socket: WebSocket;
	playerIndex: number;       // -1 = no slot
	name: string;
};

export class Room {
	readonly code: string;
	readonly match = new Match();
	readonly connections = new Set<Connection>();
	private readonly slots: (Connection | null)[] = [null, null];

	constructor(code: string) {
		this.code = code;
	}

	addPlayer(socket: WebSocket, name: string): Connection {
		let slotIndex = this.slots.findIndex(s => s === null);
		if (slotIndex === -1) {
			// Spectator slot.
			const conn: Connection = { socket, playerIndex: -1, name };
			this.connections.add(conn);
			return conn;
		}
		const conn: Connection = { socket, playerIndex: slotIndex, name };
		this.slots[slotIndex] = conn;
		this.connections.add(conn);
		return conn;
	}

	remove(conn: Connection): void {
		this.connections.delete(conn);
		if (conn.playerIndex >= 0 && this.slots[conn.playerIndex] === conn)
			this.slots[conn.playerIndex] = null;
	}

	get playerCount(): number {
		return this.slots.filter(s => s !== null).length;
	}

	get matchStarted(): boolean {
		return this.playerCount === 2;
	}

	playerInfo(): { playerIndex: number; name: string; connected: boolean }[] {
		return this.slots.map((s, i) => ({
			playerIndex: i,
			name: s?.name ?? "(empty)",
			connected: s !== null,
		}));
	}

	broadcast(msg: ServerMessage): void {
		const json = JSON.stringify(msg);
		for (const c of this.connections) {
			if (c.socket.readyState === c.socket.OPEN) c.socket.send(json);
		}
	}
}

export class RoomStore {
	private readonly rooms = new Map<string, Room>();

	create(): Room {
		const code = randomCode();
		const room = new Room(code);
		this.rooms.set(code, room);
		return room;
	}

	get(code: string): Room | undefined {
		return this.rooms.get(code.toUpperCase());
	}

	delete(code: string): void {
		this.rooms.delete(code);
	}

	get size(): number {
		return this.rooms.size;
	}
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function randomCode(): string {
	let s = "";
	for (let i = 0; i < 6; ++i)
		s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
	return s;
}

// Helper for the server entrypoint to silence unused-var on ClientMessage.
export type _Unused = ClientMessage;
