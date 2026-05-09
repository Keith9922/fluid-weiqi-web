import { useState } from "react";

export type LobbyProps = {
	connecting: boolean;
	error: string | null;
	onCreateRoom: (name: string) => void;
	onJoinRoom: (code: string, name: string) => void;
};

export function Lobby({ connecting, error, onCreateRoom, onJoinRoom }: LobbyProps) {
	const [name, setName] = useState(() => randomName());
	const [code, setCode] = useState("");

	const trimmedName = name.trim();
	const trimmedCode = code.trim().toUpperCase();
	const canCreate = !connecting && trimmedName.length > 0;
	const canJoin = canCreate && trimmedCode.length === 6;

	return (
		<div className="lobby">
			<div>
				<h2>Fluid Weiqi</h2>
				<p>
					连续影响场版围棋。原作者{" "}
					<a href="https://github.com/WangNianyi2001/Fluid-Weiqi" target="_blank" rel="noreferrer">
						@WangNianyi2001
					</a>
					。
				</p>
			</div>

			<div className="field">
				<label htmlFor="name">你的名字</label>
				<input
					id="name"
					value={name}
					onChange={e => setName(e.target.value)}
					maxLength={16}
					placeholder="P1"
				/>
			</div>

			<button
				className="btn"
				disabled={!canCreate}
				onClick={() => onCreateRoom(trimmedName || "P1")}
			>
				创建房间
			</button>

			<div className="row">
				<input
					value={code}
					onChange={e => setCode(e.target.value.toUpperCase().slice(0, 6))}
					placeholder="6 位房间码"
					style={{ letterSpacing: "0.15em", textAlign: "center", textTransform: "uppercase" }}
				/>
				<button
					className="btn secondary"
					disabled={!canJoin}
					onClick={() => onJoinRoom(trimmedCode, trimmedName || "P?")}
				>
					加入
				</button>
			</div>

			{error && <div className="error">{error}</div>}

			<p className="shrug">
				想本地双人对战？创建房间后开第二个标签页用同一个房间码加入。
			</p>
		</div>
	);
}

const ADJ = ["快", "慢", "野", "稳", "巧", "锐", "怒", "笑", "醒", "醉"];
const NOUN = ["手", "客", "客", "棋手", "君", "侠", "童", "翁", "生"];
function randomName(): string {
	const a = ADJ[Math.floor(Math.random() * ADJ.length)] ?? "";
	const n = NOUN[Math.floor(Math.random() * NOUN.length)] ?? "";
	return a + n;
}
