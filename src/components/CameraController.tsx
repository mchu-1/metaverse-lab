import { useRef, useEffect, MutableRefObject } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { KeyboardState } from '../hooks/useKeyboardControls';
import { DeviceOrientationState } from '../hooks/useDeviceOrientation';

interface CameraControllerProps {
  joystickRef: MutableRefObject<{ x: number; y: number }>;
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
  joystickRef, 
  keyboardState,
  deviceOrientation
}: CameraControllerProps) => {
  const { camera } = useThree();
  const controlsRef = useRef<any>(null);
  const lastOrientationRef = useRef({ alpha: 0, beta: 0 });
  const velocity = useRef(new THREE.Vector3(0, 0, 0));

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
        // Camera stays at position, Target = Position + Direction * Distance
        // We project it far away (100m) so looking direction stays stable when moving slightly
        const target = camera.position.clone().add(direction.multiplyScalar(100));
        
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

  // Touch Look Controls (One Finger Drag)
  useEffect(() => {
    if (!isMobile()) return;

    const canvas = document.querySelector('canvas');
    if (!canvas) return;

    let isDragging = false;
    let lastTouch = { x: 0, y: 0 };
    const rotationSpeed = 0.005; // Sensitivity

    const handleTouchStart = (e: TouchEvent) => {
      // Only process single touch that is NOT on the joystick
      // (Joystick stops propagation usually, but we check target just in case if needed, 
      // but usually joystick is an overlay. We just care if it bubbled to canvas)
      if (e.touches.length === 1) {
        isDragging = true;
        lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isDragging || !controlsRef.current) return;
      // Prevent scrolling
      e.preventDefault(); 

      const touch = e.touches[0];
      const deltaX = touch.clientX - lastTouch.x;
      const deltaY = touch.clientY - lastTouch.y;
      
      lastTouch = { x: touch.clientX, y: touch.clientY };

      if (Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5) {
        // User taking control
        if (agentLookResult.current) agentLookResult.current.active = false;

        const target = controlsRef.current.target.clone();
        const cameraPos = camera.position.clone();
        const direction = new THREE.Vector3();
        camera.getWorldDirection(direction);

        // Yaw (Horizontal drag -> Rotate around Y)
        if (Math.abs(deltaX) > 0.5) {
          const yawDelta = deltaX * rotationSpeed; // Left drag = positive delta -> look left?
          // Actually standard: Drag Left -> Look Right (Orbit). 
          // WANTED: Drag Left -> Look Left (Egocentric/Swipe to pan camera) 
          // OR: Drag Left -> Pull world Right -> Look Right.
          // "Single finger drag: egocentric" usually means dragging the VIEW. 
          // Drag Left (finger moves -X) -> Camera Rotates Left (Yaw +).
          
          const rotationMatrix = new THREE.Matrix4().makeRotationY(yawDelta);
          const offset = target.clone().sub(cameraPos);
          offset.applyMatrix4(rotationMatrix);
          controlsRef.current.target.copy(cameraPos.clone().add(offset));
        }

        // Pitch (Vertical drag -> Rotate around Right axis)
        if (Math.abs(deltaY) > 0.5) {
          const pitchDelta = deltaY * rotationSpeed;
          
          const right = new THREE.Vector3();
          right.crossVectors(direction, new THREE.Vector3(0, 1, 0)).normalize();

          const currentTarget = controlsRef.current.target.clone();
          const offset = currentTarget.sub(cameraPos);
          offset.applyAxisAngle(right, pitchDelta);

          // Clamp
          const newDirection = offset.clone().normalize();
          const verticalAngle = Math.asin(newDirection.y);
          if (Math.abs(verticalAngle) < Math.PI / 2.5) {
            controlsRef.current.target.copy(cameraPos.clone().add(offset));
          }
        }
        
        controlsRef.current.update();
      }
    };

    const handleTouchEnd = () => {
      isDragging = false;
    };

    canvas.addEventListener('touchstart', handleTouchStart);
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd);

    return () => {
        canvas.removeEventListener('touchstart', handleTouchStart);
        canvas.removeEventListener('touchmove', handleTouchMove);
        canvas.removeEventListener('touchend', handleTouchEnd);
    }
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
    // Read directly from Ref
    let moveX = joystickRef.current.x;
    let moveZ = joystickRef.current.y;
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
    
    // Physics constants
    const MAX_SPEED = 0.04; // Reduced speed
    const ACCELERATION = 2.0 * delta; // Adjust acceleration feel
    const FRICTION = 0.0; // Inertia/Gliding - 0.0 for instant stop
    
    // Get camera's forward and right vectors (ignore Y for horizontal movement)
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    
    const right = new THREE.Vector3();
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    
    const inputVector = new THREE.Vector3();
    
    // 1. User Input (Joystick + Keyboard)
    if (moveX !== 0 || moveZ !== 0 || moveY !== 0) {
        inputVector.addScaledVector(forward, moveZ);
        inputVector.addScaledVector(right, moveX);
        inputVector.y += moveY;
        
        // Normalize input to prevent faster diagonal movement
        if (inputVector.lengthSq() > 1) inputVector.normalize();
        
        // User overrides agent look
        if (agentLookResult.current) agentLookResult.current.active = false;
    }
    
    // 2. Agent Auto-Walk inputs (Add to input vector)
    if (Math.abs(agentMoveRef.current.remaining) > 0.01) {
        const sign = Math.sign(agentMoveRef.current.remaining);
        inputVector.addScaledVector(forward, sign);
        
        // Decrement logic handles actual distance, but physics handles the movement
        // We'll just simulate "pushing" the stick forward/backward while remaining distance exists
        // const step = Math.abs(velocity.current.z) * delta; // approximate distance covered (unused)

        // This is a bit complex to mix with physics, let's keep it simple: 
        // If agent wants to move, we apply input force in that direction until distance is 0.
        
        // Actually, let's just decrement remaining distance by the speed we *actually* move at the end.
    }

    // Apply Acceleration
    if (inputVector.lengthSq() > 0) {
        // Accelerate towards input direction
        velocity.current.add(inputVector.multiplyScalar(ACCELERATION));
        
        // Clamp to Max Speed
        if (velocity.current.length() > MAX_SPEED) {
             velocity.current.clampLength(0, MAX_SPEED);
        }
    } else {
        // Decelerate (Friction) when no input
        velocity.current.multiplyScalar(FRICTION);
    }
    
    // Stop completely if very slow
    if (velocity.current.lengthSq() < 0.000001) {
        velocity.current.set(0, 0, 0);
    }
    
    // 3. Agent Smooth Look-At (Independent of movement physics)
    if (agentLookResult.current && agentLookResult.current.active) {
        const currentTarget = controlsRef.current.target;
        const desiredTarget = agentLookResult.current.target;
        
        const dist = currentTarget.distanceTo(desiredTarget);
        if (dist > 0.01) {
             const lerpFactor = 5.0 * delta; 
             currentTarget.lerp(desiredTarget, Math.min(lerpFactor, 1.0));
             controlsRef.current.update();
        } else {
            agentLookResult.current.active = false;
        }
    }

    // Apply movement to camera and controls target
    if (velocity.current.lengthSq() > 0) {
        camera.position.add(velocity.current);
        controlsRef.current.target.add(velocity.current);
        controlsRef.current.update();
        
        // Update agent remaining distance if moving
        if (Math.abs(agentMoveRef.current.remaining) > 0) {
             // Project velocity onto forward vector to see how much we moved 'forward'
             const moveDist = velocity.current.clone().projectOnVector(forward).length();
             agentMoveRef.current.remaining -= Math.sign(agentMoveRef.current.remaining) * moveDist;
             if (Math.abs(agentMoveRef.current.remaining) < 0.1) agentMoveRef.current.remaining = 0;
        }
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
      enableRotate={!isMobile()} // Disable Orbit rotation on mobile
    />
  );
};
