/**
 * Vertex Shader - Voxel Wave Resolve
 * 
 * Animation Sequence:
 * 1. POLKA-DOT (0-15%): Particles visible as small dots
 * 2. UNDULATE (15-50%): Circular wave ripples through particles
 * 3. EXPAND (50-100%): Particles grow to full size
 */

uniform float uProgress;
uniform float uTime;
uniform vec2 uResolution;

attribute float aIndex;
attribute vec2 aGridPos;

varying vec2 vUv;
varying float vAlpha;
varying float vScale;

// Simple noise function for organic displacement
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

/**
 * Ease functions
 */
float easeOutCubic(float t) {
  return 1.0 - pow(1.0 - t, 3.0);
}

float easeInOutCubic(float t) {
  return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0;
}

void main() {
  // Grid UV (0-1 range) for texture sampling
  vUv = aGridPos;
  
  // Calculate distance from center for radial wave propagation
  vec2 centerOffset = aGridPos - vec2(0.5);
  float dist = length(centerOffset);
  float maxDist = 0.707; // Distance to corner (sqrt(0.5^2 + 0.5^2))
  
  // ========================================
  // PHASE TIMING
  // ========================================
  float phase1End = 0.15;   // Polka-dot phase ends
  float phase2End = 0.55;   // Undulate phase ends
  // Phase 3 (Expand) runs from 0.55 to 1.0
  
  // ========================================
  // PHASE 1: POLKA-DOT (0% - 15%)
  // Particles appear immediately as small dots
  // ========================================
  float dotSize = 0.25; // Denser initial size (25% of full)
  float phase1Progress = clamp(uProgress / phase1End, 0.0, 1.0);
  float dotAlpha = smoothstep(0.0, 0.3, phase1Progress);
  
  // ========================================
  // PHASE 2: UNDULATE (15% - 55%)
  // Circular wave ripples outward from center
  // ========================================
  float phase2Progress = clamp((uProgress - phase1End) / (phase2End - phase1End), 0.0, 1.0);
  
  // Wave parameters
  float waveSpeed = 2.5;
  float waveLength = 0.3;
  float waveAmplitude = 0.08;
  
  // Calculate wave phase based on distance from center
  // Wave travels outward: particles further from center ripple later
  float wavePhase = dist / waveLength - phase2Progress * waveSpeed;
  float wave = sin(wavePhase * 6.28318) * waveAmplitude;
  
  // Wave intensity: strongest in middle of phase, fades at start and end
  float waveIntensity = sin(phase2Progress * 3.14159) * easeOutCubic(phase2Progress);
  float yWave = wave * waveIntensity;
  
  // ========================================
  // PHASE 3: EXPAND (55% - 100%)
  // Particles grow radially from center to full size
  // ========================================
  float phase3Progress = clamp((uProgress - phase2End) / (1.0 - phase2End), 0.0, 1.0);
  
  // Radial expansion wave
  float expandWaveRadius = phase3Progress * 1.8; // Expand beyond 1.0 to cover corners
  float expandWaveWidth = 0.35;
  
  // Local expansion: how much this particle has expanded (0 = small, 1 = full)
  float localExpand = smoothstep(dist + expandWaveWidth, dist, expandWaveRadius);
  localExpand = easeOutCubic(localExpand);
  
  // ========================================
  // COMBINE ALL PHASES
  // ========================================
  
  // Scale: starts at dotSize, grows to full (1.0) during expand phase
  float targetScale = mix(dotSize, 1.0, localExpand);
  vScale = targetScale;
  
  // Alpha: visible from phase 1
  vAlpha = dotAlpha;
  
  // Position
  vec2 basePos = (aGridPos - 0.5) * 2.0;
  float aspect = uResolution.x / uResolution.y;
  
  if (aspect > 1.0) {
    basePos.y *= aspect;
  } else {
    basePos.x /= aspect;
  }
  
  // Add undulation displacement during phase 2
  float yDisplacement = yWave;
  
  // Add subtle settling noise during expand phase
  float noiseVal = noise(aGridPos * 8.0 + uTime * 0.3);
  float settleNoise = noiseVal * 0.03 * (1.0 - localExpand);
  yDisplacement += settleNoise;
  
  vec3 pos = vec3(basePos.x, basePos.y + yDisplacement, 0.0);
  
  // Point size based on scale and resolution
  float baseSize = min(uResolution.x, uResolution.y) / 100.0;
  gl_PointSize = baseSize * vScale;
  
  gl_Position = vec4(pos, 1.0);
}
