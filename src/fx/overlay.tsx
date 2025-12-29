/**
 * TransitionOverlay Component
 * 
 * React portal wrapper that renders the WorldTransition
 * as a fullscreen overlay on top of the existing page.
 */

import { createPortal } from 'react-dom';
import { WorldTransition } from './main';
import type { TransitionOverlayProps } from './types';

export function TransitionOverlay({
  active,
  onComplete,
}: TransitionOverlayProps) {
  // Don't render if not active
  if (!active) return null;
  
  // Create container element for portal
  const container = document.getElementById('transition-root') || document.body;
  
  return createPortal(
    <WorldTransition
      textureUrl="" // world.png removed
      duration={4500}
      fadeOutDuration={1200}
      gridSize={110}
      onComplete={onComplete}
    />,
    container
  );
}

export default TransitionOverlay;
