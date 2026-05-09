// In-memory room store.
// One Match per room, capacity = 2 players (humans or AI).

import {
	createAi,
	DEFAULT_GAME_CONFIG,
	Match,
	matchConfigFromGameConfig,
	type AiLevel,
	type AiStrategy,
	type GameConfig,
	type ServerMessage,
} from "@fluid/core";
import type { WebSocket } from "ws";

export type Connection = {
	socket: WebSocket;
	playerIndex: number;       // -1 = no slot
	name: string;
};

export type SlotInfo =
	| { kind: "empty" }
	| { kind: "human"; conn: Connection }
	| { kind: "ai"; level: AiLevel; ai: AiStrategy; name: string };

export class Room {
	readonly code: string;
	match: Match;
	gameConfig: GameConfig;
	readonly connections = new Set<Connection>();
	private readonly slots: SlotInfo[] = [{ kind: "empty" }, { kind: "empty" }];

	constructor(code: string, gameConfig: GameConfig = DEFAULT_GAME_CONFIG) {
		this.code = code;
		this.gameConfig = gameConfig;
		this.match = new Match(matchConfigFromGameConfig(gameConfig));
	}

	addHuman(socket: WebSocket, name: string): Connection {
		const idx = this.slots.findIndex(s => s.kind === "empty");
		if (idx === -1) {
			// Spectator slot — not in slots[] but in connections set.
			const conn: Connection = { socket, playerIndex: -1, name };
			this.connections.add(conn);
			return conn;
		}
		const conn: Connection = { socket, playerIndex: idx, name };
		this.slots[idx] = { kind: "human", conn };
		this.connections.add(conn);
		return conn;
	}

	addAi(slotIndex: number, level: AiLevel, name = aiName(level)): void {
		this.slots[slotIndex] = { kind: "ai", level, ai: createAi(level), name };
	}

	removeConnection(conn: Connection): void {
		this.connections.delete(conn);
		if (conn.playerIndex >= 0) {
			const slot = this.slots[conn.playerIndex];
			if (slot && slot.kind === "human" && slot.conn === conn) {
				this.slots[conn.playerIndex] = { kind: "empty" };
			}
		}
	}

	get filledSlotCount(): number {
		return this.slots.filter(s => s.kind !== "empty").length;
	}

	get matchStarted(): boolean {
		return this.filledSlotCount === 2;
	}

	get hasAiPlayer(): boolean {
		return this.slots.some(s => s.kind === "ai");
	}

	getSlot(i: number): SlotInfo | undefined {
		return this.slots[i];
	}

	playerInfo(): {
		playerIndex: number;
		name: string;
		connected: boolean;
		isAi: boolean;
		aiLevel?: AiLevel;
	}[] {
		return this.slots.map((s, i) => {
			if (s.kind === "human") {
				return { playerIndex: i, name: s.conn.name, connected: true, isAi: false };
			}
			if (s.kind === "ai") {
				return { playerIndex: i, name: s.name, connected: true, isAi: true, aiLevel: s.level };
			}
			return { playerIndex: i, name: "(empty)", connected: false, isAi: false };
		});
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

	create(gameConfig: GameConfig = DEFAULT_GAME_CONFIG): Room {
		const code = randomCode();
		const room = new Room(code, gameConfig);
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
	for (let i = 0; i < 6; ++i) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
	return s;
}

const AI_DISPLAY: Record<AiLevel, string> = {
	easy:   "AI · 简单",
	medium: "AI · 中级",
	hard:   "AI · 困难",
	hell:   "AI · 地狱",
};
function aiName(level: AiLevel): string {
	return AI_DISPLAY[level];
}
