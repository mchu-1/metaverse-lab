import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Gltf } from '@react-three/drei';
import { SparkSplat } from './SparkSplat';
import { Joystick } from './Joystick';
import { useState, useRef, useCallback, useEffect } from 'react';
import * as THREE from 'three';

// Keyboard state for 6DOF controls
interface KeyboardState {
  forward: boolean;   // W
  backward: boolean;  // S
  left: boolean;      // A
  right: boolean;     // D
  up: boolean;        // Space
  down: boolean;      // Shift
}

// Device orientation state for mobile look-around
interface DeviceOrientationState {
  alpha: number; // Z-axis rotation (compass direction)
  beta: number;  // X-axis rotation (front-to-back tilt)
  gamma: number; // Y-axis rotation (left-to-right tilt)
  enabled: boolean;
  calibrated: boolean;
  initialAlpha: number;
  initialBeta: number;
}

// Hook to track device orientation for mobile look-around
const useDeviceOrientation = () => {
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

// Hook to track keyboard state
const useKeyboardControls = () => {
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

// Detect if device is mobile
const isMobile = () => {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

// Camera controller that responds to joystick, keyboard, and device orientation input
const CameraController = ({ 
  joystickInput, 
  keyboardState,
  deviceOrientation
}: { 
  joystickInput: { x: number; y: number };
  keyboardState: KeyboardState;
  deviceOrientation: DeviceOrientationState;
}) => {
  const { camera } = useThree();
  const controlsRef = useRef<any>(null);
  const lastOrientationRef = useRef({ alpha: 0, beta: 0 });
  
  useFrame((_, delta) => {
    if (!controlsRef.current) return;
    
    // Handle device orientation for look-around on mobile
    if (deviceOrientation.enabled && isMobile()) {
      const rotationSpeed = 0.02;
      
      // Apply rotation deltas based on device orientation changes
      const deltaAlpha = deviceOrientation.alpha - lastOrientationRef.current.alpha;
      const deltaBeta = deviceOrientation.beta - lastOrientationRef.current.beta;
      
      if (Math.abs(deltaAlpha) > 0.1 || Math.abs(deltaBeta) > 0.1) {
        // Get current target position
        const target = controlsRef.current.target.clone();
        const cameraPos = camera.position.clone();
        
        // Calculate the direction from camera to target
        const direction = new THREE.Vector3();
        camera.getWorldDirection(direction);
        
        // Rotate around the camera position (horizontal - yaw)
        if (Math.abs(deltaAlpha) > 0.1) {
          const yawDelta = -deltaAlpha * (Math.PI / 180) * rotationSpeed;
          const rotationMatrix = new THREE.Matrix4().makeRotationY(yawDelta);
          
          // Rotate the target around the camera
          const offset = target.clone().sub(cameraPos);
          offset.applyMatrix4(rotationMatrix);
          controlsRef.current.target.copy(cameraPos.clone().add(offset));
        }
        
        // Rotate around the camera position (vertical - pitch)
        if (Math.abs(deltaBeta) > 0.1) {
          const pitchDelta = deltaBeta * (Math.PI / 180) * rotationSpeed * 0.5;
          
          // Get right vector for pitch rotation axis
          const right = new THREE.Vector3();
          right.crossVectors(direction, new THREE.Vector3(0, 1, 0)).normalize();
          
          // Rotate target around camera position using right axis
          const currentTarget = controlsRef.current.target.clone();
          const offset = currentTarget.sub(cameraPos);
          offset.applyAxisAngle(right, pitchDelta);
          
          // Clamp vertical rotation to prevent flipping
          const newDirection = offset.clone().normalize();
          const verticalAngle = Math.asin(newDirection.y);
          if (Math.abs(verticalAngle) < Math.PI / 2.5) {
            controlsRef.current.target.copy(cameraPos.clone().add(offset));
          }
        }
        
        lastOrientationRef.current = { alpha: deviceOrientation.alpha, beta: deviceOrientation.beta };
        controlsRef.current.update();
      }
    }
    
    // Combine joystick and keyboard input for movement
    let moveX = joystickInput.x;
    let moveZ = joystickInput.y;
    let moveY = 0;
    
    // Keyboard overrides/adds to joystick
    if (keyboardState.forward) moveZ += 1;
    if (keyboardState.backward) moveZ -= 1;
    if (keyboardState.left) moveX -= 1;
    if (keyboardState.right) moveX += 1;
    if (keyboardState.up) moveY += 1;
    if (keyboardState.down) moveY -= 1;
    
    // Clamp combined input
    moveX = Math.max(-1, Math.min(1, moveX));
    moveZ = Math.max(-1, Math.min(1, moveZ));
    moveY = Math.max(-1, Math.min(1, moveY));
    
    if (moveX === 0 && moveZ === 0 && moveY === 0) return;
    
    // Movement speed
    const moveSpeed = 2.5 * delta;
    
    // Get camera's forward and right vectors (ignore Y for horizontal movement)
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    
    const right = new THREE.Vector3();
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    
    // Calculate movement
    const movement = new THREE.Vector3();
    movement.addScaledVector(forward, moveZ * moveSpeed);
    movement.addScaledVector(right, moveX * moveSpeed);
    movement.y += moveY * moveSpeed; // Vertical movement
    
    // Apply movement to camera and controls target
    camera.position.add(movement);
    controlsRef.current.target.add(movement);
    controlsRef.current.update();
  });
  
  return (
    <OrbitControls 
      ref={controlsRef}
      makeDefault 
      enablePan={true} 
      enableDamping={false}
      zoomSpeed={1.2}
      target={[0, 1.6, 0]} 
      rotateSpeed={0.5}
      enableRotate={!deviceOrientation.enabled || !isMobile()} // Disable drag-rotate when using device orientation
    />
  );
};

export const LabWorld = () => {
  const [joystickInput, setJoystickInput] = useState({ x: 0, y: 0 });
  const [isWorldVisible, setIsWorldVisible] = useState(false);
  const keyboardState = useKeyboardControls();
  const deviceOrientation = useDeviceOrientation();
  
  const handleJoystickMove = useCallback((x: number, y: number) => {
    setJoystickInput({ x, y });
  }, []);
  
  // Listen for world visibility (set by main.tsx after transition)
  useState(() => {
    const checkVisibility = () => {
      const container = document.getElementById('canvas-container');
      if (container && container.style.opacity === '1') {
        setIsWorldVisible(true);
      }
    };
    
    // Check periodically until visible
    const interval = setInterval(() => {
      checkVisibility();
    }, 500);
    
    // Also listen for scene loaded event
    const handleSceneLoaded = () => setIsWorldVisible(true);
    window.addEventListener('scene-loaded', handleSceneLoaded);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('scene-loaded', handleSceneLoaded);
    };
  });

  return (
    <>
      <div id="canvas-container" style={{ width: '100vw', height: '100vh', position: 'fixed', top: 0, left: 0, zIndex: 0 }}>
        <Canvas 
          camera={{ position: [0, 1.6, 2], fov: 75 }}
          gl={{ antialias: true, alpha: false }}
          style={{ background: '#000000' }}
        >
          

          {/* LAYER 1: The Visuals (Spark Engine) */}
          <SparkSplat src={`${import.meta.env.BASE_URL}lab-v1.spz`} scale={1} position={[0, 0, 0]} />

          {/* LAYER 2: The Environment Mesh */}
          <Gltf src={`${import.meta.env.BASE_URL}lab-v1.glb`} scale={1} position={[0, 0, 0]} />

          {/* Controls: 6DOF camera movement via keyboard (WASD + Space/Shift), joystick, and device orientation */}
          <CameraController 
            joystickInput={joystickInput} 
            keyboardState={keyboardState} 
            deviceOrientation={deviceOrientation}
          />
          
          {/* Lighting for any future mesh additions */}
          <ambientLight intensity={1} />
          <directionalLight position={[5, 10, 5]} intensity={1} />
        </Canvas>
      </div>
      
      {/* Joystick UI - visible after world transition (mobile drag to move) */}
      <Joystick 
        onMove={handleJoystickMove} 
        size={100}
        visible={isWorldVisible}
      />
    </>
  );
};

