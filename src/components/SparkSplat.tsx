import { useMemo, useEffect } from 'react';
import { SplatMesh } from '@sparkjsdev/spark';

interface SparkSplatProps {
  src: string;
  [key: string]: any;
}

export function SparkSplat({ src, ...props }: SparkSplatProps) {
  const splat = useMemo(() => {
    // Enable/Disable specific features if needed via options
    // For now simple url is enough based on README
    console.log(`[SparkSplat] Creating SplatMesh for: ${src}`);
    const mesh = new SplatMesh({ url: src });
    return mesh;
  }, [src]);

  useEffect(() => {
    console.log('[SparkSplat] Component mounted');
    return () => {
        // Cleanup resources when component unmounts
        // Assuming dispose method exists on SplatMesh (inherits from Mesh?)
        console.log('[SparkSplat] Component unmounting');
        if (splat && typeof splat.dispose === 'function') {
            splat.dispose();
        }
    };
  }, [splat]);

  // @ts-ignore - R3F primitive handling
  return <primitive object={splat} {...props} />;
}
