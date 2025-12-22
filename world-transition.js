/**
 * World Transition - Voxel Wave Resolve Effect
 *
 * A Three.js + GLSL shader effect that transitions from a blank screen
 * to the metaverse environment via a radial particle spawn animation.
 */

// Vertex Shader
const vertexShader = `
  uniform float uProgress;
  uniform float uTime;
  uniform vec2 uResolution;
  
  attribute float aIndex;
  attribute vec2 aGridPos;
  
  varying vec2 vUv;
  varying float vAlpha;
  varying float vScale;
  
  // Simple noise function
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
  
  // Spring overshoot function for elastic pop-in
  float springScale(float t) {
    if (t <= 0.0) return 0.0;
    if (t >= 1.0) return 1.0;
    
    float overshoot = 1.7;
    float decay = 4.0;
    float spring = 1.0 + overshoot * exp(-decay * t) * sin(t * 12.0);
    return t * spring;
  }
  
  void main() {
    // Grid UV (0-1 range)
    vUv = aGridPos;
    
    // Calculate distance from center for wave propagation
    vec2 centerOffset = aGridPos - vec2(0.5);
    float dist = length(centerOffset);
    
    // Wave propagation - particles activate when wave reaches them
    float waveRadius = uProgress * 1.8;  // Wave expands beyond 1.0 to cover corners
    float waveWidth = 0.25;
    
    // Local progress: how "activated" this particle is (0 = not yet, 1 = fully)
    float localProgress = smoothstep(dist + waveWidth, dist, waveRadius);
    
    // Scale with spring physics
    vScale = springScale(localProgress);
    
    // Alpha follows scale
    vAlpha = smoothstep(0.0, 0.3, localProgress);
    
    // Base position in NDC (-1 to 1)
    vec2 basePos = (aGridPos - 0.5) * 2.0;
    
    // Apply aspect ratio correction
    float aspect = uResolution.x / uResolution.y;
    basePos.x *= aspect;
    
    // Y-axis noise displacement (settling dust effect)
    float noiseVal = noise(aGridPos * 8.0 + uTime * 0.5);
    float settleProgress = smoothstep(0.2, 0.9, localProgress);
    float yDisplacement = noiseVal * 0.15 * (1.0 - settleProgress);
    
    // Add slight random offset for organic feel
    float randomOffset = hash(aGridPos * 100.0);
    yDisplacement += randomOffset * 0.02 * (1.0 - settleProgress);
    
    vec3 pos = vec3(basePos.x, basePos.y + yDisplacement, 0.0);
    
    // Point size based on scale and resolution
    float baseSize = min(uResolution.x, uResolution.y) / 55.0;
    gl_PointSize = baseSize * vScale;
    
    gl_Position = vec4(pos, 1.0);
  }
`;

// Fragment Shader
const fragmentShader = `
  precision highp float;
  
  uniform sampler2D uTexture;
  uniform float uProgress;
  uniform float uFadeOut;
  
  varying vec2 vUv;
  varying float vAlpha;
  varying float vScale;
  
  void main() {
    // Circular particle mask
    vec2 center = gl_PointCoord - vec2(0.5);
    float dist = length(center);
    
    // Soft circle with anti-aliased edge
    float circle = 1.0 - smoothstep(0.35, 0.5, dist);
    
    if (circle < 0.01) discard;
    
    // Sample texture color at this particle's grid position
    vec4 texColor = texture2D(uTexture, vUv);
    
    // Final alpha combines particle visibility, circle mask, and fade out
    float alpha = vAlpha * circle * (1.0 - uFadeOut);
    
    gl_FragColor = vec4(texColor.rgb, alpha);
  }
`;

/**
 * WorldTransition Class
 * Manages the complete voxel wave resolve animation
 */
export class WorldTransition {
  constructor(options = {}) {
    this.container = options.container || document.body;
    this.textureUrl = options.textureUrl || "nslab-world.png";
    this.duration = options.duration || 2500; // ms
    this.fadeOutDuration = options.fadeOutDuration || 600; // ms
    this.gridSize = options.gridSize || 110; // 110x110 = 12,100 particles
    this.onComplete = options.onComplete || (() => {});

    this.canvas = null;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.points = null;
    this.uniforms = null;
    this.animationId = null;
    this.startTime = null;
    this.isRunning = false;
  }

  async init() {
    // Create canvas
    this.canvas = document.createElement("canvas");
    this.canvas.id = "transition-canvas";
    this.canvas.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      z-index: 2100;
      pointer-events: none;
    `;
    this.container.appendChild(this.canvas);

    // Initialize Three.js
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    this.camera.position.z = 1;

    // Load texture
    const texture = await this.loadTexture(this.textureUrl);

    // Create particle system
    this.createParticles(texture);

    // Handle resize
    this.handleResize = this.handleResize.bind(this);
    window.addEventListener("resize", this.handleResize);

    return this;
  }

  loadTexture(url) {
    return new Promise((resolve, reject) => {
      const loader = new THREE.TextureLoader();
      loader.load(
        url,
        (texture) => {
          texture.minFilter = THREE.LinearFilter;
          texture.magFilter = THREE.LinearFilter;
          resolve(texture);
        },
        undefined,
        reject
      );
    });
  }

  createParticles(texture) {
    const count = this.gridSize * this.gridSize;

    // Geometry
    const geometry = new THREE.BufferGeometry();

    const positions = new Float32Array(count * 3);
    const indices = new Float32Array(count);
    const gridPositions = new Float32Array(count * 2);

    let idx = 0;
    for (let y = 0; y < this.gridSize; y++) {
      for (let x = 0; x < this.gridSize; x++) {
        const i = y * this.gridSize + x;

        // Normalized grid position (0-1)
        const gx = x / (this.gridSize - 1);
        const gy = y / (this.gridSize - 1);

        // Position (will be calculated in shader)
        positions[idx * 3] = 0;
        positions[idx * 3 + 1] = 0;
        positions[idx * 3 + 2] = 0;

        // Index
        indices[idx] = i;

        // Grid position for UV sampling (flip Y for texture coords)
        gridPositions[idx * 2] = gx;
        gridPositions[idx * 2 + 1] = 1.0 - gy;

        idx++;
      }
    }

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aIndex", new THREE.BufferAttribute(indices, 1));
    geometry.setAttribute(
      "aGridPos",
      new THREE.BufferAttribute(gridPositions, 2)
    );

    // Uniforms
    this.uniforms = {
      uProgress: { value: 0 },
      uTime: { value: 0 },
      uResolution: {
        value: new THREE.Vector2(window.innerWidth, window.innerHeight),
      },
      uTexture: { value: texture },
      uFadeOut: { value: 0 },
    };

    // Material
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: this.uniforms,
      transparent: true,
      depthTest: false,
      blending: THREE.NormalBlending,
    });

    // Points
    this.points = new THREE.Points(geometry, material);
    this.scene.add(this.points);
  }

  handleResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.renderer.setSize(width, height);
    this.uniforms.uResolution.value.set(width, height);
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.startTime = performance.now();
    this.animate();
  }

  animate() {
    if (!this.isRunning) return;

    const elapsed = performance.now() - this.startTime;
    const totalDuration = this.duration + this.fadeOutDuration;

    // Update time uniform
    this.uniforms.uTime.value = elapsed / 1000;

    // Main animation progress
    const mainProgress = Math.min(elapsed / this.duration, 1);
    this.uniforms.uProgress.value = this.easeOutExpo(mainProgress);

    // Fade out phase
    if (elapsed > this.duration) {
      const fadeElapsed = elapsed - this.duration;
      const fadeProgress = Math.min(fadeElapsed / this.fadeOutDuration, 1);
      this.uniforms.uFadeOut.value = this.easeInQuad(fadeProgress);
    }

    // Render
    this.renderer.render(this.scene, this.camera);

    // Check completion
    if (elapsed >= totalDuration) {
      this.complete();
      return;
    }

    this.animationId = requestAnimationFrame(() => this.animate());
  }

  easeOutExpo(t) {
    return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
  }

  easeInQuad(t) {
    return t * t;
  }

  complete() {
    this.isRunning = false;

    // Cleanup
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }

    window.removeEventListener("resize", this.handleResize);

    // Remove canvas
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }

    // Dispose Three.js resources
    if (this.points) {
      this.points.geometry.dispose();
      this.points.material.dispose();
    }
    if (this.uniforms.uTexture.value) {
      this.uniforms.uTexture.value.dispose();
    }
    if (this.renderer) {
      this.renderer.dispose();
    }

    this.onComplete();
  }

  destroy() {
    this.isRunning = false;
    this.complete();
  }
}
