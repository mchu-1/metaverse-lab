/**
 * World Transition - Entry Point
 * 
 * Exports the transition components and a standalone mount function
 * for integration with vanilla JS/HTML pages.
 */

import { createRoot, Root } from 'react-dom/client';
import { WorldTransition } from './main';
import { TransitionOverlay } from './overlay';
import type { WorldTransitionProps, TransitionOverlayProps } from './types';

// Re-export components for React users
export { WorldTransition, TransitionOverlay };
export type { WorldTransitionProps, TransitionOverlayProps };

/**
 * Standalone mount function for vanilla JS integration
 * 
 * Usage:
 * ```js
 * import { mountWorldTransition } from './dist/world-transition.es.js';
 * 
 * const unmount = mountWorldTransition({
 *   container: document.body,
 *   textureUrl: '/nslab-world.png',
 *   duration: 4500,
 *   fadeOutDuration: 1200,
 *   gridSize: 110,
 *   onComplete: () => console.log('Done!')
 * });
 * ```
 */
export interface MountOptions extends WorldTransitionProps {
  /** Container element to mount into */
  container?: HTMLElement;
}

let activeRoot: Root | null = null;
let activeContainer: HTMLDivElement | null = null;

export function mountWorldTransition(options: MountOptions): () => void {
  const {
    container = document.body,
    textureUrl,
    duration = 4500,
    fadeOutDuration = 1200,
    gridSize = 110,
    onReady,
    onComplete,
  } = options;
  
  // Clean up any existing transition
  if (activeRoot) {
    activeRoot.unmount();
    activeRoot = null;
  }
  if (activeContainer) {
    activeContainer.remove();
    activeContainer = null;
  }
  
  // Create container div
  const div = document.createElement('div');
  div.id = 'transition-root';
  div.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    z-index: 2100;
    pointer-events: none;
  `;
  container.appendChild(div);
  activeContainer = div;
  
  // Create React root
  const root = createRoot(div);
  activeRoot = root;
  
  // Cleanup function
  const cleanup = () => {
    if (activeRoot) {
      activeRoot.unmount();
      activeRoot = null;
    }
    if (activeContainer) {
      activeContainer.remove();
      activeContainer = null;
    }
  };
  
  // Render transition
  root.render(
    <WorldTransition
      textureUrl={textureUrl}
      duration={duration}
      fadeOutDuration={fadeOutDuration}
      gridSize={gridSize}
      onReady={onReady}
      onComplete={() => {
        cleanup();
        onComplete?.();
      }}
    />
  );
  
  return cleanup;
}

// Export for UMD/global usage
if (typeof window !== 'undefined') {
  (window as unknown as { mountWorldTransition: typeof mountWorldTransition }).mountWorldTransition = mountWorldTransition;
}
