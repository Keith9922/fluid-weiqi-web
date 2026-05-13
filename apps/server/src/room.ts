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
	type LoungeRoomSummary,
	type RoomLifecycleStage,
	type RoomVisibility,
	type ServerLoungeRoomUpdate,
	type ServerMessage,
} from "@fluid/core";
import type { WebSocket } from "ws";

export type Connection = {
	socket: WebSocket;
	playerIndex: number;       // -1 = no slot
	name: string;
	isSpectator?: boolean;     // true iff joined via spectateRoom
};

export type SlotInfo =
	| { kind: "empty" }
	| { kind: "human"; conn: Connection }
	| { kind: "ai"; level: AiLevel; ai: AiStrategy; name: string };

export class Room {
	readonly code: string;
	readonly name: string;
	readonly visibility: RoomVisibility;
	readonly createdAt: number;
	match: Match;
	gameConfig: GameConfig;
	readonly connections = new Set<Connection>();
	private readonly slots: SlotInfo[] = [{ kind: "empty" }, { kind: "empty" }];

	constructor(
		code: string,
		gameConfig: GameConfig = DEFAULT_GAME_CONFIG,
		opts: { name?: string; visibility?: RoomVisibility } = {},
	) {
		this.code = code;
		this.gameConfig = gameConfig;
		this.match = new Match(matchConfigFromGameConfig(gameConfig));
		this.name = (opts.name ?? "对局房间").slice(0, 32);
		this.visibility = opts.visibility ?? "public";
		this.createdAt = Date.now();
	}

	addHuman(socket: WebSocket, name: string): Connection {
		const idx = this.slots.findIndex(s => s.kind === "empty");
		if (idx === -1) {
			// Spectator slot — not in slots[] but in connections set.
			const conn: Connection = { socket, playerIndex: -1, name, isSpectator: true };
			this.connections.add(conn);
			return conn;
		}
		const conn: Connection = { socket, playerIndex: idx, name };
		this.slots[idx] = { kind: "human", conn };
		this.connections.add(conn);
		return conn;
	}

	// Add a pure spectator (cannot ever be promoted to a player slot in this
	// session — they joined via the lounge with intent to watch).
	addSpectator(socket: WebSocket, name: string): Connection {
		const conn: Connection = { socket, playerIndex: -1, name, isSpectator: true };
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

	get spectatorCount(): number {
		let n = 0;
		for (const c of this.connections) {
			if (c.playerIndex < 0) ++n;
		}
		return n;
	}

	get stage(): RoomLifecycleStage {
		// Treat the match as "ended" once flow has flagged it (resign or two
		// consecutive passes). Otherwise: waiting until both seats filled.
		if (this.match.snapshot().flow.isEnded) return "ended";
		return this.matchStarted ? "playing" : "waiting";
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

	// Public summary for the lounge list.
	summary(): LoungeRoomSummary {
		const seated = this.slots
			.map((s, i): LoungeRoomSummary["players"][number] | null => {
				if (s.kind === "human")
					return { name: s.conn.name, playerIndex: i, isAi: false, connected: true };
				if (s.kind === "ai")
					return { name: s.name, playerIndex: i, isAi: true, aiLevel: s.level, connected: true };
				return null;
			})
			.filter((p): p is LoungeRoomSummary["players"][number] => p !== null);
		return {
			roomCode: this.code,
			roomName: this.name,
			visibility: this.visibility,
			stage: this.stage,
			players: seated,
			playerCount: seated.length,
			capacity: this.slots.length,
			spectatorCount: this.spectatorCount,
			boardSize: this.gameConfig.boardSize,
			createdAt: this.createdAt,
		};
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
	// Sockets subscribed to live lounge updates.
	private readonly loungeSubscribers = new Set<WebSocket>();
	// Used to detect "no meaningful change" so we don't spam updates on every
	// trivial action (chat, etc). Keyed by room code.
	private readonly lastSummary = new Map<string, string>();

	create(
		gameConfig: GameConfig = DEFAULT_GAME_CONFIG,
		opts: { name?: string; visibility?: RoomVisibility } = {},
	): Room {
		const code = this.uniqueCode();
		const room = new Room(code, gameConfig, opts);
		this.rooms.set(code, room);
		return room;
	}

	get(code: string): Room | undefined {
		return this.rooms.get(code.toUpperCase());
	}

	delete(code: string): void {
		const existed = this.rooms.delete(code);
		this.lastSummary.delete(code);
		if (existed) this.broadcastLounge({ t: "loungeRoomUpdate", kind: "removed", roomCode: code });
	}

	get size(): number {
		return this.rooms.size;
	}

	allRooms(): Room[] {
		return [...this.rooms.values()];
	}

	publicRoomSummaries(): LoungeRoomSummary[] {
		const out: LoungeRoomSummary[] = [];
		for (const r of this.rooms.values()) {
			if (r.visibility !== "public") continue;
			out.push(r.summary());
		}
		// Sort: waiting first (newest first), then playing, then ended.
		const stageOrder: Record<RoomLifecycleStage, number> = {
			waiting: 0,
			playing: 1,
			ended: 2,
		};
		out.sort((a, b) => {
			const so = stageOrder[a.stage] - stageOrder[b.stage];
			if (so !== 0) return so;
			return b.createdAt - a.createdAt;
		});
		return out;
	}

	subscribeLounge(socket: WebSocket): LoungeRoomSummary[] {
		this.loungeSubscribers.add(socket);
		return this.publicRoomSummaries();
	}

	unsubscribeLounge(socket: WebSocket): void {
		this.loungeSubscribers.delete(socket);
	}

	// Notify lounge subscribers of a public room change. Suppresses no-op
	// updates so we don't broadcast on every websocket twitch.
	publishRoomUpdate(room: Room): void {
		if (room.visibility !== "public") return;
		const summary = room.summary();
		const key = JSON.stringify(summary);
		if (this.lastSummary.get(room.code) === key) return;
		const existed = this.lastSummary.has(room.code);
		this.lastSummary.set(room.code, key);
		const msg: ServerLoungeRoomUpdate = {
			t: "loungeRoomUpdate",
			kind: existed ? "updated" : "added",
			roomCode: room.code,
			summary,
		};
		this.broadcastLounge(msg);
	}

	private broadcastLounge(msg: ServerMessage): void {
		const json = JSON.stringify(msg);
		for (const s of this.loungeSubscribers) {
			if (s.readyState === s.OPEN) s.send(json);
		}
	}

	// Sweep stale waiting rooms — public rooms that have been waiting more
	// than `maxWaitMs` with only one human and no AI seated get closed so the
	// lounge doesn't fill up with abandoned codes.
	sweepStaleRooms(maxWaitMs = 10 * 60 * 1000, now = Date.now()): string[] {
		const removed: string[] = [];
		for (const [code, room] of this.rooms) {
			if (room.visibility !== "public") continue;
			if (room.stage !== "waiting") continue;
			if (room.hasAiPlayer) continue;
			if (now - room.createdAt < maxWaitMs) continue;
			// Only sweep if there are no connected humans actively waiting in
			// the room — they might be staring at the room with the share
			// code dialog open.
			const liveHumans = [...room.connections].some(
				c => c.playerIndex >= 0 && c.socket.readyState === c.socket.OPEN,
			);
			if (liveHumans) continue;
			this.delete(code);
			removed.push(code);
		}
		return removed;
	}

	private uniqueCode(): string {
		for (let i = 0; i < 32; ++i) {
			const c = randomCode();
			if (!this.rooms.has(c)) return c;
		}
		// Fallback: extremely unlikely with 6-char alphabet of 32 symbols.
		return randomCode() + "Z";
	}
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function randomCode(): string {
	let s = "";
	for (let i = 0; i < 6; ++i) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
	return s;
}

const AI_DISPLAY: Record<AiLevel, string> = {
	easy:   "老宋",
	medium: "老王",
	hard:   "牢张",
	hell:   "牢鹰",
};
function aiName(level: AiLevel): string {
	return AI_DISPLAY[level];
}
