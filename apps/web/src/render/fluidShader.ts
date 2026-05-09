// WebGL2 fluid renderer for the influence field.
//
// Faithfully ports the alpha-curve from the original
// Assets/Resources/Shaders/BoardDisplay.shader (lines 104-126):
//
//   t = totalDensity - 1            // shift by 1 -> below 1 is invisible
//   if t < 0: alpha = 0
//   t = exp(t)
//   alpha_raw = (t - 1) / (t + 1)   // tanh-like normalization to [0, 1)
//   alpha = mix(MIN_ALPHA, 1, alpha_raw ^ ALPHA_CURVE)
//   alpha = alpha ^ mix(1, 8, luminance)  // black territory needs higher
//                                            alpha to stay visible
//
// On top of that we add the liquid feel that's missing in static screenshots:
//   - Subtle domain-warping noise (Perlin-ish, octaves) shifts the sample
//     point slightly over time. The displacement is tiny (~0.04 grid cells)
//     but it makes the boundary breathe instead of sitting still.
//   - Boundary rim highlight: a smoothstep ring around the territory edge
//     gives the field a glassy, surface-tension-like feel.
//   - Inner sheen: brighter spots inside high-density territory imply depth.

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
uniform sampler2D u_stones;       // ${MAX_STONES} x 1, RGBA32F: (x, y, strength, owner+1)
uniform int u_stoneCount;

#define POWER_THRESHOLD 4.0
#define MIN_ALPHA 0.5
#define ALPHA_CURVE 1.0

// Per-stone Gaussian-ish contribution. Matches BoardDistribution.compute
// PowerContribution() exactly.
float influenceFromStone(vec2 boardPoint, vec2 center, float strength) {
    float r = max(length(boardPoint - center), 0.001);
    float rNorm = 2.0 * r / sqrt(strength);
    float alpha = 1.0 / (1.0 - min(0.99, u_hardness));
    float raw = exp((1.0 - rNorm) * alpha);
    raw = clamp(raw, 0.0, 16.0);
    return POWER_THRESHOLD * tanh(raw / POWER_THRESHOLD);
}

// Cheap value-noise.
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

// Domain warp — slow, organic motion at the boundary.
vec2 liquidWarp(vec2 boardPoint, float t) {
    vec2 q = vec2(
        fbm(boardPoint * 0.45 + vec2(0.0, t * 0.08)),
        fbm(boardPoint * 0.45 + vec2(5.7, t * 0.06))
    );
    vec2 r = vec2(
        fbm(boardPoint * 0.45 + 4.0 * q + vec2(1.7, 9.2)),
        fbm(boardPoint * 0.45 + 4.0 * q + vec2(8.3, 2.8))
    );
    // r is in [0,1]; remap to [-0.5, 0.5] then scale.
    return (r - 0.5) * 0.18;
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

// Faithful port of BoardDisplay.shader AlphaFromDensity.
float alphaFromDensity(float total) {
    float t = total - 1.0;
    if (t <= 0.0) return 0.0;
    float et = exp(t);
    float raw = (et - 1.0) / (et + 1.0);    // [0, 1)
    return mix(MIN_ALPHA, 1.0, pow(raw, ALPHA_CURVE));
}

void main() {
    // UV -> board coords. In WebGL, v_uv.y = 1 is the TOP of the screen,
    // and Canvas2D draws stones such that board y=max sits at the top of
    // the canvas (boardToPx flips: c.y = pad + (max - p.y)/span*playable).
    // So top of screen -> max board y; no extra flip needed in v_uv.y.
    float bx = mix(u_minX, u_maxX, v_uv.x);
    float by = mix(u_minY, u_maxY, v_uv.y);
    vec2 boardPoint = vec2(bx, by);

    // Liquid warp at the sample position. Tiny offset; shapes the rim only.
    vec2 warp = liquidWarp(boardPoint, u_time);
    vec2 sampPoint = boardPoint + warp;

    float infl0, infl1;
    influenceAt(sampPoint, infl0, infl1);
    float total = infl0 + infl1;

    // Wood base color of the board (matches Unity scene's wood material).
    vec3 wood     = vec3(0.235, 0.184, 0.137);
    vec3 woodLite = vec3(0.286, 0.224, 0.169);
    float grain = noise(v_uv * 80.0) * 0.04 + noise(v_uv * 8.0) * 0.06;
    vec3 baseColor = mix(wood, woodLite, grain);

    // Threshold check — below 1 there is NO territory at all.
    if (total <= 1.0) {
        outColor = vec4(baseColor, 1.0);
        return;
    }

    // Player colors. We use slightly tinted black/white so the field is
    // distinguishable on the wood without going all neon.
    vec3 blackColor = vec3(0.06, 0.06, 0.10);
    vec3 whiteColor = vec3(0.95, 0.92, 0.84);

    float share1 = infl1 / max(total, 1e-6);
    vec3 territoryColor = (infl0 >= infl1) ? blackColor : whiteColor;

    float alpha = alphaFromDensity(total);

    // Black territory needs higher alpha to remain visible on the dark wood
    // (matches the luminance trick in BoardDisplay.shader line 125).
    float lum = dot(territoryColor, vec3(0.299, 0.587, 0.114));
    alpha = pow(alpha, mix(1.0, 8.0, lum));

    // Soft pulse near the boundary — a smoothstep ring around alpha~0.4
    // produces a glassy "surface tension" highlight that subtly moves.
    float rim = smoothstep(0.05, 0.35, alpha) * (1.0 - smoothstep(0.35, 0.85, alpha));
    float pulse = 0.55 + 0.45 * sin(u_time * 0.7 + total * 1.3);
    vec3 rimTint = mix(vec3(0.55, 0.55, 0.7), vec3(0.95, 0.92, 0.78), share1);
    vec3 boundaryGlow = rimTint * rim * pulse * 0.18;

    // Inner sheen — small bright spots inside high-density territory imply
    // depth; uses a slow-moving fbm so it shifts like fluid surface.
    float sheen = fbm(sampPoint * 1.3 + vec2(u_time * 0.04, -u_time * 0.05));
    sheen = smoothstep(0.55, 0.85, sheen) * smoothstep(0.45, 0.85, alpha);
    vec3 sheenTint = mix(vec3(0.30, 0.30, 0.55), vec3(1.0, 0.96, 0.85), share1);

    vec3 finalColor = mix(baseColor, territoryColor, alpha);
    finalColor += boundaryGlow;
    finalColor = mix(finalColor, sheenTint, sheen * 0.35);

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
