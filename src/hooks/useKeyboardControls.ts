import { useState, useEffect } from 'react';

// Keyboard state for 6DOF controls
export interface KeyboardState {
  forward: boolean;   // W
  backward: boolean;  // S
  left: boolean;      // A
  right: boolean;     // D
  up: boolean;        // Space
  down: boolean;      // Shift
}

// Hook to track keyboard state
export const useKeyboardControls = () => {
  const [keys, setKeys] = useState<KeyboardState>({
    forward: false,
    backward: false,
    left: false,
    right: false,
    up: false,
    down: false,
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent default for game controls
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight'].includes(e.code)) {
        e.preventDefault();
      }
      
      setKeys(prev => {
        switch (e.code) {
          case 'KeyW': return { ...prev, forward: true };
          case 'KeyS': return { ...prev, backward: true };
          case 'KeyA': return { ...prev, left: true };
          case 'KeyD': return { ...prev, right: true };
          case 'Space': return { ...prev, up: true };
          case 'ShiftLeft':
          case 'ShiftRight': return { ...prev, down: true };
          default: return prev;
        }
      });
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      setKeys(prev => {
        switch (e.code) {
          case 'KeyW': return { ...prev, forward: false };
          case 'KeyS': return { ...prev, backward: false };
          case 'KeyA': return { ...prev, left: false };
          case 'KeyD': return { ...prev, right: false };
          case 'Space': return { ...prev, up: false };
          case 'ShiftLeft':
          case 'ShiftRight': return { ...prev, down: false };
          default: return prev;
        }
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  return keys;
};
