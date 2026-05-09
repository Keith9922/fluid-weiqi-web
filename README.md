# Fluid Weiqi (Web Edition) · 液态围棋网页版

A web port of [Fluid Weiqi (液态围棋)](https://github.com/WangNianyi2001/Fluid-Weiqi) — a Go variant played on a continuous influence field instead of discrete stones.

> Original game by **王念一 (Nianyi Wang)** — [@WangNianyi2001](https://github.com/WangNianyi2001).
> This is a community web port done with the original author's permission. All game rules, naming, and visual concepts belong to the original author.

## What's in this repo

A pnpm monorepo with three packages:

```
fluid-weiqi-web/
├── packages/
│   └── core/          Pure-TS game logic (board, influence field, capture, match flow, WS protocol)
├── apps/
│   ├── server/        Node + ws relay server (rooms, action validation, broadcast)
│   └── web/           Vite + React + Canvas2D front-end
└── scripts/
    └── smoke-test.mjs  End-to-end WS protocol test
```

The same game-rule code (`@fluid/core`) runs on both the server (authoritative validation) and the client (preview rendering).

## Running locally

Requires Node 22+ and pnpm 10+.

```bash
pnpm install
pnpm dev
```

`pnpm dev` runs the server (`http://localhost:8787`) and the web dev server (`http://localhost:5173` or whichever port is free) in parallel. Open the web URL in your browser. To play 2-player locally, open a second tab and use the same room code.

To run them separately:

```bash
pnpm --filter @fluid/server dev   # backend
pnpm --filter @fluid/web    dev   # frontend
```

To run the protocol smoke test (with the server already running):

```bash
node scripts/smoke-test.mjs
```

## Implemented (MVP)

- ✅ Square board (default 19×19), continuous-position stones
- ✅ Influence-field math ported from the original [`BoardDistribution.compute`](https://github.com/WangNianyi2001/Fluid-Weiqi/blob/master/Assets/Resources/Shaders/BoardDistribution.compute) (CPU sampling + Canvas 2D upscale)
- ✅ Capture detection: connected components on the territory map, liberty check, suicide rejection
- ✅ Turn-based 2-player match with **place** and **pass** actions
- ✅ Two consecutive passes ends the match; winner = most surviving stones
- ✅ WebSocket protocol with room codes, join/leave, action relay
- ✅ Snap-to-grid placement; hold **Shift** for free continuous placement (matches the original)

## Not implemented yet (deliberate cut for MVP)

- ❌ GPU shader-based field rendering (CPU sampling at 96² is fine for turn-based; can swap in WebGL2 later)
- ❌ Spherical board / shrink mode (added in upstream v0.3.0)
- ❌ Lobby browsing UI (rooms are private/code-only for now)
- ❌ AI opponent
- ❌ Sound effects, animations
- ❌ Production deployment (see below for steps)

## Architecture notes

- `@fluid/core` is consumed as TypeScript source by both `apps/web` (via Vite) and `apps/server` (via tsx). No build step needed during dev.
- The server is **authoritative** — every move goes through `Match.apply()` on the server. The client never calls game logic directly to mutate state; it only renders the snapshot the server broadcasts.
- The same `Match.apply()` is exposed on the client via `@fluid/core` if you want to add optimistic UI later.
- State is in-memory per server process. Restarting the server kills all rooms (intentional for MVP simplicity).

## Deploying (later)

This MVP targets local play and is not yet wired to a host. When you're ready:

- **Frontend**: Vercel / Netlify / GitHub Pages will host `apps/web/dist`. Run `pnpm --filter @fluid/web build`.
- **Backend**: any service that runs Node 22+ and supports persistent WebSocket connections — Render, Fly.io, Railway, or a small VPS. Run `tsx src/index.ts` (or build an ESM bundle).
- Set the `PORT` env var on the backend; configure the frontend to point to it (currently the WS URL is `${proto}://${location.host}/ws` and uses Vite's dev proxy — replace with your real backend URL in `wsClient.ts` for production).

## Credits

- **Original game**: [Fluid Weiqi by 王念一](https://github.com/WangNianyi2001/Fluid-Weiqi). All rules, terminology, and game design ideas come from the original. Used with permission.
- **macOS native build**: see [Keith9922/Fluid-Weiqi releases](https://github.com/Keith9922/Fluid-Weiqi/releases).
- **This web port**: Keith9922 ([github.com/Keith9922](https://github.com/Keith9922)).

## License

The web port code in this repository is released under MIT. The game design, rules, and visual concepts remain the property of the original author per the [upstream LICENSE](https://github.com/WangNianyi2001/Fluid-Weiqi/blob/master/LICENSE).

If you fork or extend this port, please keep the credits to the original author intact.
