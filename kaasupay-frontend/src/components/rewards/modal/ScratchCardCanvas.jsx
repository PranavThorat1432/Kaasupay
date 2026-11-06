import { useEffect, useRef, useState, useCallback } from 'react';
import { playScratchSound, triggerHaptic } from '../../../utils/rewardsAudio';

/**
 * Dual-Layer HTML5 2D Canvas Scratch Card with metallic holographic foil,
 * quadratic Bézier brush smoothing, alpha transparency calculation, and auto-reveal.
 */
export default function ScratchCardCanvas({
  width = 320,
  height = 360,
  onFirstScratch,
  onAutoReveal,
  isRevealed,
}) {
  const canvasRef = useRef(null);
  const isScratchingRef = useRef(false);
  const lastPointRef = useRef(null);
  const hasTriggeredFirstRef = useRef(false);
  const [scratchedPercent, setScratchedPercent] = useState(0);
  const checkTimerRef = useRef(null);
  const [isFadingOut, setIsFadingOut] = useState(false);

  // Initialize Foil Surface
  const initFoil = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    canvas.width = width * 2; // High-DPI support
    canvas.height = height * 2;
    ctx.scale(2, 2);

    // Metallic holographic gradient
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, '#f59e0b');
    grad.addColorStop(0.2, '#fde68a');
    grad.addColorStop(0.4, '#d97706');
    grad.addColorStop(0.6, '#fef3c7');
    grad.addColorStop(0.8, '#b45309');
    grad.addColorStop(1, '#f59e0b');

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Decorative holographic shimmer texture dots
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    for (let i = 0; i < 180; i++) {
      const rx = (i * 37) % width;
      const ry = (i * 73) % height;
      const r = (i % 3) + 1;
      ctx.beginPath();
      ctx.arc(rx, ry, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Outer decorative border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 4;
    ctx.strokeRect(10, 10, width - 20, height - 20);

    // Embossed KaasuPay Crest
    ctx.fillStyle = '#78350f';
    ctx.font = '900 24px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('KaasuPay', width / 2, height / 2 - 35);

    // Festival Badge
    ctx.fillStyle = '#92400e';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillText('✨ FESTIVAL REWARD ✨', width / 2, height / 2 - 5);

    // Scratch Instruction Pill
    ctx.fillStyle = 'rgba(120, 53, 15, 0.15)';
    ctx.beginPath();
    ctx.roundRect(width / 2 - 110, height / 2 + 25, 220, 36, 18);
    ctx.fill();

    ctx.fillStyle = '#78350f';
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.fillText('Scratch with finger or mouse', width / 2, height / 2 + 48);
  }, [width, height]);

  useEffect(() => {
    initFoil();
  }, [initFoil]);

  // Check transparent pixels percentage
  const calculateScratchedArea = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || isRevealed) return;

    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    let transparentCount = 0;
    const totalPixels = data.length / 4;

    // Sample every 4th pixel for high efficiency
    for (let i = 3; i < data.length; i += 16) {
      if (data[i] === 0) {
        transparentCount++;
      }
    }

    const pct = Math.round((transparentCount / (totalPixels / 4)) * 100);
    setScratchedPercent(pct);

    if (pct >= 45 && !isRevealed && !isFadingOut) {
      setIsFadingOut(true);
      setTimeout(() => {
        if (onAutoReveal) onAutoReveal();
      }, 400);
    }
  }, [isRevealed, isFadingOut, onAutoReveal]);

  // Handle scratch stroke with quadratic Bézier curves
  const scratch = (clientX, clientY) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    // Trigger claim API call on first touch
    if (!hasTriggeredFirstRef.current) {
      hasTriggeredFirstRef.current = true;
      if (onFirstScratch) onFirstScratch();
    }

    const ctx = canvas.getContext('2d');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineWidth = 56; // 28px radius * 2
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (lastPointRef.current) {
      const p1 = lastPointRef.current;
      const midPoint = {
        x: (p1.x + x) / 2,
        y: (p1.y + y) / 2,
      };

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.quadraticCurveTo(p1.x, p1.y, midPoint.x, midPoint.y);
      ctx.stroke();

      // Sound and haptic feedback
      const dist = Math.hypot(x - p1.x, y - p1.y);
      playScratchSound(dist);
      triggerHaptic([10]);
    }

    lastPointRef.current = { x, y };

    // Throttle percentage check
    if (!checkTimerRef.current) {
      checkTimerRef.current = setTimeout(() => {
        calculateScratchedArea();
        checkTimerRef.current = null;
      }, 250);
    }
  };

  const handlePointerDown = (e) => {
    if (isRevealed || isFadingOut) return;
    isScratchingRef.current = true;
    const rect = canvasRef.current.getBoundingClientRect();
    lastPointRef.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    scratch(e.clientX, e.clientY);
  };

  const handlePointerMove = (e) => {
    if (!isScratchingRef.current || isRevealed || isFadingOut) return;
    scratch(e.clientX, e.clientY);
  };

  const handlePointerUp = () => {
    isScratchingRef.current = false;
    lastPointRef.current = null;
    calculateScratchedArea();
  };

  return (
    <div className="relative select-none touch-none" style={{ width, height }}>
      {/* Top Foil Canvas */}
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        style={{
          width: `${width}px`,
          height: `${height}px`,
        }}
        className={`absolute inset-0 z-20 rounded-2xl cursor-grab active:cursor-grabbing shadow-lg transition-opacity duration-400 ${
          isFadingOut || isRevealed ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
      />

      {/* Scratched percentage indicator pill */}
      {!isRevealed && !isFadingOut && scratchedPercent > 5 && (
        <div className="absolute top-3 right-3 z-30 px-2.5 py-1 bg-navy-950/70 backdrop-blur-md text-amber-300 rounded-full text-[11px] font-mono font-bold">
          {scratchedPercent}%
        </div>
      )}
    </div>
  );
}
