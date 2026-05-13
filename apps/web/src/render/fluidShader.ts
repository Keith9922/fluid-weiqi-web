// WebGL2 fluid renderer for the influence field — "blob" rendering.
//
// This is the visual model used by the original Fluid Weiqi:
//
//   - Stones do not have separate 3D graphics. The visible piece IS the
//     influence field's level set.
//   - Where total influence > 1 and a player dominates, the pixel is that
//     player's solid color (pure black / pure white).
//   - Where total influence < 1, the pixel is the wood background.
//   - At the level-set edge, a small smoothstep gives anti-aliasing.
//   - Where two players' influences are close to equal, a sharp split
//     between black and white emerges (the contact line between groups).
//
// Liquid feel comes from:
//   - Multiple stones' influences SUM, so blobs naturally merge / coalesce
//     when two same-color stones are placed close.
//   - The level-set boundary is intrinsically curved and irregular.
//   - A subtle time-varying domain warp shifts the boundary slightly so it
//     "breathes" / flows.

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
uniform float u_padRatio;          // CSS padding fraction (0.06 = 6% on each side)
uniform sampler2D u_stones;       // ${MAX_STONES} x 1, RGBA32F: (x, y, strength, owner+1)
uniform int u_stoneCount;

#define POWER_THRESHOLD 4.0
#define BLOB_THRESHOLD 1.0
#define BOUNDARY_SOFTNESS 0.08

float influenceFromStone(vec2 boardPoint, vec2 center, float strength) {
    float r = max(length(boardPoint - center), 0.001);
    float rNorm = 2.0 * r / sqrt(strength);
    float alpha = 1.0 / (1.0 - min(0.99, u_hardness));
    float raw = exp((1.0 - rNorm) * alpha);
    raw = clamp(raw, 0.0, 16.0);
    return POWER_THRESHOLD * tanh(raw / POWER_THRESHOLD);
}

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
float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; ++i) {
        v += a * noise(p);
        p *= 2.0;
        a *= 0.5;
    }
    return v;
}

vec2 liquidWarp(vec2 boardPoint, float t) {
    vec2 q = vec2(
        fbm(boardPoint * 0.5 + vec2(0.0, t * 0.06)),
        fbm(boardPoint * 0.5 + vec2(5.7, t * 0.05))
    );
    return (q - 0.5) * 0.10;
}

void influenceAt(vec2 boardPoint, out float infl0, out float infl1) {
    infl0 = 0.0;
    infl1 = 0.0;
    for (int i = 0; i < ${MAX_STONES}; ++i) {
        if (i >= u_stoneCount) break;
        vec4 s = texelFetch(u_stones, ivec2(i, 0), 0);
        float c = influenceFromStone(boardPoint, s.xy, s.z);
        if (s.w < 1.5) infl0 += c;
        else            infl1 += c;
    }
}

vec3 woodColor(vec2 uv) {
    // Warm pine board, matching the upstream Mac build's look.
    vec3 base   = vec3(0.66, 0.48, 0.28);
    vec3 darker = vec3(0.55, 0.38, 0.20);
    // Long horizontal grain lines + fine speckle.
    float grain = 0.5
        + 0.35 * sin(uv.y * 110.0 + sin(uv.x * 8.0) * 1.6)
        + 0.20 * sin(uv.y * 32.0  + sin(uv.x * 3.0) * 1.2);
    grain = grain * 0.5;
    float speckle = noise(uv * 320.0) * 0.05;
    return mix(darker, base, clamp(grain + speckle, 0.0, 1.0));
}

void main() {
    // The Canvas2D overlay draws stones inside a padded inner area
    // (PADDING_RATIO of the canvas on every side). The fluid blobs MUST
    // align with those stones, so we map the same padded sub-rect of the
    // canvas to the board area, and render plain wood outside it.
    float padR = u_padRatio;
    vec2 playableUv = (v_uv - vec2(padR)) / max(1.0 - 2.0 * padR, 1e-6);

    vec3 wood = woodColor(v_uv);

    if (any(lessThan(playableUv, vec2(0.0))) || any(greaterThan(playableUv, vec2(1.0)))) {
        // Outside the playable area — only the wood frame.
        outColor = vec4(wood, 1.0);
        return;
    }

    float bx = mix(u_minX, u_maxX, playableUv.x);
    float by = mix(u_minY, u_maxY, playableUv.y);
    vec2 boardPoint = vec2(bx, by);

    // Tiny domain warp -> blob edges shift like a slow current.
    vec2 sampPoint = boardPoint + liquidWarp(boardPoint, u_time);

    float infl0, infl1;
    influenceAt(sampPoint, infl0, infl1);
    float total = infl0 + infl1;

    // Outside the level set: pure wood.
    if (total < BLOB_THRESHOLD - BOUNDARY_SOFTNESS) {
        outColor = vec4(wood, 1.0);
        return;
    }

    // Outer edge anti-alias: smoothstep across (1 - softness, 1 + softness).
    float blobAlpha = smoothstep(
        BLOB_THRESHOLD - BOUNDARY_SOFTNESS,
        BLOB_THRESHOLD + BOUNDARY_SOFTNESS,
        total
    );

    // Player split — sharp transition where the two influences are equal.
    // Below 0.5 share, white dominates; above, black dominates.
    float share0 = infl0 / max(total, 1e-6);
    float toBlack = smoothstep(0.45, 0.55, share0);

    vec3 black = vec3(0.04, 0.04, 0.05);
    vec3 white = vec3(0.96, 0.94, 0.90);
    vec3 blobColor = mix(white, black, toBlack);

    // Ink-like rim shading: just inside the boundary, a thin band that's
    // slightly different (a little darker for white, a little lighter for
    // black) — produces the "drop on paper" look.
    float rimBand = smoothstep(0.0, 0.18, blobAlpha) * (1.0 - smoothstep(0.18, 0.50, blobAlpha));
    vec3 rimDelta = mix(vec3(0.10, 0.10, 0.12), vec3(-0.06, -0.06, -0.05), toBlack);
    blobColor += rimDelta * rimBand * 0.55;

    outColor = vec4(mix(wood, blobColor, blobAlpha), 1.0);
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
			padRatio: gl.getUniformLocation(this.program, "u_padRatio"),
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

	render(
		board: BoardSnapshot,
		padRatio: number = 0,
		previewStone?: { x: number; y: number; strength: number; playerIndex: number } | null,
	): void {
		const gl = this.gl;
		gl.useProgram(this.program);
		gl.bindVertexArray(this.vao);

		const data = new Float32Array(MAX_STONES * 4);
		let count = Math.min(MAX_STONES, board.stones.length);
		for (let i = 0; i < count; ++i) {
			const s = board.stones[i]!;
			data[i * 4 + 0] = s.position.x;
			data[i * 4 + 1] = s.position.y;
			data[i * 4 + 2] = s.strength;
			data[i * 4 + 3] = s.playerIndex + 1;
		}
		// Append the hover preview as if it were a real stone. The level set
		// recomputes immediately, so the user can see merge/contest effects
		// before clicking.
		if (previewStone && count < MAX_STONES) {
			data[count * 4 + 0] = previewStone.x;
			data[count * 4 + 1] = previewStone.y;
			data[count * 4 + 2] = previewStone.strength;
			data[count * 4 + 3] = previewStone.playerIndex + 1;
			count++;
		}
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.stoneTex);
		gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, MAX_STONES, 1, gl.RGBA, gl.FLOAT, data);

		gl.uniform1f(this.uniforms.time!, (performance.now() - this.startTime) / 1000);
		gl.uniform1f(this.uniforms.hardness!, board.stoneHardness);
		gl.uniform1f(this.uniforms.minX!, board.shrinkMargin);
		gl.uniform1f(this.uniforms.minY!, board.shrinkMargin);
		// Playable max coord is size-1-shrinkMargin (intersections at 0..size-1).
		gl.uniform1f(this.uniforms.maxX!, board.size - 1 - board.shrinkMargin);
		gl.uniform1f(this.uniforms.maxY!, board.size - 1 - board.shrinkMargin);
		gl.uniform1f(this.uniforms.padRatio!, padRatio);
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
