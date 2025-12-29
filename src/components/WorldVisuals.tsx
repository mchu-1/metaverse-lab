import { SparkSplat } from './SparkSplat';

interface WorldVisualsProps {
  src: string;
}

export function WorldVisuals({ src }: WorldVisualsProps) {
  return (
    <>
      {/* LAYER 1: The Visuals (Spark Engine) */}
      <SparkSplat src={src} scale={1} position={[0, 0, 0]} />
      
      {/* Lighting environment for consistency */}
      <ambientLight intensity={1} />
      <directionalLight position={[5, 10, 5]} intensity={1} />
    </>
  );
}
