// Top-level app: lobby → in-room state machine. Owns the WS connection and
// dispatches to <Lobby> or <Game> depending on whether we've joined a room.

import { useCallback, useEffect, useRef, useState } from "react";
import type { MatchActionRequest, MatchSnapshot, RoomPlayerInfo, ServerMessage } from "@fluid/core";
import { Game } from "./Game.tsx";
import { Lobby } from "./Lobby.tsx";
import { WsClient, defaultWsUrl, type WsClientStatus } from "./wsClient.ts";

type RoomState = {
	roomCode: string;
	myPlayerIndex: number;
	players: RoomPlayerInfo[];
	matchStarted: boolean;
	snapshot: MatchSnapshot | null;
};

export function App() {
	const clientRef = useRef<WsClient | null>(null);
	const [status, setStatus] = useState<WsClientStatus>("idle");
	const [room, setRoom] = useState<RoomState | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [rejection, setRejection] = useState<string | null>(null);

	const handleMessage = useCallback((msg: ServerMessage) => {
		switch (msg.t) {
			case "roomState":
				setRoom({
					roomCode: msg.roomCode,
					myPlayerIndex: msg.yourPlayerIndex,
					players: msg.players,
					matchStarted: msg.matchStarted,
					snapshot: msg.snapshot,
				});
				setError(null);
				setRejection(null);
				break;
			case "actionAccepted":
				setRoom(prev => prev ? { ...prev, snapshot: msg.snapshot } : prev);
				setRejection(null);
				break;
			case "actionRejected":
				setRoom(prev => prev ? { ...prev, snapshot: msg.snapshot } : prev);
				setRejection(msg.reason);
				break;
			case "error":
				setError(msg.reason);
				break;
		}
	}, []);

	const ensureClient = useCallback((): WsClient => {
		if (!clientRef.current) {
			clientRef.current = new WsClient(defaultWsUrl(), {
				onMessage: handleMessage,
				onStatus: setStatus,
			});
		}
		return clientRef.current;
	}, [handleMessage]);

	useEffect(() => () => clientRef.current?.close(), []);

	const sendWhenOpen = (
		client: WsClient,
		then: () => void,
		timeoutMs = 4000,
	): void => {
		if (client.getStatus() === "open") {
			then();
			return;
		}
		const start = Date.now();
		const id = setInterval(() => {
			if (client.getStatus() === "open") {
				clearInterval(id);
				then();
			} else if (client.getStatus() === "error" || client.getStatus() === "closed" ||
				Date.now() - start > timeoutMs) {
				clearInterval(id);
				setError("无法连接到服务器，请确认后端正在运行 (npm run dev:server)");
			}
		}, 60);
	};

	const onCreateRoom = (name: string) => {
		setError(null);
		const c = ensureClient();
		c.connect();
		sendWhenOpen(c, () => c.send({ t: "createRoom", playerName: name }));
	};

	const onJoinRoom = (code: string, name: string) => {
		setError(null);
		const c = ensureClient();
		c.connect();
		sendWhenOpen(c, () => c.send({ t: "joinRoom", roomCode: code, playerName: name }));
	};

	const onAction = (req: MatchActionRequest) => {
		if (!room || !clientRef.current) return;
		clientRef.current.send({
			t: "action",
			roomCode: room.roomCode,
			action: req,
		});
	};

	const onLeave = () => {
		if (room && clientRef.current) {
			clientRef.current.send({ t: "leaveRoom", roomCode: room.roomCode });
		}
		setRoom(null);
		setRejection(null);
	};

	return (
		<>
			<header className="app-header">
				<h1>液态围棋 · Fluid Weiqi</h1>
				<div className="meta">
					Web port · 原作者{" "}
					<a href="https://github.com/WangNianyi2001/Fluid-Weiqi" target="_blank" rel="noreferrer">
						@WangNianyi2001
					</a>
					{" · "}
					<span className={`status status-${status}`}>{statusLabel(status)}</span>
				</div>
			</header>
			<main className="app-main">
				{!room || !room.snapshot ? (
					<Lobby
						connecting={status === "connecting"}
						error={error}
						onCreateRoom={onCreateRoom}
						onJoinRoom={onJoinRoom}
					/>
				) : (
					<Game
						roomCode={room.roomCode}
						myPlayerIndex={room.myPlayerIndex}
						players={room.players}
						snapshot={room.snapshot}
						matchStarted={room.matchStarted}
						rejection={rejection}
						onAction={onAction}
						onLeave={onLeave}
					/>
				)}
			</main>
		</>
	);
}

function statusLabel(s: WsClientStatus): string {
	switch (s) {
		case "idle": return "未连接";
		case "connecting": return "连接中…";
		case "open": return "已连接";
		case "closed": return "已断开";
		case "error": return "连接错误";
	}
}
