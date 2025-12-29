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
  deviceOrientation
}: CameraControllerProps) => {
  const { camera } = useThree();
  const controlsRef = useRef<any>(null);
  const lastOrientationRef = useRef({ alpha: 0, beta: 0 });

  // Agent Control Refs
  const agentMoveRef = useRef({ remaining: 0 }); 
  // Store target as { vector, active }
  const agentLookResult = useRef<{ target: THREE.Vector3, active: boolean } | null>(null);

  // Register Agent Controls
  useEffect(() => {
    // We attach to window.labControl (assumed initialized in main.tsx or we create it)
    if (!(window as any).labControl) (window as any).labControl = {};
    
    const controls = (window as any).labControl;
    
    controls.lookAtCoordinate = (u: number, v: number) => {
        if (!controlsRef.current) return;
        
        // Convert UV to Direction
        const direction = new THREE.Vector3();
        
        // Standard Equirectangular Mapping
        // u=0.5 is center (0 deg yaw), u=0/1 is back (-180/180)
        // v=0.5 is horizon, v=0 is top (+90), v=1 is bottom (-90)
        
        const lon = (u - 0.5) * 360; // 0.5 -> 0 deg
        const lat = (v - 0.5) * -180; // 0.5 -> 0 deg
        
        const phiRad = THREE.MathUtils.degToRad(90 - lat); // Theta in physics (top down)
        const thetaRad = THREE.MathUtils.degToRad(lon); // Phi in physics
        
        direction.setFromSphericalCoords(1.0, phiRad, thetaRad);
        
        // Apply Skybox Rotation Correction (-130 deg around Y)
        const skyOffset = THREE.MathUtils.degToRad(-130);
        direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), skyOffset);
        
        // Calculate absolute target position
        // Camera stays at position, Target = Position + Direction
        const target = camera.position.clone().add(direction);
        
        // Set smooth look target
        agentLookResult.current = { target, active: true };
    };
    
    controls.move = (distance: number) => {
        console.log("Agent moved command:", distance);
        agentMoveRef.current.remaining = distance;
    };
    
    controls.stop = () => {
        agentMoveRef.current.remaining = 0;
        if (agentLookResult.current) {
            agentLookResult.current.active = false;
        }
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
        // User taking control
        if (agentLookResult.current) agentLookResult.current.active = false;
      
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
    const moveSpeed = 0.8 * delta;
    
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
        
        // User overrides agent look
        if (agentLookResult.current) agentLookResult.current.active = false;
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
    
    // 3. Agent Smooth Look-At
    if (agentLookResult.current && agentLookResult.current.active) {
        const currentTarget = controlsRef.current.target;
        const desiredTarget = agentLookResult.current.target;
        
        const dist = currentTarget.distanceTo(desiredTarget);
        if (dist > 0.01) {
             // Smoothly interpolate current target to desired target
             // Lerp factor
             const lerpFactor = 5.0 * delta; // Adjust speed for smoothness
             currentTarget.lerp(desiredTarget, Math.min(lerpFactor, 1.0));
             controlsRef.current.update();
        } else {
            // Reached destination
            agentLookResult.current.active = false;
        }
    }

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
