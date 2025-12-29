import { useEffect } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';

interface WorldPhysicsProps {
  src: string;
  onLoaded?: (scene: THREE.Object3D) => void;
}

export function WorldPhysics({ src, onLoaded }: WorldPhysicsProps) {
  // Load the GLTF to get access to the scene for collision
  const { scene } = useGLTF(src);
  
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

    if (onLoaded) {
      onLoaded(scene);
    }
  }, [scene, onLoaded]);

  return (
    <>
      {/* LAYER 2: The Environment Mesh */}
      {/* We use primitive to render the preloaded scene (even if invisible) */}
      <primitive object={scene} scale={1} position={[0, 0, 0]} />
    </>
  );
}
