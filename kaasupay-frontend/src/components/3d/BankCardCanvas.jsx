import { Suspense, useState, lazy, Component } from 'react';
import { Canvas } from '@react-three/fiber';
import BankCardFallback from './BankCardFallback';

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

const LazyBankCardScene = lazy(() => import('./BankCardScene'));

class WebGLErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

export function BankCardCanvas({ className = '', maskedAccount, holderName }) {
  const [hasWebGL] = useState(() => isWebGLAvailable());

  if (!hasWebGL) {
    return <BankCardFallback className={className} maskedAccount={maskedAccount} holderName={holderName} />;
  }

  return (
    <div className={`relative w-full max-w-[340px] aspect-[1.586/1] mx-auto select-none ${className}`}>
      <WebGLErrorBoundary fallback={<BankCardFallback className={className} maskedAccount={maskedAccount} holderName={holderName} />}>
        <Suspense fallback={<BankCardFallback className={className} maskedAccount={maskedAccount} holderName={holderName} />}>
          <Canvas
            camera={{ position: [0, 0, 4.2], fov: 45 }}
            gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
            dpr={[1, 1.5]}
            style={{ pointerEvents: 'none' }}
          >
            <LazyBankCardScene />
          </Canvas>
          <div className="absolute inset-0 p-5 flex flex-col justify-between pointer-events-none text-white z-10">
            <div className="flex justify-end">
              <span className="text-[11px] font-mono font-bold tracking-wider text-cobalt-400">
                KaasuPay Bank Card
              </span>
            </div>
            <div className="text-center font-mono tracking-[0.22em] text-sm sm:text-base font-semibold drop-shadow-md text-slate-100">
              {maskedAccount || '•••• •••• •••• ••••'}
            </div>
            <div className="flex justify-between items-end text-[11px] font-mono text-slate-300">
              <span className="truncate max-w-[180px] font-semibold">{holderName || 'BENEFICIARY'}</span>
              <span className="text-[9px] text-emerald-400 bg-navy-950/70 px-1.5 py-0.5 rounded border border-emerald-500/30">
                AES-256
              </span>
            </div>
          </div>
        </Suspense>
      </WebGLErrorBoundary>
    </div>
  );
}

export default BankCardCanvas;
