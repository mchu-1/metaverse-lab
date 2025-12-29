import { Canvas } from '@react-three/fiber';
import { Joystick } from './Joystick';
import { useState, useCallback } from 'react';
import * as THREE from 'three';
import { WorldVisuals } from './WorldVisuals';
import { WorldPhysics } from './WorldPhysics';
import { CameraController } from './CameraController';
import { useKeyboardControls } from '../hooks/useKeyboardControls';
import { useDeviceOrientation } from '../hooks/useDeviceOrientation';

export const LabWorld = () => {
  const [joystickInput, setJoystickInput] = useState({ x: 0, y: 0 });
  const [isWorldVisible, setIsWorldVisible] = useState(false);
  const keyboardState = useKeyboardControls();
  const deviceOrientation = useDeviceOrientation();
  
  // State to hold the collision object (the GLTF scene)
  const [collisionObject, setCollisionObject] = useState<THREE.Object3D | undefined>(undefined);
  
  const handleJoystickMove = useCallback((x: number, y: number) => {
    setJoystickInput({ x, y });
  }, []);
  
  const handlePhysicsLoaded = useCallback((scene: THREE.Object3D) => {
    setCollisionObject(scene);
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

  const baseUrl = import.meta.env.BASE_URL;

  return (
    <>
      <div id="canvas-container" style={{ width: '100vw', height: '100vh', position: 'fixed', top: 0, left: 0, zIndex: 0 }}>
        <Canvas 
          camera={{ position: [0, 1.6, 2], fov: 75 }}
          gl={{ antialias: true, alpha: false }}
          style={{ background: '#000000' }}
        >
            {/* Visuals: The .spz splat */}
            <WorldVisuals src={`${baseUrl}lab-v1.spz`} />

            {/* Physics: The .glb mesh (invisible) */}
            <WorldPhysics 
                src={`${baseUrl}lab-v1.glb`} 
                onLoaded={handlePhysicsLoaded}
            />

            {/* Agent: Navigates using inputs and collision object */}
            <CameraController 
              joystickInput={joystickInput} 
              keyboardState={keyboardState} 
              deviceOrientation={deviceOrientation}
              collisionObject={collisionObject}
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
