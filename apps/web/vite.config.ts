import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// During dev, proxy /ws to the local server so a single-origin URL works.
export default defineConfig({
	plugins: [react()],
	server: {
		port: 5173,
		proxy: {
			"/ws": {
				target: "ws://localhost:8787",
				ws: true,
			},
		},
	},
});
