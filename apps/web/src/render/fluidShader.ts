// WebGL2 fluid renderer for the influence field.
//
// One full-screen quad. The fragment shader computes the per-pixel influence
// for each player by summing Gaussian-shaped contributions from each stone
// (formula matches packages/core/src/influence.ts and the original
// BoardDistribution.compute), determines the dominant player, and colors
// the pixel with a smooth, time-varying gradient that gives the field a
// "liquid" feel without sacrificing the strict math.
//
// Stones are uploaded as a flat float texture (vec4 = x, y, strength,
// playerIndex) — supports up to MAX_STONES per side without recompiling.

import type { BoardSnapshot } from "@fluid/core";

export const MAX_STONES = 256;

const VERTEX_SHADER = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
    v_uv = (a_pos + 1.0) * 0.5;
    gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

// Color tints — black side gets a deep desaturated indigo for territory,
// white side a warm cream. Background is the wood color of the board.
const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform float u_time;
uniform float u_hardness;
uniform float u_minX;
uniform float u_minY;
uniform float u_maxX;
uniform float u_maxY;
uniform sampler2D u_stones;       // ${MAX_STONES} x 1, RGBA32F: (x, y, strength, owner+1)
uniform int u_stoneCount;

#define POWER_THRESHOLD 4.0

float influenceFromStone(vec2 boardPoint, vec2 center, float strength) {
    float r = max(length(boardPoint - center), 0.001);
    float rNorm = 2.0 * r / sqrt(strength);
    float alpha = 1.0 / (1.0 - min(0.99, u_hardness));
    float raw = exp((1.0 - rNorm) * alpha);
    raw = clamp(raw, 0.0, 16.0);
    return POWER_THRESHOLD * tanh(raw / POWER_THRESHOLD);
}

// Soft 2D noise for the gentle "breathing" feel.
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

void main() {
    // Map UV [0,1] to the playable area in board coordinates.
    float bx = mix(u_minX, u_maxX, v_uv.x);
    float by = mix(u_minY, u_maxY, 1.0 - v_uv.y);  // y-flip so board y goes up
    vec2 boardPoint = vec2(bx, by);

    // Sum contributions per player (2 players for MVP).
    float infl0 = 0.0;
    float infl1 = 0.0;
    for (int i = 0; i < ${MAX_STONES}; ++i) {
        if (i >= u_stoneCount) break;
        vec4 s = texelFetch(u_stones, ivec2(i, 0), 0);
        float c = influenceFromStone(boardPoint, s.xy, s.z);
        if (s.w < 1.5) {  // owner+1 = 1 -> player 0
            infl0 += c;
        } else {           // owner+1 = 2 -> player 1
            infl1 += c;
        }
    }

    float total = infl0 + infl1;

    // Wood base color of the board.
    vec3 wood     = vec3(0.235, 0.184, 0.137);   // deep walnut
    vec3 woodLite = vec3(0.286, 0.224, 0.169);   // a touch lighter
    // Subtle wood-grain noise.
    float grain = noise(v_uv * 60.0) * 0.04 + noise(v_uv * 8.0) * 0.06;
    vec3 baseColor = mix(wood, woodLite, grain);

    if (total < 0.001) {
        outColor = vec4(baseColor, 1.0);
        return;
    }

    // Player tints — subtle so stones stay visually dominant.
    vec3 blackTint = vec3(0.10, 0.10, 0.18);  // cool indigo for black's territory
    vec3 whiteTint = vec3(0.86, 0.78, 0.62);  // warm cream for white's territory

    float share0 = infl0 / max(total, 1e-6);
    float share1 = infl1 / max(total, 1e-6);
    float dominance = abs(share0 - share1);

    // Liquid breathing: time-varying noise modulates the apparent strength.
    float breathe = 0.85 + 0.15 * noise(v_uv * 4.0 + vec2(u_time * 0.13, u_time * 0.09));

    // Saturation grows with both total influence (stronger near stones) and
    // dominance margin (deeper at clear territory, faded at the front line).
    float satTotal = 1.0 - exp(-total * 0.6);
    float saturation = clamp(satTotal * (0.35 + 0.65 * dominance) * breathe, 0.0, 0.95);

    vec3 territoryColor = mix(blackTint, whiteTint, share1);
    vec3 finalColor = mix(baseColor, territoryColor, saturation);

    // Light glow ring near stones — exaggerates the dominance ramp at high
    // influence but tapers off in mid-board.
    float glow = smoothstep(1.5, 4.0, total) * 0.18 * dominance;
    finalColor += vec3(glow * (1.0 - share0 * 0.4), glow, glow * (1.0 - share1 * 0.4));

    outColor = vec4(finalColor, 1.0);
}
`;

export class FluidRenderer {
	private gl: WebGL2RenderingContext;
	private program: WebGLProgram;
	private vao: WebGLVertexArrayObject;
	private stoneTex: WebGLTexture;
	private uniforms: Record<string, WebGLUniformLocation | null>;
	private startTime: number;

	constructor(canvas: HTMLCanvasElement) {
		const gl = canvas.getContext("webgl2", { antialias: true, alpha: false });
		if (!gl) throw new Error("WebGL2 not supported");
		this.gl = gl;

		// Required for texelFetch on RGBA32F.
		if (!gl.getExtension("EXT_color_buffer_float")) {
			console.warn("EXT_color_buffer_float not available; field rendering may fail.");
		}

		this.program = link(gl, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER), compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));

		const vao = gl.createVertexArray();
		if (!vao) throw new Error("createVertexArray failed");
		this.vao = vao;
		gl.bindVertexArray(vao);

		const buf = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, buf);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
		const aPos = gl.getAttribLocation(this.program, "a_pos");
		gl.enableVertexAttribArray(aPos);
		gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

		const tex = gl.createTexture();
		if (!tex) throw new Error("createTexture failed");
		this.stoneTex = tex;
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, MAX_STONES, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array(MAX_STONES * 4));
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

		this.uniforms = {
			time: gl.getUniformLocation(this.program, "u_time"),
			hardness: gl.getUniformLocation(this.program, "u_hardness"),
			minX: gl.getUniformLocation(this.program, "u_minX"),
			minY: gl.getUniformLocation(this.program, "u_minY"),
			maxX: gl.getUniformLocation(this.program, "u_maxX"),
			maxY: gl.getUniformLocation(this.program, "u_maxY"),
			stones: gl.getUniformLocation(this.program, "u_stones"),
			stoneCount: gl.getUniformLocation(this.program, "u_stoneCount"),
		};

		this.startTime = performance.now();
	}

	resize(pxWidth: number, pxHeight: number, dpr: number): void {
		const gl = this.gl;
		gl.canvas.width = Math.round(pxWidth * dpr);
		gl.canvas.height = Math.round(pxHeight * dpr);
		(gl.canvas as HTMLCanvasElement).style.width = `${pxWidth}px`;
		(gl.canvas as HTMLCanvasElement).style.height = `${pxHeight}px`;
		gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
	}

	render(board: BoardSnapshot): void {
		const gl = this.gl;
		gl.useProgram(this.program);
		gl.bindVertexArray(this.vao);

		// Upload stones into the texture.
		const data = new Float32Array(MAX_STONES * 4);
		const count = Math.min(MAX_STONES, board.stones.length);
		for (let i = 0; i < count; ++i) {
			const s = board.stones[i]!;
			data[i * 4 + 0] = s.position.x;
			data[i * 4 + 1] = s.position.y;
			data[i * 4 + 2] = s.strength;
			data[i * 4 + 3] = s.playerIndex + 1;
		}
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.stoneTex);
		gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, MAX_STONES, 1, gl.RGBA, gl.FLOAT, data);

		gl.uniform1f(this.uniforms.time!, (performance.now() - this.startTime) / 1000);
		gl.uniform1f(this.uniforms.hardness!, board.stoneHardness);
		gl.uniform1f(this.uniforms.minX!, board.shrinkMargin);
		gl.uniform1f(this.uniforms.minY!, board.shrinkMargin);
		gl.uniform1f(this.uniforms.maxX!, board.size - board.shrinkMargin);
		gl.uniform1f(this.uniforms.maxY!, board.size - board.shrinkMargin);
		gl.uniform1i(this.uniforms.stoneCount!, count);
		gl.uniform1i(this.uniforms.stones!, 0);

		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
	}

	dispose(): void {
		const gl = this.gl;
		gl.deleteTexture(this.stoneTex);
		gl.deleteVertexArray(this.vao);
		gl.deleteProgram(this.program);
	}
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
	const sh = gl.createShader(type);
	if (!sh) throw new Error("createShader failed");
	gl.shaderSource(sh, src);
	gl.compileShader(sh);
	if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
		const log = gl.getShaderInfoLog(sh);
		gl.deleteShader(sh);
		throw new Error(`shader compile error: ${log}\n${src}`);
	}
	return sh;
}

function link(gl: WebGL2RenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram {
	const p = gl.createProgram();
	if (!p) throw new Error("createProgram failed");
	gl.attachShader(p, vs);
	gl.attachShader(p, fs);
	gl.linkProgram(p);
	if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
		const log = gl.getProgramInfoLog(p);
		throw new Error(`program link error: ${log}`);
	}
	return p;
}
