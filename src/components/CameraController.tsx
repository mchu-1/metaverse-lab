import { useRef } from 'react';
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
      enableRotate={true}
    />
  );
};
