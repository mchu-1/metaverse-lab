/**
 * Fragment Shader - Voxel Wave Resolve
 * 
 * Renders circular particles with texture-sampled colors.
 * Supports fade-out phase for smooth transition to world.
 */

precision highp float;

uniform sampler2D uTexture;
uniform float uProgress;
uniform float uFadeOut;

varying vec2 vUv;
varying float vAlpha;
varying float vScale;

void main() {
  // Calculate distance from point center for circular mask
  vec2 center = gl_PointCoord - vec2(0.5);
  float dist = length(center);
  
  // Soft circle with anti-aliased edge
  // Creates smooth, not pixelated, particle boundaries
  float circle = 1.0 - smoothstep(0.35, 0.5, dist);
  
  // Discard fully transparent pixels for performance
  if (circle < 0.01) discard;
  
  // Sample texture color at this particle's grid position
  vec4 texColor = texture2D(uTexture, vUv);
  
  // Final alpha combines:
  // - vAlpha: particle visibility (from wave spawn)
  // - circle: circular mask shape
  // - uFadeOut: dissolve control (1 = fully faded)
  float alpha = vAlpha * circle * (1.0 - uFadeOut);
  
  gl_FragColor = vec4(texColor.rgb, alpha);
}
