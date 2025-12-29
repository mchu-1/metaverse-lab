import { useRef, useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { KeyboardState } from '../hooks/useKeyboardControls';
import { DeviceOrientationState } from '../hooks/useDeviceOrientation';

interface CameraControllerProps {
  joystickInput: { x: number; y: number };
  keyboardState: KeyboardState;
  deviceOrientation: DeviceOrientationState;
  collisionObject?: THREE.Object3D;
}

// Detect if device is mobile
const isMobile = () => {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

// Camera controller that responds to joystick, keyboard, and device orientation input
export const CameraController = ({ 
  joystickInput, 
  keyboardState,
  deviceOrientation,
  collisionObject
}: CameraControllerProps) => {
  const { camera } = useThree();
  const controlsRef = useRef<any>(null);
  const lastOrientationRef = useRef({ alpha: 0, beta: 0 });

  
  // Agent Control Refs
  const agentMoveRef = useRef({ remaining: 0 }); 

  // Register Agent Controls
  useEffect(() => {
    // We attach to window.labControl (assumed initialized in main.tsx or we create it)
    if (!(window as any).labControl) (window as any).labControl = {};
    
    const controls = (window as any).labControl;
    
    controls.lookAtCoordinate = (u: number, v: number) => {
        if (!controlsRef.current) return;
        
        // Convert UV to Direction
        // Assuming standard equirectangular mapping (matching main.tsx/skybox logic)
        // u=0.5 is center (0 deg yaw), u=0/1 is back (-180/180)
        // v=0.5 is horizon, v=0 is top (+90), v=1 is bottom (-90)
        
        // Yaw (theta): Map u [0, 1] -> [PI, -PI] ? 
        // Main.tsx logic: worldYaw = (1 - u) * 2 * Math.PI + offset;
        // Let's simplify: Standard 360 map. Center (0,0, -1) starts at u=0.5?
        // Let's assume u=0.5 -> -Z (forward), u=0 -> +Z (back)
        
        // const theta = (1 - u) * 2 * Math.PI - Math.PI / 2; // Shifted
        // const phi = (0.5 - v) * Math.PI;
        
        // Convert Spherical to Cartesian Direction
        // x = cos(phi) * sin(theta)
        // y = sin(phi)
        // z = cos(phi) * cos(theta)
        
        // const x = Math.cos(phi) * Math.cos(theta); // Swapped sin/cos for phase?
        // const y = Math.sin(phi);
        // const z = Math.cos(phi) * Math.sin(theta);
        
        // Actually, let's use Three.js vector helpers
        const direction = new THREE.Vector3();
        // UV usually: U is longitude (theta), V is latitude (phi)
        // Start with -Z forward.
        // Let's use the logic: u maps to 0..2PI. 
        // We'll trust the visual feedback or standard map projection.
        // Standard:
        const lon = (u - 0.5) * 360; // 0.5 -> 0 deg
        const lat = (v - 0.5) * -180; // 0.5 -> 0 deg
        
        const phiRad = THREE.MathUtils.degToRad(90 - lat); // Theta in physics (top down)
        const thetaRad = THREE.MathUtils.degToRad(lon); // Phi in physics
        
        direction.setFromSphericalCoords(1.0, phiRad, thetaRad);
        
        // Apply Skybox Rotation Correction if needed (LabWorld often has -130 deg offset mentioned in main.tsx)
        // "Skybox is rotated -130 deg around Y" -> We must rotate our look direction by -130 deg to match visual
        const skyOffset = THREE.MathUtils.degToRad(-130);
        direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), skyOffset);
        
        // Now set target
        // Camera stays at position, Target = Position + Direction
        const target = camera.position.clone().add(direction);
        
        // Animate or Instant? Agent usually expects instant-ish or smooth.
        // Let's do instant for robustness first, OrbitControls will damp if enabled.
        controlsRef.current.target.copy(target);
        controlsRef.current.update();
    };
    
    controls.move = (distance: number) => {
        console.log("Agent moved command:", distance);
        agentMoveRef.current.remaining = distance;
    };
    
    controls.stop = () => {
        agentMoveRef.current.remaining = 0;
    };

    return () => {
        // Cleanup? Maybe not needed as these are global singletons effectively
        // controls.lookAtCoordinate = null;
    };
  }, [camera]);

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
    
    // ----------------------------------------
    // MOVEMENT CALCULATION (User + Agent)
    // ----------------------------------------
    const moveSpeed = 2.5 * delta;
    
    // Get camera's forward and right vectors (ignore Y for horizontal movement)
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    
    const right = new THREE.Vector3();
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    
    const movementVector = new THREE.Vector3();
    
    // 1. User Input
    if (moveX !== 0 || moveZ !== 0 || moveY !== 0) {
        movementVector.addScaledVector(forward, moveZ * moveSpeed);
        movementVector.addScaledVector(right, moveX * moveSpeed);
        movementVector.y += moveY * moveSpeed;
    }
    
    // 2. Agent Auto-Walk
    if (Math.abs(agentMoveRef.current.remaining) > 0.01) {
        // Determine step size for this frame
        const step = Math.min(Math.abs(agentMoveRef.current.remaining), moveSpeed);
        const sign = Math.sign(agentMoveRef.current.remaining);
        const vectorStep = step * sign;
        
        // Add to movement (Forward/Backward)
        movementVector.addScaledVector(forward, vectorStep);
        
        // Decrement remaining distance
        agentMoveRef.current.remaining -= vectorStep;
        
        // Snap to 0 if close
        if (Math.abs(agentMoveRef.current.remaining) < 0.01) agentMoveRef.current.remaining = 0;
    }
    
    

    // Collision Detection and Sliding REMOVED for performance
    // if (collisionObject && (movementVector.lengthSq() > 0)) { ... }


    // Apply movement to camera and controls target
    if (movementVector.lengthSq() > 0) {
        camera.position.add(movementVector);
        controlsRef.current.target.add(movementVector);
        controlsRef.current.update();
    }
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
      enableRotate={true}
    />
  );
};
