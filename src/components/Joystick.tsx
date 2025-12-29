import { useRef, useState, useEffect, useCallback } from 'react';

interface JoystickProps {
  onMove: (x: number, y: number) => void;
  size?: number;
  visible?: boolean;
}

export const Joystick = ({ onMove, size = 120, visible = true }: JoystickProps) => {
  const baseRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [knobPosition, setKnobPosition] = useState({ x: 0, y: 0 });
  
  const knobSize = size * 0.4;
  const maxDistance = (size - knobSize) / 2;

  const handleMove = useCallback((clientX: number, clientY: number) => {
    if (!baseRef.current) return;
    
    const rect = baseRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    let deltaX = clientX - centerX;
    let deltaY = clientY - centerY;
    
    // Calculate distance from center
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    
    // Clamp to max distance
    if (distance > maxDistance) {
      deltaX = (deltaX / distance) * maxDistance;
      deltaY = (deltaY / distance) * maxDistance;
    }
    
    setKnobPosition({ x: deltaX, y: deltaY });
    
    // Normalize to -1 to 1
    const normalizedX = deltaX / maxDistance;
    const normalizedY = -deltaY / maxDistance; // Invert Y for camera (up = positive)
    
    onMove(normalizedX, normalizedY);
  }, [maxDistance, onMove]);

  const handleEnd = useCallback(() => {
    setIsDragging(false);
    setKnobPosition({ x: 0, y: 0 });
    onMove(0, 0);
  }, [onMove]);

  // Mouse events
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    handleMove(e.clientX, e.clientY);
  };

  // Touch events
  const handleTouchStart = (e: React.TouchEvent) => {
    e.preventDefault();
    setIsDragging(true);
    const touch = e.touches[0];
    handleMove(touch.clientX, touch.clientY);
  };

  useEffect(() => {
    if (!isDragging) return;

    const onMouseMove = (e: MouseEvent) => {
      handleMove(e.clientX, e.clientY);
    };

    const onTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      handleMove(touch.clientX, touch.clientY);
    };

    const onMouseUp = () => handleEnd();
    const onTouchEnd = () => handleEnd();

    // Add global listeners
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [isDragging, handleMove, handleEnd]);

  if (!visible) return null;

  return (
    <div
      ref={baseRef}
      className={`joystick-base ${isDragging ? 'active' : ''}`}
      style={{
        width: size,
        height: size,
      }}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
    >
      <div
        className="joystick-knob"
        style={{
          width: knobSize,
          height: knobSize,
          transform: `translate(${knobPosition.x}px, ${knobPosition.y}px)`,
        }}
      />
    </div>
  );
};
