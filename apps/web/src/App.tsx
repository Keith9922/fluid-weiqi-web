// Top-level app: lobby ↔ in-room state machine. Owns the WS connection and
// dispatches to <Lobby> or <Game> depending on whether we've joined a room.

import { useCallback, useEffect, useRef, useState } from "react";
import {
	DEFAULT_GAME_CONFIG,
	type AiLevel,
	type GameConfig,
	type LoungeRoomSummary,
	type MatchActionRequest,
	type MatchSnapshot,
	type RoomPlayerInfo,
	type RoomVisibility,
	type ServerMessage,
} from "@fluid/core";
import { Game } from "./Game.tsx";
import { Lobby, type Tab as LobbyTab } from "./Lobby.tsx";
import { applyTheme, getInitialTheme, toggleTheme, type Theme } from "./theme.ts";
import { WsClient, defaultWsUrl, type WsClientStatus } from "./wsClient.ts";

type RoomState = {
	roomCode: string;
	myPlayerIndex: number;          // -1 = spectator
	players: RoomPlayerInfo[];
	matchStarted: boolean;
	snapshot: MatchSnapshot | null;
	gameConfig: GameConfig;
};

export function App() {
	const clientRef = useRef<WsClient | null>(null);
	const [status, setStatus] = useState<WsClientStatus>("idle");
	const [room, setRoom] = useState<RoomState | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [rejection, setRejection] = useState<string | null>(null);
	const [aiThinking, setAiThinking] = useState(false);
	const [captureToast, setCaptureToast] = useState<{ id: number; count: number } | null>(null);
	const [theme, setTheme] = useState<Theme>(() => getInitialTheme());

	// Lounge state — kept across tab toggles so re-opening the 棋室 tab
	// doesn't blank out and re-fetch.
	const [loungeRooms, setLoungeRooms] = useState<LoungeRoomSummary[]>([]);
	const [loungeSubscribed, setLoungeSubscribed] = useState(false);
	const [loungeServerTime, setLoungeServerTime] = useState<number | null>(null);
	const loungeWantedRef = useRef(false);   // user is currently viewing the lounge tab

	useEffect(() => {
		applyTheme(theme);
	}, [theme]);

	const handleMessage = useCallback((msg: ServerMessage) => {
		switch (msg.t) {
			case "roomState":
				setRoom({
					roomCode: msg.roomCode,
					myPlayerIndex: msg.yourPlayerIndex,
					players: msg.players,
					matchStarted: msg.matchStarted,
					snapshot: msg.snapshot,
					gameConfig: msg.gameConfig,
				});
				setError(null);
				setRejection(null);
				break;
			case "actionAccepted":
				setRoom(prev => prev ? { ...prev, snapshot: msg.snapshot } : prev);
				setRejection(null);
				setAiThinking(false);
				if (msg.captured > 0) {
					setCaptureToast({ id: Date.now(), count: msg.captured });
				}
				break;
			case "actionRejected":
				setRoom(prev => prev ? { ...prev, snapshot: msg.snapshot } : prev);
				setRejection(msg.reason);
				break;
			case "aiThinking":
				setAiThinking(true);
				break;
			case "error":
				setError(msg.reason);
				break;
			case "loungeSnapshot":
				setLoungeRooms(msg.rooms);
				setLoungeServerTime(msg.serverTime);
				setLoungeSubscribed(true);
				break;
			case "loungeRoomUpdate":
				setLoungeRooms(prev => {
					if (msg.kind === "removed") {
						return prev.filter(r => r.roomCode !== msg.roomCode);
					}
					if (!msg.summary) return prev;
					const idx = prev.findIndex(r => r.roomCode === msg.roomCode);
					if (idx === -1) return [msg.summary, ...prev];
					const next = prev.slice();
					next[idx] = msg.summary;
					return next;
				});
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
		timeoutMs = 5000,
	): void => {
		if (client.getStatus() === "open") return then();
		const start = Date.now();
		const id = setInterval(() => {
			if (client.getStatus() === "open") {
				clearInterval(id);
				then();
			} else if (
				client.getStatus() === "error" ||
				client.getStatus() === "closed" ||
				Date.now() - start > timeoutMs
			) {
				clearInterval(id);
				setError("无法连接到服务器，请稍后再试。");
			}
		}, 60);
	};

	const onCreateOnline = (
		name: string,
		gameConfig: GameConfig,
		opts?: { roomName?: string; visibility?: RoomVisibility },
	) => {
		setError(null);
		const c = ensureClient();
		c.connect();
		sendWhenOpen(c, () => c.send({
			t: "createRoom",
			playerName: name,
			gameConfig,
			roomName: opts?.roomName,
			visibility: opts?.visibility,
		}));
	};

	const onCreateAi = (name: string, aiLevel: AiLevel, humanFirst: boolean, gameConfig: GameConfig) => {
		setError(null);
		const c = ensureClient();
		c.connect();
		sendWhenOpen(c, () => c.send({
			t: "createAiRoom",
			playerName: name,
			aiLevel,
			humanPlaysFirst: humanFirst,
			gameConfig,
		}));
	};

	const onJoinRoom = (code: string, name: string) => {
		setError(null);
		const c = ensureClient();
		c.connect();
		sendWhenOpen(c, () => c.send({ t: "joinRoom", roomCode: code, playerName: name }));
	};

	const onSpectate = (code: string, viewerName: string) => {
		setError(null);
		const c = ensureClient();
		c.connect();
		sendWhenOpen(c, () => c.send({ t: "spectateRoom", roomCode: code, viewerName }));
	};

	const onAction = (req: MatchActionRequest) => {
		if (!room || !clientRef.current) return;
		clientRef.current.send({ t: "action", roomCode: room.roomCode, action: req });
	};

	const onLeave = () => {
		if (room && clientRef.current) {
			clientRef.current.send({ t: "leaveRoom", roomCode: room.roomCode });
		}
		setRoom(null);
		setRejection(null);
		setAiThinking(false);
	};

	// Re-subscribe to the lounge whenever the user is on that tab AND the
	// socket is open. Re-running the effect on `status` covers WS reconnects:
	// if the server restarts, the snapshot is pushed fresh.
	const subscribeLoungeNow = useCallback(() => {
		const c = clientRef.current;
		if (!c || c.getStatus() !== "open") return;
		c.send({ t: "subscribeLounge" });
	}, []);

	const unsubscribeLoungeNow = useCallback(() => {
		const c = clientRef.current;
		if (!c || c.getStatus() !== "open") return;
		c.send({ t: "unsubscribeLounge" });
	}, []);

	const onLobbyTabChange = (tab: LobbyTab) => {
		const wantLounge = tab === "lounge";
		loungeWantedRef.current = wantLounge;
		if (wantLounge) {
			// Make sure the client is connected, then subscribe.
			const c = ensureClient();
			c.connect();
			setLoungeSubscribed(false);
			sendWhenOpen(c, subscribeLoungeNow);
		} else {
			setLoungeSubscribed(false);
			setLoungeRooms([]);
			unsubscribeLoungeNow();
		}
	};

	// If we reconnect while still on the lounge tab, re-subscribe.
	useEffect(() => {
		if (status === "open" && loungeWantedRef.current && !loungeSubscribed) {
			subscribeLoungeNow();
		}
	}, [status, loungeSubscribed, subscribeLoungeNow]);

	// While in a game room, the lounge subscription is irrelevant — drop it
	// so the user doesn't keep getting unread updates pumped into state they
	// can't see. It'll re-subscribe when they go back to the lobby.
	useEffect(() => {
		if (room) {
			loungeWantedRef.current = false;
			setLoungeSubscribed(false);
			setLoungeRooms([]);
		}
	}, [room]);

	const inGame = room && room.snapshot;

	return (
		<div className="app">
			<header className="app-header">
				<div className="brand">
					<span className="brand-mark">流</span>
					<div className="brand-text">
						<div className="brand-title">液态围棋 · Fluid Weiqi</div>
						<div className="brand-sub">Web 版 · 致敬原作者 <a href="https://github.com/WangNianyi2001/Fluid-Weiqi" target="_blank" rel="noreferrer">@WangNianyi2001</a></div>
					</div>
				</div>
				<div className="header-actions">
					<button
						className="theme-toggle"
						onClick={() => setTheme(t => toggleTheme(t))}
						aria-label={theme === "light" ? "切换到深色模式" : "切换到浅色模式"}
						title={theme === "light" ? "切换到深色模式" : "切换到浅色模式"}
					>
						{theme === "light" ? "☾" : "☀"}
					</button>
					<div className={`status status-${status}`}>{statusLabel(status)}</div>
				</div>
			</header>

			<main className="app-main">
				{!inGame ? (
					<Lobby
						connecting={status === "connecting"}
						error={error}
						onCreateOnline={onCreateOnline}
						onJoin={onJoinRoom}
						onCreateAi={onCreateAi}
						onSpectate={onSpectate}
						loungeRooms={loungeRooms}
						loungeSubscribed={loungeSubscribed}
						loungeServerTime={loungeServerTime}
						onTabChange={onLobbyTabChange}
					/>
				) : (
					<Game
						roomCode={room.roomCode}
						myPlayerIndex={room.myPlayerIndex}
						players={room.players}
						snapshot={room.snapshot!}
						matchStarted={room.matchStarted}
						gameConfig={room.gameConfig ?? DEFAULT_GAME_CONFIG}
						rejection={rejection}
						aiThinking={aiThinking}
						captureToast={captureToast}
						onCaptureToastDone={() => setCaptureToast(null)}
						onAction={onAction}
						onLeave={onLeave}
					/>
				)}
			</main>

			<footer className="app-footer">
				<a href="https://github.com/Keith9922/fluid-weiqi-web" target="_blank" rel="noreferrer">Web 版源码</a>
				·
				<a href="https://github.com/WangNianyi2001/Fluid-Weiqi" target="_blank" rel="noreferrer">原项目</a>
			</footer>
		</div>
	);
}

function statusLabel(s: WsClientStatus): string {
	switch (s) {
		case "idle":       return "未连接";
		case "connecting": return "连接中…";
		case "open":       return "已连接";
		case "closed":     return "已断开";
		case "error":      return "连接错误";
	}
}
