import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, useGLTF } from '@react-three/drei';
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
  deviceOrientation,
  collisionObject
}: { 
  joystickInput: { x: number; y: number };
  keyboardState: KeyboardState;
  deviceOrientation: DeviceOrientationState;
  collisionObject?: THREE.Object3D;
}) => {
  const { camera } = useThree();
  const controlsRef = useRef<any>(null);
  const lastOrientationRef = useRef({ alpha: 0, beta: 0 });
  const raycasterRef = useRef(new THREE.Raycaster());
  
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
    // Calculate desired movement
    const movementVector = new THREE.Vector3();
    movementVector.addScaledVector(forward, moveZ * moveSpeed);
    movementVector.addScaledVector(right, moveX * moveSpeed);
    movementVector.y += moveY * moveSpeed; // Vertical movement
    
    // Collision Detection and Sliding
    if (collisionObject && (movementVector.lengthSq() > 0)) {
        const raycaster = raycasterRef.current;
        const COLLISION_RADIUS = 0.5;
        
        // We check purely for "walls" relative to movement direction
        const direction = movementVector.clone().normalize();
        const moveLength = movementVector.length();

        // Check at multiple heights (Eyes and Feet)
        const origins = [
            camera.position.clone(), // Eyes
            camera.position.clone().sub(new THREE.Vector3(0, 1.0, 0)) // Feet (approx)
        ];

        let collisionNormal = null;
        let minDistance = Infinity;

        for (const origin of origins) {
             raycaster.set(origin, direction);
             // far = check distance slightly more than move + radius to anticipate
             raycaster.far = COLLISION_RADIUS + moveLength * 2; 
             
             const intersects = raycaster.intersectObject(collisionObject, true);
             
             if (intersects.length > 0) {
                 const hit = intersects[0];
                 if (hit.distance < minDistance) {
                     minDistance = hit.distance;
                     // Only register if within blocking range
                     if (hit.distance < COLLISION_RADIUS) {
                         collisionNormal = hit.face?.normal?.clone();
                         // Ensure normal effectively points somewhat opposite to movement
                         // (Sometimes backfaces might be hit inside?)
                         if (collisionNormal) {
                             // Transform normal to world space if object is rotated? 
                             // Local normal is returned by Three.js raycaster usually... wait.
                             // intersectObject returns world point but face.normal is LOCAL?
                             // Actually three.js docs say face.normal is in object space?
                             // Standard practice: hit.face.normal.clone().applyQuaternion(hit.object.quaternion) 
                             // Wait, intersectObject computes intersection... let's check docs or be safe.
                             // Actually standard raycaster `face` normal is model space. We need world normal.
                             // Quick fix: Just use the vector from hit point to camera? No, that's not the normal.
                             // Let's assume the scene is static and world aligned? No.
                             // We should transform it.
                             
                             // Better: Compute normal from face? 
                             // Usually applyNormalMatrix?
                             
                             const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
                             collisionNormal.applyMatrix3(normalMatrix).normalize();
                         }
                     }
                 }
             }
        }

        if (collisionNormal) {
            // SLIDING LOGIC
            // Project movement vector onto the plane defined by the normal
            // v_slide = v - (v . n) * n
            
            const dot = movementVector.dot(collisionNormal);
            
            // Only slide if we are moving INTO the wall (dot < 0)
            if (dot < 0) {
                // Subtract component into wall
                const slideComponent = collisionNormal.multiplyScalar(dot);
                movementVector.sub(slideComponent);
                
                // Optional: Push out slightly to prevent getting stuck inside?
                // For now, sliding removes the 'into' component.
            }
        }
    }

    // Apply movement to camera and controls target
    camera.position.add(movementVector);
    controlsRef.current.target.add(movementVector);
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

const LabScene = ({ joystickInput, keyboardState, deviceOrientation }: any) => {
    // Load the GLTF to get access to the scene for collision
    const { scene } = useGLTF(`${import.meta.env.BASE_URL}lab-v1.glb`);
    
    // Ensure collision mesh is double-sided so we can't walk through backfaces
    useEffect(() => {
        scene.traverse((child) => {
            if ((child as any).isMesh) {
                const material = (child as any).material;
                material.side = THREE.DoubleSide;
                // Make invisible but keep collision
                material.transparent = true;
                material.opacity = 0;
                material.depthWrite = false; // Don't block background
            }
        });
    }, [scene]);
    
    return (
        <>
           {/* LAYER 1: The Visuals (Spark Engine) */}
           <SparkSplat src={`${import.meta.env.BASE_URL}lab-v1.spz`} scale={1} position={[0, 0, 0]} />

           {/* LAYER 2: The Environment Mesh */}
           {/* We use primitive to render the preloaded scene */}
           <primitive object={scene} scale={1} position={[0, 0, 0]} />

           {/* Controls: 6DOF camera movement via keyboard, joystick, and device orientation */}
           <CameraController 
             joystickInput={joystickInput} 
             keyboardState={keyboardState} 
             deviceOrientation={deviceOrientation}
             collisionObject={scene}
           />
           
           {/* Lighting for any future mesh additions */}
           <ambientLight intensity={1} />
           <directionalLight position={[5, 10, 5]} intensity={1} />
        </>
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
          <LabScene 
             joystickInput={joystickInput}
             keyboardState={keyboardState}
             deviceOrientation={deviceOrientation}
          />
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

