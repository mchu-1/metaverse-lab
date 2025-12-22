/**
 * useTransitionTimeline Hook
 * 
 * GSAP-powered animation timeline for precise control of the
 * voxel wave resolve transition. Drives uProgress uniform from 0→1
 * with exponential easing, followed by fade-out phase.
 */

import { useRef, useLayoutEffect, useCallback } from 'react';
import gsap from 'gsap';

export interface TimelineConfig {
  /** Main animation duration in seconds */
  duration: number;
  /** Fade out duration in seconds */
  fadeOutDuration: number;
  /** Callback when animation completes */
  onComplete?: () => void;
  /** Callback on each frame with current values */
  onUpdate?: (progress: number, fadeOut: number) => void;
}

export interface TimelineState {
  progress: number;
  fadeOut: number;
}

export function useTransitionTimeline(config: TimelineConfig) {
  const { duration, fadeOutDuration, onComplete, onUpdate } = config;
  
  const stateRef = useRef<TimelineState>({
    progress: 0,
    fadeOut: 0,
  });
  
  const timelineRef = useRef<gsap.core.Timeline | null>(null);
  const isPlayingRef = useRef(false);
  
  // Create and start the timeline
  const start = useCallback(() => {
    if (isPlayingRef.current) return;
    isPlayingRef.current = true;
    
    // Reset state
    stateRef.current.progress = 0;
    stateRef.current.fadeOut = 0;
    
    // Create GSAP timeline
    const tl = gsap.timeline({
      onComplete: () => {
        isPlayingRef.current = false;
        onComplete?.();
      },
      onUpdate: () => {
        onUpdate?.(stateRef.current.progress, stateRef.current.fadeOut);
      },
    });
    
    // Phase 1: Main wave animation (0 → 1)
    // Uses exponential ease-out for decelerating expansion
    tl.to(stateRef.current, {
      progress: 1,
      duration: duration,
      ease: 'expo.out',
    });
    
    // Phase 2: Fade out (0 → 1)
    // Overlaps slightly with end of main animation for smooth transition
    // Uses power2.in for accelerating fade
    tl.to(
      stateRef.current,
      {
        fadeOut: 1,
        duration: fadeOutDuration,
        ease: 'power2.in',
      },
      `-=${fadeOutDuration * 0.25}` // Start 25% before main animation ends
    );
    
    timelineRef.current = tl;
  }, [duration, fadeOutDuration, onComplete, onUpdate]);
  
  // Cleanup on unmount
  useLayoutEffect(() => {
    return () => {
      if (timelineRef.current) {
        timelineRef.current.kill();
        timelineRef.current = null;
      }
    };
  }, []);
  
  // Get current state values (for useFrame reads)
  const getState = useCallback(() => stateRef.current, []);
  
  // Kill timeline early
  const stop = useCallback(() => {
    if (timelineRef.current) {
      timelineRef.current.kill();
      timelineRef.current = null;
    }
    isPlayingRef.current = false;
  }, []);
  
  return {
    start,
    stop,
    getState,
    stateRef,
  };
}
