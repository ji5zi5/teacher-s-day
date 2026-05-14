const canvas = document.getElementById("scene");
const reveal = document.getElementById("reveal");
const completionWave = document.getElementById("completionWave");
const gl = canvas.getContext("webgl", {
  alpha: false,
  antialias: false,
  depth: true,
  preserveDrawingBuffer: true,
  stencil: false,
  powerPreference: "high-performance"
});

if (!gl) {
  document.body.style.background = "#07020d";
  throw new Error("WebGL is not supported");
}

const DPR_LIMIT = 1.35;
const OUTLINE_PETALS = 620;
const FILL_PETALS = 11850;
const AURA_PETALS = 260;
const GREEN_PARTS = 1250;
const PETAL_COUNT = OUTLINE_PETALS + FILL_PETALS + AURA_PETALS + GREEN_PARTS;
const STRIDE_FLOATS = 17;
const MORPH_SECONDS = 8.6;
const HEART_DEPTH_SCALE = 270;
const AUTO_START_DELAY_MS = 1450;
const POINTER_GAIN = 0.0010;
const CLICK_GAIN = 0.014;

let width = 1;
let height = 1;
let pixelRatio = 1;
let startTime = performance.now();
let morphStart = null;
let pointerX = 0;
let pointerY = 0;
let targetPointerX = 0;
let targetPointerY = 0;
let interactionProgress = 0;
let bloomStart = -100;
let bloomX = 0;
let bloomY = 0;
let revealed = false;
let completionWavePlayed = false;

const vertexShaderSource = `
attribute vec3 a_start;
attribute vec3 a_final;
attribute vec3 a_color;
attribute float a_size;
attribute float a_phase;
attribute float a_layer;
attribute float a_delay;
attribute float a_bloom;
attribute float a_angle;
attribute float a_aspect;
attribute float a_kind;

uniform float u_time;
uniform float u_progress;
uniform float u_started;
uniform float u_pixelRatio;
uniform vec2 u_resolution;
uniform vec2 u_pointer;
uniform vec3 u_bloom;

varying vec3 v_color;
varying float v_alpha;
varying float v_layer;
varying float v_angle;
varying float v_aspect;
varying float v_kind;
varying float v_depthCue;
varying float v_finishImpact;

const float FOCAL_LENGTH = 930.0;

mat3 rotateX(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c);
}

mat3 rotateY(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c);
}

mat3 rotateZ(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat3(c, -s, 0.0, s, c, 0.0, 0.0, 0.0, 1.0);
}

void main() {
  float responsive = clamp(min(u_resolution.x, u_resolution.y) / 720.0, 0.53, 1.34);
  float isGreen = step(1.5, a_kind);
  float localProgress = smoothstep(a_delay, min(1.0, a_delay + 0.24), u_progress);
  float greenFade = 1.0;
  if (a_kind > 1.5) {
    float greenFadeFloor = 0.04;
    greenFade = mix(greenFadeFloor, 1.0, 1.0 - smoothstep(0.16, 0.86, u_progress));
    localProgress = 0.0;
  }

  vec3 p = mix(a_start, a_final, localProgress);
  float morphBurst = sin(localProgress * 3.14159265) * u_started;
  p += normalize(vec3(p.xy + vec2(0.001), p.z + 0.001)) * morphBurst * (24.0 + a_bloom * 34.0) * responsive;
  float petalLoose = u_started * (1.0 - localProgress) * (1.0 - isGreen);
  float loose = petalLoose;
  float swirl = loose * (u_time * (0.66 + a_bloom * 0.26) + a_phase);
  p.xz = mat2(cos(swirl), -sin(swirl), sin(swirl), cos(swirl)) * p.xz;
  float flight = sin(localProgress * 3.14159265) * u_started;
  p.x += (sin(u_time * 1.7 + a_phase * 2.1) * 62.0 + cos(a_phase) * 28.0) * flight;
  p.y += (cos(u_time * 1.25 + a_phase) * 44.0 + sin(a_phase * 1.7) * 24.0) * flight;
  p.z += sin(u_time * 1.9 + a_phase * 1.3) * 105.0 * flight;

  float preWiggle = (1.0 - u_started) * sin(u_time * 1.4 + a_phase) * 4.0;
  p.xy += vec2(cos(a_phase), sin(a_phase * 1.3)) * preWiggle;
  float greenSway = isGreen * (0.35 + 0.65 * (1.0 - smoothstep(0.18, 0.82, u_progress)));
  p.xy += vec2(sin(u_time * 0.72 + a_phase) * 3.4, cos(u_time * 0.58 + a_phase * 0.7) * 1.6) * greenSway;

  float finishImpact = smoothstep(0.945, 0.992, u_progress) * (1.0 - smoothstep(0.996, 1.0, u_progress));
  finishImpact *= (1.0 - isGreen);
  float finishSettleDrop = 228.0 * finishImpact;
  float completionSpark = finishImpact * (0.55 + 0.45 * sin(u_time * 42.0 + a_phase * 19.0));
  float breath = 1.0 + sin(u_time * 2.0 + a_phase) * (0.012 + localProgress * 0.022);
  float heartbeat = pow(max(0.0, sin(u_time * 2.7)), 18.0) * 0.090 * smoothstep(0.76, 1.0, u_progress);
  float impactScale = 1.0 + finishImpact * 0.006;
  p *= (breath + heartbeat) * impactScale * responsive;
  p.xy += normalize(p.xy + vec2(0.001)) * finishImpact * 1.2 * responsive;

  float bloomAge = max(0.0, u_time - u_bloom.z);
  float bloomFade = max(0.0, 1.0 - bloomAge * 0.58);
  float bloomRadius = bloomAge * 1.05;
  vec2 normPos = p.xy / (min(u_resolution.x, u_resolution.y) * 0.48);
  float wave = exp(-pow((length(normPos - u_bloom.xy) - bloomRadius) * 4.4, 2.0)) * bloomFade;
  p += normalize(vec3(p.xy + 0.001, p.z * 0.35)) * wave * (70.0 + a_bloom * 56.0) * responsive;

  float lift = mix(70.0, 84.0, smoothstep(420.0, 720.0, u_resolution.y));
  float idleTurn = (1.0 - u_started) * sin(u_time * 0.35) * 0.10;
  float frontLock = smoothstep(0.30, 0.72, u_progress);
  float preLockTurn = (1.0 - frontLock) * (idleTurn + u_pointer.x * 0.08);
  float preHeartTilt = (1.0 - frontLock) * (-0.035 + u_pointer.y * 0.06);
  float finalLock = smoothstep(0.54, 1.0, u_progress);
  float finalOrbit = finalLock * (0.10 * sin(u_time * 0.38) + u_pointer.x * 0.055);
  float finalTilt = finalLock * (-0.08 + 0.025 * sin(u_time * 0.29 + a_phase * 0.02) + u_pointer.y * 0.035);
  p = rotateY(preLockTurn + finalOrbit) * rotateX(preHeartTilt + finalTilt) * p;
  p.xy += vec2(u_pointer.x, -u_pointer.y) * 10.0 * frontLock;

  float perspective = FOCAL_LENGTH / (FOCAL_LENGTH - p.z);
  float finalRaise = 20.0 * smoothstep(540.0, 800.0, u_resolution.y) * smoothstep(0.76, 1.0, u_progress);
  float mobileHeartDrop = 92.0 * smoothstep(1.05, 1.75, u_resolution.y / u_resolution.x) * smoothstep(0.76, 1.0, u_progress);
  vec2 projected = p.xy * perspective + vec2(0.0, lift + finalRaise - finishSettleDrop - mobileHeartDrop);
  vec2 clip = projected / (u_resolution * 0.5);
  float clipDepth = clamp(-p.z / 540.0, -0.82, 0.82);
  gl_Position = vec4(clip, clipDepth, 1.0);

  float depth = clamp(perspective, 0.38, 1.72);
  float shimmer = 0.82 + 0.18 * sin(u_time * 6.4 + a_phase * 11.0);
  float morphSpark = morphBurst * (0.72 + 0.28 * sin(u_time * 14.0 + a_phase * 9.0));
  float carnationCoreBoost = (1.0 - u_started) * (1.0 - smoothstep(0.18, 0.74, length(a_start.xy) / 230.0));
  float carnationLinger = u_started * (1.0 - localProgress) * (1.0 - smoothstep(0.34, 0.88, u_progress));
  float completeGlow = 0.72 + localProgress * 0.96 + wave * 1.45 + morphSpark * 0.58 + carnationCoreBoost * 0.72 + carnationLinger * 0.34;
  float finalHeartGlow = (1.0 - isGreen) * smoothstep(0.68, 1.0, u_progress);
  float finalHeartHotCore = finalHeartGlow * (1.0 - smoothstep(92.0, 226.0, length(a_final.xy)));
  float heartGlowBoost = 1.0 + finalHeartGlow * 0.95 + finalHeartHotCore * 0.55 + finishImpact * 0.72 + completionSpark * 0.32;
  float heartSizeBoost = 1.0 + finalHeartGlow * 0.62 + finalHeartHotCore * 0.32;
  float heartAlphaBoost = 1.0 + finalHeartGlow * 0.82 + finalHeartHotCore * 0.30 + finishImpact * 0.20;
  float bottomCusp = (1.0 - isGreen) * (1.0 - smoothstep(-142.0, -86.0, a_final.y)) * smoothstep(0.72, 1.0, u_progress);
  float bottomCuspSoftener = 1.0 - bottomCusp * 0.68;
  float greenSize = mix(1.0, 0.12, smoothstep(0.16, 0.92, u_progress));
  gl_PointSize = clamp(a_size * responsive * depth * shimmer * completeGlow * greenSize * heartSizeBoost * bottomCuspSoftener * u_pixelRatio, 0.7, 24.0 * u_pixelRatio);

  v_color = a_color * (0.68 + depth * 0.42 + localProgress * 0.72 + wave * 0.50 + morphSpark * 0.36 + carnationCoreBoost * 0.42 + carnationLinger * 0.28) * heartGlowBoost * bottomCuspSoftener;
  float greenTailCut = 1.0 - isGreen * smoothstep(0.72, 1.0, u_progress);
  v_alpha = clamp((0.13 + localProgress * 0.82 + depth * 0.12 + wave * 0.38 + morphSpark * 0.22 + carnationCoreBoost * 0.30 + carnationLinger * 0.30) * greenFade * greenTailCut * heartAlphaBoost * bottomCuspSoftener, 0.0, 1.0);
  if (u_started < 0.5 && a_kind < 1.5) {
    v_alpha = clamp(0.48 + depth * 0.20 + a_layer * 0.18, 0.28, 0.92);
  }
  v_layer = a_layer;
  v_angle = a_angle + sin(u_time * 0.9 + a_phase) * 0.22;
  v_aspect = a_aspect;
  v_kind = a_kind;
  v_depthCue = smoothstep(-210.0, 210.0, p.z);
  v_finishImpact = finishImpact;
}
`;

const fragmentShaderSource = `
precision mediump float;

varying vec3 v_color;
varying float v_alpha;
varying float v_layer;
varying float v_angle;
varying float v_aspect;
varying float v_kind;
varying float v_depthCue;
varying float v_finishImpact;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float c = cos(v_angle);
  float s = sin(v_angle);
  uv = mat2(c, -s, s, c) * uv;

  float width = v_kind > 1.5 ? 0.15 : (0.22 + v_aspect * 0.05);
  float height = v_kind > 1.5 ? 0.50 : (0.48 + v_aspect * 0.08);
  float petal = pow(abs(uv.x) / width, 2.0) + pow((uv.y + 0.02) / height, 2.0);
  if (petal > 1.0) discard;

  float tip = smoothstep(-0.44, 0.42, uv.y);
  float vein = 1.0 - smoothstep(0.0, 0.050, abs(uv.x));
  float edge = smoothstep(1.0, 0.42, petal);
  float center = smoothstep(0.82, 0.0, petal);
  vec3 heartSaturation = mix(vec3(0.92, 0.12, 0.34), vec3(1.0, 0.34, 0.62), v_depthCue);
  float depthLayerPop = 0.82 + abs(v_depthCue - 0.50) * 0.44;
  vec3 petalWarm = mix(v_color * heartSaturation, vec3(1.0, 0.36, 0.58), 0.08 + tip * 0.10 + vein * 0.08);
  vec3 greenWarm = v_color * (vec3(0.70, 1.08, 0.76) + v_depthCue * vec3(0.10, 0.16, 0.08));
  vec3 warm = v_kind > 1.5 ? greenWarm : petalWarm;
  vec3 finishFlash = vec3(1.0, 0.40, 0.68) * v_finishImpact * (0.24 + center * 0.42 + vein * 0.18);
  float alpha = v_alpha * edge * (0.55 + center * 0.45 + v_layer * 0.10);
  float depthShine = (0.86 + v_depthCue * 0.20 + center * 0.08) * depthLayerPop;

  gl_FragColor = vec4((warm + finishFlash) * depthShine * (0.72 + center * 0.48 + vein * 0.10), alpha);
}
`;

function compileShader(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(log || "Shader compile failed");
  }
  return shader;
}

function createProgram() {
  const program = gl.createProgram();
  gl.attachShader(program, compileShader(gl.VERTEX_SHADER, vertexShaderSource));
  gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(log || "Program link failed");
  }
  return program;
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function heartCurve(t) {
  const x = 16 * Math.sin(t) ** 3;
  const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
  return [x, y];
}

function heartImplicit(x, y) {
  const a = x * x + y * y - 1;
  return a * a * a - x * x * y * y * y;
}

function isHeartCleft(x, y) {
  if (y < 0.56) return false;
  const height = Math.min(1, (y - 0.56) / 0.70);
  const halfWidth = 0.045 + height * 0.23;
  const lowerCurve = 0.56 + Math.abs(x) * 1.45;
  return Math.abs(x) < halfWidth && y > lowerCurve;
}

function randomHeartMaskPoint() {
  for (let tries = 0; tries < 120; tries += 1) {
    const x = rand(-1.38, 1.38);
    const y = rand(-1.12, 1.26);
    if (heartImplicit(x, y) <= 0 && !isHeartCleft(x, y)) return [x, y];
  }
  return [0, 0];
}

function heartBottomTuck(y) {
  if (y > -0.76) return y;
  const tuck = Math.min(1, (-0.76 - y) / 0.34);
  return mix(y, -0.76, tuck * 0.56);
}

function layeredHeartTarget() {
  const [x, y] = randomHeartMaskPoint();
  const tuckedY = heartBottomTuck(y);
  const layerSeed = Math.random() * 2 - 1;
  const layerSign = layerSeed < 0 ? -1 : 1;
  const frontBackShell = 0.18 + Math.abs(layerSeed) ** 0.48 * 0.52;
  const surfaceDepthBias = Math.random() < 0.48 ? frontBackShell : Math.abs(layerSeed) ** 0.88;
  const depthLayer = layerSign * surfaceDepthBias;
  const radial = Math.min(1, Math.sqrt((x / 1.38) ** 2 + (tuckedY / 1.26) ** 2));
  const frontFaceSilhouette = 1.0 - radial * 0.22;
  const heartVolumeScale = 1.0 - Math.abs(depthLayer) ** 1.30 * 0.24 * frontFaceSilhouette;
  const depthBulge = 0.62 + (1.0 - radial) * 0.62;
  const bottomDepthDampen = mix(0.34, 1.0, Math.max(0, Math.min(1, (tuckedY + 0.76) / 0.34)));
  const topEmphasis = 1.0 + Math.max(0, tuckedY) * 0.030;
  const depth = (depthLayer * HEART_DEPTH_SCALE * depthBulge + Math.sin(x * 4.1 + tuckedY * 2.3) * 10) * bottomDepthDampen;
  return [
    x * 184 * heartVolumeScale * topEmphasis + rand(-1.5, 1.5),
    tuckedY * 172 * heartVolumeScale + 8 + (1.0 - heartVolumeScale) * 12 + rand(-1.5, 1.5),
    depth
  ];
}

function trueHeartTarget() {
  return layeredHeartTarget();
}

function carnationHead(i, total, radiusMin, radiusMax) {
  const golden = 2.399963229728653;
  const progress = (i + 0.5) / Math.max(1, total);
  const coreBias = Math.random() < 0.34 ? Math.random() * 0.34 : progress;
  const ring = Math.pow(coreBias, 0.58);
  const angle = i * golden + ring * 1.10 + rand(-0.20, 0.20);
  const frill = Math.sin(angle * 9.0 + ring * 12.0) * 9 + Math.sin(angle * 17.0) * 4;
  const baseRadius = mix(radiusMin, radiusMax, ring);
  const radius = baseRadius + frill * (0.20 + ring * 0.68) + rand(-3.8, 3.8);
  const cup = (1.0 - ring) * (1.0 - ring) * 70;
  const crownLift = Math.sin(ring * Math.PI) * 24;
  const petalDome = (0.5 - ring) * 28;
  return [
    Math.cos(angle) * radius,
    Math.sin(angle) * radius * 0.54 + 76 + cup + crownLift + rand(-6, 6),
    Math.sin(angle * 2.1) * 64 + cup * 1.05 + petalDome + rand(-28, 28)
  ];
}

function scatterPoint(finalPoint, spread, i) {
  const angle = rand(0, Math.PI * 2);
  const radius = rand(spread * 0.45, spread);
  const lane = i % 2 === 0 ? 1 : -1;
  return [
    Math.cos(angle) * radius + finalPoint[0] * rand(-0.16, 0.12),
    Math.sin(angle) * radius * 0.72 + finalPoint[1] * rand(-0.18, 0.12),
    rand(-520, 520) + lane * rand(60, 190)
  ];
}

function colorPetal(kind) {
  if (kind === "gold") return [1.0, rand(0.62, 0.84), rand(0.30, 0.48)];
  if (kind === "soft") return [1.0, rand(0.50, 0.68), rand(0.70, 0.88)];
  if (kind === "green") return [rand(0.16, 0.30), rand(0.58, 0.86), rand(0.30, 0.44)];
  return [1.0, rand(0.20, 0.46), rand(0.54, 0.84)];
}

function outlinePetal(i) {
  const t = (i / OUTLINE_PETALS) * Math.PI * 2;
  const [hx, hy] = heartCurve(t);
  const ring = rand(1.005, 1.045);
  const outlineCuspDepthDampen = hy < -10 ? 0.16 : 1.0;
  const finalPoint = [
    hx * 12.2 * ring + rand(-0.9, 0.9),
    hy * 10.8 * ring + 12 + rand(-0.9, 0.9),
    (Math.sin(t * 2.0) * 96 + Math.sin(t * 7.0) * 24 + rand(-18, 18)) * outlineCuspDepthDampen
  ];
  return {
    start: carnationHead(i, OUTLINE_PETALS, 18, 214),
    final: finalPoint,
    color: hy < -10 ? [0.78, rand(0.10, 0.22), rand(0.42, 0.58)] : (Math.random() < 0.20 ? colorPetal("gold") : colorPetal("hot")),
    size: hy < -10 ? rand(3.4, 5.8) : rand(5.4, 9.2),
    phase: t + rand(0, 0.7),
    layer: rand(0.64, 0.84),
    delay: rand(0.02, 0.42),
    bloom: rand(0.65, 1.25),
    angle: t + Math.PI * 0.5,
    aspect: rand(0.25, 0.85),
    kind: 1
  };
}

function fillPetal(i) {
  const finalPoint = trueHeartTarget();
  return {
    start: carnationHead(i, FILL_PETALS, 8, 214),
    final: finalPoint,
    color: Math.random() < 0.08 ? colorPetal("gold") : colorPetal(Math.random() < 0.44 ? "soft" : "hot"),
    size: rand(5.4, 11.8),
    phase: rand(0, Math.PI * 2),
    layer: rand(0.36, 0.86),
    delay: rand(0.12, 0.94),
    bloom: rand(0.25, 0.95),
    angle: rand(0, Math.PI * 2),
    aspect: rand(0.06, 0.58),
    kind: 1
  };
}

function auraPetal(i) {
  const t = (i / AURA_PETALS) * Math.PI * 2;
  const [hx, hy] = heartCurve(t);
  const ring = rand(1.035, 1.095);
  const outlineCuspDepthDampen = hy < -10 ? 0.16 : 1.0;
  const finalPoint = [
    hx * 12.9 * ring,
    hy * 11.4 * ring + 12,
    (Math.sin(t * 2.0) * 112 + Math.sin(t * 5.0) * 20 + rand(-16, 16)) * outlineCuspDepthDampen
  ];
  return {
    start: carnationHead(i, AURA_PETALS, 44, 224),
    final: finalPoint,
    color: hy < -10 ? [0.70, rand(0.12, 0.22), rand(0.42, 0.58)] : (Math.random() < 0.14 ? colorPetal("gold") : colorPetal("soft")),
    size: hy < -10 ? rand(2.2, 4.2) : rand(3.2, 6.4),
    phase: t + rand(0, 0.9),
    layer: rand(0.26, 0.70),
    delay: rand(0.66, 0.92),
    bloom: rand(0.70, 1.40),
    angle: t + Math.PI * 0.5,
    aspect: rand(0.22, 0.80),
    kind: 1
  };
}

function greenPart(i) {
  const stem = i < GREEN_PARTS * 0.50;
  let start;
  let angle;
  if (stem) {
    const y = rand(-250, -28);
    start = [rand(-9, 9) + Math.sin(y * 0.035) * 10, y, rand(-22, 22)];
    angle = Math.PI * 0.02 + rand(-0.25, 0.25);
  } else {
    const side = i % 2 === 0 ? -1 : 1;
    const t = rand(0, 1);
    const y = mix(-210, -76, t);
    const x = side * (34 + t * 88) + Math.sin(t * Math.PI) * side * 22;
    start = [x, y + rand(-10, 10), rand(-28, 28)];
    angle = side * 0.95 + rand(-0.35, 0.35);
  }
  return {
    start,
    final: scatterPoint([0, -220, 0], 760, i),
    color: colorPetal("green"),
    size: stem ? rand(9, 16) : rand(14, 26),
    phase: rand(0, Math.PI * 2),
    layer: rand(0.25, 0.65),
    delay: 0.0,
    bloom: rand(0.2, 0.7),
    angle,
    aspect: stem ? rand(0.0, 0.25) : rand(0.35, 0.95),
    kind: 2
  };
}

function buildData() {
  const data = new Float32Array(PETAL_COUNT * STRIDE_FLOATS);
  for (let i = 0; i < PETAL_COUNT; i += 1) {
    let p;
    if (i < OUTLINE_PETALS) p = outlinePetal(i);
    else if (i < OUTLINE_PETALS + FILL_PETALS) p = fillPetal(i - OUTLINE_PETALS);
    else if (i < OUTLINE_PETALS + FILL_PETALS + AURA_PETALS) p = auraPetal(i - OUTLINE_PETALS - FILL_PETALS);
    else p = greenPart(i - OUTLINE_PETALS - FILL_PETALS - AURA_PETALS);

    const offset = i * STRIDE_FLOATS;
    data.set(p.start, offset);
    data.set(p.final, offset + 3);
    data.set(p.color, offset + 6);
    data[offset + 9] = p.size;
    data[offset + 10] = p.phase;
    data[offset + 11] = p.layer;
    data[offset + 12] = p.delay;
    data[offset + 13] = p.bloom;
    data[offset + 14] = p.angle;
    data[offset + 15] = p.aspect;
    data[offset + 16] = p.kind;
  }
  return data;
}

const program = createProgram();
const buffer = gl.createBuffer();
const vertexData = buildData();
const stride = STRIDE_FLOATS * Float32Array.BYTES_PER_ELEMENT;
const locations = {
  start: gl.getAttribLocation(program, "a_start"),
  final: gl.getAttribLocation(program, "a_final"),
  color: gl.getAttribLocation(program, "a_color"),
  size: gl.getAttribLocation(program, "a_size"),
  phase: gl.getAttribLocation(program, "a_phase"),
  layer: gl.getAttribLocation(program, "a_layer"),
  delay: gl.getAttribLocation(program, "a_delay"),
  bloom: gl.getAttribLocation(program, "a_bloom"),
  angle: gl.getAttribLocation(program, "a_angle"),
  aspect: gl.getAttribLocation(program, "a_aspect"),
  kind: gl.getAttribLocation(program, "a_kind"),
  time: gl.getUniformLocation(program, "u_time"),
  progress: gl.getUniformLocation(program, "u_progress"),
  started: gl.getUniformLocation(program, "u_started"),
  pixelRatio: gl.getUniformLocation(program, "u_pixelRatio"),
  resolution: gl.getUniformLocation(program, "u_resolution"),
  pointer: gl.getUniformLocation(program, "u_pointer"),
  bloomUniform: gl.getUniformLocation(program, "u_bloom")
};

function enableAttribute(location, size, offset) {
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset * Float32Array.BYTES_PER_ELEMENT);
}

gl.useProgram(program);
gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.STATIC_DRAW);
enableAttribute(locations.start, 3, 0);
enableAttribute(locations.final, 3, 3);
enableAttribute(locations.color, 3, 6);
enableAttribute(locations.size, 1, 9);
enableAttribute(locations.phase, 1, 10);
enableAttribute(locations.layer, 1, 11);
enableAttribute(locations.delay, 1, 12);
enableAttribute(locations.bloom, 1, 13);
enableAttribute(locations.angle, 1, 14);
enableAttribute(locations.aspect, 1, 15);
enableAttribute(locations.kind, 1, 16);

gl.disable(gl.DEPTH_TEST);
gl.depthMask(false);
gl.clearDepth(1.0);
gl.enable(gl.BLEND);
gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

function resize() {
  pixelRatio = Math.min(window.devicePixelRatio || 1, DPR_LIMIT);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.max(1, Math.floor(width * pixelRatio));
  canvas.height = Math.max(1, Math.floor(height * pixelRatio));
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  gl.viewport(0, 0, canvas.width, canvas.height);
}

function beginMorph(clientX = width * 0.5, clientY = height * 0.42, gain = CLICK_GAIN) {
  if (morphStart === null) morphStart = performance.now();
  triggerBloom(clientX, clientY, gain);
}

function autoBeginMorph() {
  if (morphStart === null) beginMorph(width * 0.5, height * 0.42, 0);
}

function setPointer(clientX, clientY) {
  targetPointerX = (clientX / width - 0.5) * 2;
  targetPointerY = (clientY / height - 0.5) * 2;
  if (morphStart !== null) interactionProgress = Math.min(0.30, interactionProgress + POINTER_GAIN);
}

function triggerBloom(clientX = width * 0.5, clientY = height * 0.42, gain = CLICK_GAIN) {
  bloomX = (clientX / width - 0.5) * 2;
  bloomY = -((clientY / height - 0.5) * 2);
  bloomStart = (performance.now() - startTime) / 1000;
  if (morphStart !== null) interactionProgress = Math.min(0.36, interactionProgress + gain);
}

function triggerCompletionWave() {
  if (completionWavePlayed || !completionWave) return;
  completionWavePlayed = true;
  completionWave.classList.remove("play");
  void completionWave.offsetWidth;
  completionWave.classList.add("play");
  window.setTimeout(() => completionWave.classList.remove("play"), 2900);
}

function showReveal() {
  if (revealed) return;
  revealed = true;
  triggerBloom(width * 0.5, height * 0.43, 0);
  window.setTimeout(() => reveal.classList.add("show"), 520);
}

function render(now) {
  const time = (now - startTime) / 1000;
  const started = morphStart === null ? 0 : 1;
  const morphElapsed = morphStart === null ? 0 : (now - morphStart) / 1000;
  const automaticProgress = morphStart === null ? 0 : Math.min(1, morphElapsed / MORPH_SECONDS);
  const progress = Math.min(1, automaticProgress + interactionProgress);

  pointerX += (targetPointerX - pointerX) * 0.055;
  pointerY += (targetPointerY - pointerY) * 0.055;

  gl.clearColor(0.010, 0.003, 0.026, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.uniform1f(locations.time, time);
  gl.uniform1f(locations.progress, progress);
  gl.uniform1f(locations.started, started);
  gl.uniform1f(locations.pixelRatio, pixelRatio);
  gl.uniform2f(locations.resolution, width, height);
  gl.uniform2f(locations.pointer, pointerX, pointerY);
  gl.uniform3f(locations.bloomUniform, bloomX, bloomY, bloomStart);
  gl.drawArrays(gl.POINTS, 0, PETAL_COUNT);

  if (progress >= 0.990) triggerCompletionWave();
  if (progress >= 0.995) showReveal();
  requestAnimationFrame(render);
}

window.addEventListener("resize", resize);
window.addEventListener("pointermove", (event) => setPointer(event.clientX, event.clientY));
window.addEventListener("pointerleave", () => {
  targetPointerX = 0;
  targetPointerY = 0;
});
window.addEventListener("click", (event) => beginMorph(event.clientX, event.clientY));
window.addEventListener("touchstart", (event) => {
  const touch = event.touches[0];
  if (touch) beginMorph(touch.clientX, touch.clientY);
}, { passive: true });

resize();
window.setTimeout(autoBeginMorph, AUTO_START_DELAY_MS);
requestAnimationFrame(render);


