/**
 * WorldTransition Component
 * 
 * React Three Fiber implementation of the Voxel Wave Resolve effect.
 * Renders a particle system that spawns radially from center,
 * revealing the world texture with spring physics animation.
 */

import { useRef, useMemo, useEffect, useState, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import * as THREE from 'three';
import { useTimeline } from './timeline';
import type { WorldTransitionProps } from './types';

// Import shaders as raw strings
import vertexShader from './shaders/vertex.glsl?raw';
import fragmentShader from './shaders/fragment.glsl?raw';

/**
 * VoxelParticles - The core particle system
 */
interface VoxelParticlesProps {
  textureUrl: string;
  duration: number;
  fadeOutDuration: number;
  gridSize: number;
  onComplete?: () => void;
  onFadeUpdate?: (fadeOut: number) => void;
  onReady?: () => void;
}

function VoxelParticles({
  textureUrl,
  duration,
  fadeOutDuration,
  gridSize,
  onComplete,
  onFadeUpdate,
  onReady,
}: VoxelParticlesProps) {
  const { size } = useThree();
  const pointsRef = useRef<THREE.Points>(null);
  const readyCalledRef = useRef(false);
  
  // Load world texture
  const texture = useTexture(textureUrl);
  
  // Fire onReady callback once texture is loaded (only once)
  useEffect(() => {
    if (texture && !readyCalledRef.current) {
      readyCalledRef.current = true;
      onReady?.();
    }
  }, [texture, onReady]);
  
  // Create particle geometry with grid positions
  const geometry = useMemo(() => {
    const count = gridSize * gridSize;
    const geo = new THREE.BufferGeometry();
    
    const positions = new Float32Array(count * 3);
    const indices = new Float32Array(count);
    const gridPositions = new Float32Array(count * 2);
    
    let idx = 0;
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const i = y * gridSize + x;
        
        // Normalized grid position (0-1)
        const gx = x / (gridSize - 1);
        const gy = y / (gridSize - 1);
        
        // Position (calculated in shader)
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
    
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aIndex', new THREE.BufferAttribute(indices, 1));
    geo.setAttribute('aGridPos', new THREE.BufferAttribute(gridPositions, 2));
    
    return geo;
  }, [gridSize]);
  
  // Create uniforms
  const uniforms = useMemo(
    () => ({
      uProgress: { value: 0 },
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(size.width, size.height) },
      uTexture: { value: texture },
      uFadeOut: { value: 0 },
    }),
    [texture, size.width, size.height]
  );
  
  // Create shader material
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms,
        transparent: true,
        depthTest: false,
        blending: THREE.NormalBlending,
      }),
    [uniforms]
  );
  
  // Setup GSAP timeline
  const { start, getState } = useTimeline({
    duration: duration / 1000, // Convert to seconds for GSAP
    fadeOutDuration: fadeOutDuration / 1000,
    onComplete,
  });
  
  // Start animation on mount
  useEffect(() => {
    start();
  }, [start]);
  
  // Update resolution on resize
  useEffect(() => {
    uniforms.uResolution.value.set(size.width, size.height);
  }, [size.width, size.height, uniforms]);
  
  // Update uniforms each frame
  useFrame((_, delta) => {
    const state = getState();
    
    uniforms.uProgress.value = state.progress;
    uniforms.uFadeOut.value = state.fadeOut;
    uniforms.uTime.value += delta;
    
    // Report fade progress to parent for container background fade
    onFadeUpdate?.(state.fadeOut);
  });
  
  return (
    <points ref={pointsRef} geometry={geometry} material={material} />
  );
}

/**
 * WorldTransition - Main component with Canvas wrapper
 */
export function WorldTransition({
  textureUrl,
  duration = 4500,
  fadeOutDuration = 1200,
  gridSize = 150,
  onReady,
  onComplete,
}: WorldTransitionProps) {
  const [bgOpacity, setBgOpacity] = useState(1);
  
  // Callback to update background opacity as particles fade
  const handleFadeUpdate = useCallback((fadeOut: number) => {
    // fadeOut goes 0->1, so opacity should go 1->0
    setBgOpacity(1 - fadeOut);
  }, []);
  
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 2100,
        pointerEvents: 'none',
        background: `rgba(0, 0, 0, ${bgOpacity})`,
      }}
    >
      <Canvas
        orthographic
        camera={{ zoom: 1, position: [0, 0, 1], near: 0.1, far: 10 }}
        gl={{ alpha: true, antialias: true }}
        dpr={Math.min(window.devicePixelRatio, 2)}
        style={{ background: 'transparent' }}
      >
        <VoxelParticles
          textureUrl={textureUrl}
          duration={duration}
          fadeOutDuration={fadeOutDuration}
          gridSize={gridSize}
          onReady={onReady}
          onComplete={onComplete}
          onFadeUpdate={handleFadeUpdate}
        />
      </Canvas>
    </div>
  );
}

export default WorldTransition;
