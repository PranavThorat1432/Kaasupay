import { Suspense, useState, lazy, Component } from 'react';
import { Canvas } from '@react-three/fiber';
import WalletFallback from './WalletFallback';

function isWebGLAvailable() {
  try {
    const canvas = document.createElement('canvas');
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
    );
  } catch {
    return false;
  }
}

const LazyWalletScene = lazy(() => import('./WalletScene'));

class WebGLErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch() {}

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

export function WalletCanvas({ className = '' }) {
  const [hasWebGL] = useState(() => isWebGLAvailable());

  if (!hasWebGL) {
    return <WalletFallback className={className} />;
  }

  return (
    <div className={`relative w-full aspect-4/3 max-w-lg mx-auto flex items-center justify-center ${className}`}>
      <WebGLErrorBoundary fallback={<WalletFallback className={className} />}>
        <Suspense fallback={<WalletFallback className={className} />}>
          <Canvas
            camera={{ position: [0, 0, 4.4], fov: 42 }}
            gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
            dpr={[1, 1.5]}
            style={{ width: '100%', height: '100%' }}
          >
            <LazyWalletScene />
          </Canvas>
        </Suspense>
      </WebGLErrorBoundary>
    </div>
  );
}

export default WalletCanvas;
