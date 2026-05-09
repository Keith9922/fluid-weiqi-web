// Tiny WebSocket client wrapper for the Fluid Weiqi protocol.
// Auto-reconnect is intentionally NOT implemented — this is a turn-based game,
// dropped connections should fail loudly instead of silently desyncing state.

import type { ClientMessage, ServerMessage } from "@fluid/core";

export type WsClientStatus = "idle" | "connecting" | "open" | "closed" | "error";

export type WsClientHandlers = {
	onMessage: (msg: ServerMessage) => void;
	onStatus?: (status: WsClientStatus) => void;
};

export class WsClient {
	private socket: WebSocket | null = null;
	private status: WsClientStatus = "idle";

	constructor(private readonly url: string, private readonly handlers: WsClientHandlers) {}

	connect(): void {
		if (this.socket && this.socket.readyState <= 1) return;
		this.setStatus("connecting");
		this.socket = new WebSocket(this.url);

		this.socket.addEventListener("open", () => this.setStatus("open"));
		this.socket.addEventListener("close", () => this.setStatus("closed"));
		this.socket.addEventListener("error", () => this.setStatus("error"));
		this.socket.addEventListener("message", ev => {
			let msg: ServerMessage;
			try {
				msg = JSON.parse(typeof ev.data === "string" ? ev.data : "") as ServerMessage;
			} catch {
				return;
			}
			this.handlers.onMessage(msg);
		});
	}

	send(msg: ClientMessage): boolean {
		if (!this.socket || this.socket.readyState !== this.socket.OPEN) return false;
		this.socket.send(JSON.stringify(msg));
		return true;
	}

	close(): void {
		this.socket?.close();
	}

	getStatus(): WsClientStatus {
		return this.status;
	}

	private setStatus(s: WsClientStatus): void {
		this.status = s;
		this.handlers.onStatus?.(s);
	}
}

export function defaultWsUrl(): string {
	const proto = location.protocol === "https:" ? "wss" : "ws";
	return `${proto}://${location.host}/ws`;
}
