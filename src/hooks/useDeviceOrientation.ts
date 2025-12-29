import { useState, useEffect } from 'react';

// Device orientation state for mobile look-around
export interface DeviceOrientationState {
  alpha: number; // Z-axis rotation (compass direction)
  beta: number;  // X-axis rotation (front-to-back tilt)
  gamma: number; // Y-axis rotation (left-to-right tilt)
  enabled: boolean;
  calibrated: boolean;
  initialAlpha: number;
  initialBeta: number;
}

// Hook to track device orientation for mobile look-around
export const useDeviceOrientation = () => {
  const [orientation, setOrientation] = useState<DeviceOrientationState>({
    alpha: 0,
    beta: 0,
    gamma: 0,
    enabled: false,
    calibrated: false,
    initialAlpha: 0,
    initialBeta: 0,
  });

  useEffect(() => {
    // Check if device orientation is available
    if (!window.DeviceOrientationEvent) {
      return;
    }

    // Request permission on iOS 13+
    const requestPermission = async () => {
      const DeviceOrientationEventTyped = DeviceOrientationEvent as any;
      if (typeof DeviceOrientationEventTyped.requestPermission === 'function') {
        try {
          const permission = await DeviceOrientationEventTyped.requestPermission();
          if (permission !== 'granted') {
            console.log('Device orientation permission denied');
            return false;
          }
        } catch (error) {
          console.error('Error requesting device orientation permission:', error);
          return false;
        }
      }
      return true;
    };

    let firstReading = true;

    const handleOrientation = (event: DeviceOrientationEvent) => {
      if (event.alpha === null || event.beta === null || event.gamma === null) {
        return;
      }

      setOrientation(prev => {
        // Calibrate on first reading
        if (!prev.calibrated || firstReading) {
          firstReading = false;
          return {
            alpha: 0,
            beta: 0,
            gamma: event.gamma!,
            enabled: true,
            calibrated: true,
            initialAlpha: event.alpha!,
            initialBeta: event.beta ?? 90,
          };
        }

        // Calculate relative rotation from initial position
        let deltaAlpha = event.alpha! - prev.initialAlpha;
        let deltaBeta = (event.beta ?? 90) - prev.initialBeta;

        // Normalize alpha to -180 to 180
        if (deltaAlpha > 180) deltaAlpha -= 360;
        if (deltaAlpha < -180) deltaAlpha += 360;

        return {
          ...prev,
          alpha: deltaAlpha,
          beta: deltaBeta,
          gamma: event.gamma!,
          enabled: true,
        };
      });
    };

    // Set up listener
    const setup = async () => {
      const hasPermission = await requestPermission();
      if (hasPermission) {
        window.addEventListener('deviceorientation', handleOrientation);
      }
    };

    setup();

    return () => {
      window.removeEventListener('deviceorientation', handleOrientation);
    };
  }, []);

  return orientation;
};
