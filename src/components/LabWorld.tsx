import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { SparkSplat } from './SparkSplat';
import { Joystick } from './Joystick';
import { useState, useRef, useCallback } from 'react';
import * as THREE from 'three';

// Camera controller that responds to joystick input
const CameraController = ({ joystickInput }: { joystickInput: { x: number; y: number } }) => {
  const { camera } = useThree();
  const controlsRef = useRef<any>(null);
  
  useFrame((_, delta) => {
    if (!controlsRef.current) return;
    
    const { x, y } = joystickInput;
    if (x === 0 && y === 0) return;
    
    // Movement speed
    const moveSpeed = 2.5 * delta;
    
    // Get camera's forward and right vectors (ignore Y for ground movement)
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    
    const right = new THREE.Vector3();
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    
    // Calculate movement
    const movement = new THREE.Vector3();
    movement.addScaledVector(forward, y * moveSpeed);
    movement.addScaledVector(right, x * moveSpeed);
    
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
      enableDamping={true}
      dampingFactor={0.05}
      zoomSpeed={1.2}
      target={[0, 1.6, 0]} 
      rotateSpeed={0.5}
    />
  );
};

export const LabWorld = () => {
  const [joystickInput, setJoystickInput] = useState({ x: 0, y: 0 });
  const [isWorldVisible, setIsWorldVisible] = useState(false);
  
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
        {/* 
          gl={{ antialias: false }} might be better for performance if Splats are heavy, 
          but default is usually fine.
        */}
        <Canvas 
          camera={{ position: [0, 1.7, 2], fov: 75 }}
          gl={{ antialias: true, alpha: false }}
          style={{ background: '#000000' }}
        >
          
          {/* LAYER 1: The Visuals (Spark Engine) */}
          {/* Using .spz file as requested */}
          <SparkSplat src="/lab.spz" scale={1} position={[0, 0, 0]} />

          {/* FUTURE: PHYSICS LAYER 
              <Physics>
                 <RigidBody><ColliderMesh /></RigidBody>
              </Physics>
          */}

          {/* Controls: Allow user to pan/zoom/rotate freely + joystick movement */}
          <CameraController joystickInput={joystickInput} />
          
          {/* Ambient light is not strictly needed for Splats (they are self-lit/emissive usually) but good to have if we add meshes */}
          <ambientLight intensity={1} />
        </Canvas>
      </div>
      
      {/* Joystick UI - visible after world transition */}
      <Joystick 
        onMove={handleJoystickMove} 
        size={100}
        visible={isWorldVisible}
      />
    </>
  );
};

