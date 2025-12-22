/**
 * World Transition Types
 * TypeScript interfaces for the Voxel Wave Resolve animation system
 */

export interface WorldTransitionProps {
  /** URL to the equirectangular texture (world image) */
  textureUrl: string;
  /** Main animation duration in milliseconds */
  duration?: number;
  /** Fade out duration in milliseconds */
  fadeOutDuration?: number;
  /** Grid size for particle system (gridSize x gridSize particles) */
  gridSize?: number;
  /** Callback when transition is ready to display (texture loaded, first frame) */
  onReady?: () => void;
  /** Callback when transition completes */
  onComplete?: () => void;
}

export interface TransitionOverlayProps {
  /** Whether the transition is currently active */
  active: boolean;
  /** Callback when transition completes */
  onComplete?: () => void;
}

export interface TransitionUniforms {
  uProgress: { value: number };
  uTime: { value: number };
  uResolution: { value: [number, number] };
  uTexture: { value: THREE.Texture | null };
  uFadeOut: { value: number };
}

export interface AnimationState {
  progress: number;
  fadeOut: number;
  time: number;
  isComplete: boolean;
}

// Re-export THREE types we need
import type * as THREE from 'three';
export type { THREE };
