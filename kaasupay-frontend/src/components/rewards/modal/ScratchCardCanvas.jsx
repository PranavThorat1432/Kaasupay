import { useEffect, useRef, useState, useCallback } from 'react';
import { playScratchSound, triggerHaptic } from '../../../utils/rewardsAudio';

/**
 * Dual-Layer HTML5 2D Canvas Scratch Card with metallic holographic foil,
 * reliable pointer capture, responsive coordinate normalization,
 * high-DPI scaling (capped at 3x) with scratch progress preservation across resize/DPR,
 * rAF-throttled transparency calculation, unmount-safe reveal lifecycle,
 * and full keyboard accessibility.
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
  const claimPromiseRef = useRef(null);
  const hasTriggeredRevealRef = useRef(false);
  const hasDrawnFoilRef = useRef(false);
  const isMountedRef = useRef(true);

  const [scratchedPercent, setScratchedPercent] = useState(0);
  const [isFadingOut, setIsFadingOut] = useState(false);

  // Track previous CSS dimensions and physical DPR
  const prevLayoutRef = useRef({ width: 0, height: 0, dpr: 0 });
  const checkRafRef = useRef(null);
  const lastCheckTimeRef = useRef(0);
  const isCalculatingRef = useRef(false);
  const revealTimeoutRef = useRef(null);

  // Draw premium metallic holographic foil on the canvas
  const drawFoilSurface = useCallback((ctx, w, h) => {
    // 1. Brushed metallic multi-stop gold gradient
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0.0, '#d97706'); // Deep amber
    grad.addColorStop(0.15, '#fef08a'); // Bright gold specular
    grad.addColorStop(0.35, '#b45309'); // Warm metallic amber
    grad.addColorStop(0.5, '#fffbeb'); // High specular light streak
    grad.addColorStop(0.65, '#ca8a04'); // Rich gold
    grad.addColorStop(0.85, '#fde68a'); // Soft shimmer
    grad.addColorStop(1.0, '#92400e'); // Deep shadow border

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // 2. Subtle brushed metal micro-texture (fine horizontal lines)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    for (let y = 4; y < h; y += 6) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // 3. Holographic prismatic sparkle dots
    const holoColors = [
      'rgba(255, 255, 255, 0.45)',
      'rgba(253, 230, 138, 0.4)',
      'rgba(196, 181, 253, 0.3)',
      'rgba(167, 243, 208, 0.3)',
    ];

    for (let i = 0; i < 160; i++) {
      const rx = (i * 47 + 13) % w;
      const ry = (i * 89 + 17) % h;
      const r = (i % 3) * 0.8 + 0.8;
      ctx.fillStyle = holoColors[i % holoColors.length];
      ctx.beginPath();
      ctx.arc(rx, ry, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 4. Double beveled border with filigree styling
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 2;
    ctx.strokeRect(8, 8, w - 16, h - 16);

    ctx.strokeStyle = 'rgba(120, 53, 15, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(12, 12, w - 24, h - 24);

    // Corner decorative accents
    const corners = [
      [14, 14],
      [w - 14, 14],
      [14, h - 14],
      [w - 14, h - 14],
    ];
    ctx.fillStyle = '#78350f';
    corners.forEach(([cx, cy]) => {
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fill();
    });

    // 5. Embossed KaasuPay Crest
    ctx.save();
    ctx.shadowColor = 'rgba(255, 255, 255, 0.6)';
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 1;
    ctx.shadowBlur = 1;

    ctx.fillStyle = '#78350f';
    ctx.font = '900 24px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('KaasuPay', w / 2, h / 2 - 38);

    // Subtitle / Festival Badge
    ctx.fillStyle = '#92400e';
    ctx.font = 'bold 12px system-ui, -apple-system, sans-serif';
    ctx.fillText('✨ FESTIVAL REWARD ✨', w / 2, h / 2 - 10);
    ctx.restore();

    // 6. Scratch Instruction Pill
    ctx.fillStyle = 'rgba(120, 53, 15, 0.14)';
    ctx.beginPath();
    ctx.roundRect(w / 2 - 110, h / 2 + 20, 220, 36, 18);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = '#78350f';
    ctx.font = '600 12px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Scratch with finger or mouse', w / 2, h / 2 + 38);
  }, []);

  // Initialize or resize foil surface with DPR capping at 3x & scratch preservation
  const initOrResizeFoil = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const currentDpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 3) : 1;
    const prev = prevLayoutRef.current;

    const widthChanged = prev.width !== width;
    const heightChanged = prev.height !== height;
    const dprChanged = prev.dpr !== currentDpr;

    // If nothing changed and foil was already rendered, avoid redundant redraw
    if (!widthChanged && !heightChanged && !dprChanged && hasDrawnFoilRef.current) {
      return;
    }

    const newPhysicalWidth = Math.round(width * currentDpr);
    const newPhysicalHeight = Math.round(height * currentDpr);

    if (hasDrawnFoilRef.current && canvas.width > 0 && canvas.height > 0) {
      // PRESERVE SCRATCH PROGRESS: Copy existing canvas (including transparent pixels) to offscreen buffer
      const offscreen = document.createElement('canvas');
      offscreen.width = canvas.width;
      offscreen.height = canvas.height;
      const offCtx = offscreen.getContext('2d');

      if (offCtx) {
        offCtx.drawImage(canvas, 0, 0);

        // Resize destination canvas physical dimensions (clears canvas and resets transforms)
        canvas.width = newPhysicalWidth;
        canvas.height = newPhysicalHeight;

        // Map physical pixels directly from offscreen to new physical dimensions
        ctx.drawImage(
          offscreen,
          0,
          0,
          offscreen.width,
          offscreen.height,
          0,
          0,
          newPhysicalWidth,
          newPhysicalHeight
        );

        // Apply DPR scaling for subsequent brush strokes
        ctx.scale(currentDpr, currentDpr);
        prevLayoutRef.current = { width, height, dpr: currentDpr };
      } else {
        // Safe fallback: if offscreen context creation fails, do not mark resize as succeeded
        return;
      }
    } else {
      // First-time initialization: configure physical dimensions and draw fresh foil
      canvas.width = newPhysicalWidth;
      canvas.height = newPhysicalHeight;
      ctx.scale(currentDpr, currentDpr);
      drawFoilSurface(ctx, width, height);
      hasDrawnFoilRef.current = true;
      prevLayoutRef.current = { width, height, dpr: currentDpr };
    }
  }, [width, height, drawFoilSurface]);

  useEffect(() => {
    initOrResizeFoil();
  }, [initOrResizeFoil]);

  // Listen for DPR changes (e.g., monitor switch or zoom) even when CSS dimensions remain constant
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;

    const dpr = window.devicePixelRatio || 1;
    const mq = window.matchMedia(`(resolution: ${dpr}dppx)`);

    const handleDprChange = () => {
      initOrResizeFoil();
    };

    if (mq.addEventListener) {
      mq.addEventListener('change', handleDprChange);
      return () => mq.removeEventListener('change', handleDprChange);
    } else if (mq.addListener) {
      mq.addListener(handleDprChange);
      return () => mq.removeListener(handleDprChange);
    }
  }, [initOrResizeFoil]);

  // Lifecycle safety: Clear all pending timers, rAFs, and prevent post-unmount execution
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (revealTimeoutRef.current) {
        clearTimeout(revealTimeoutRef.current);
        revealTimeoutRef.current = null;
      }
      if (checkRafRef.current) {
        cancelAnimationFrame(checkRafRef.current);
        checkRafRef.current = null;
      }
    };
  }, []);

  // Safe first scratch invocation: prevents duplicate API calls
  const triggerFirstScratchIfNeeded = useCallback(() => {
    if (hasTriggeredFirstRef.current) {
      return claimPromiseRef.current;
    }
    hasTriggeredFirstRef.current = true;
    if (onFirstScratch) {
      try {
        const res = onFirstScratch();
        // Prevent unhandled rejection warning while awaiting in scheduleReveal
        if (res && typeof res.catch === 'function') {
          res.catch(() => {});
        }
        claimPromiseRef.current = res;
      } catch (err) {
        const rejected = Promise.reject(err);
        rejected.catch(() => {});
        claimPromiseRef.current = rejected;
      }
    }
    return claimPromiseRef.current;
  }, [onFirstScratch]);

  // Safe reveal trigger: strictly idempotent and unmount-safe
  const triggerReveal = useCallback(() => {
    if (!isMountedRef.current || hasTriggeredRevealRef.current || isRevealed) {
      return;
    }
    hasTriggeredRevealRef.current = true;

    if (revealTimeoutRef.current) {
      clearTimeout(revealTimeoutRef.current);
      revealTimeoutRef.current = null;
    }

    if (onAutoReveal) {
      onAutoReveal();
    }
  }, [isRevealed, onAutoReveal]);

  // Schedule auto-reveal with pending timeout ref and backend confirmation synchronization
  const scheduleReveal = useCallback((delay = 350) => {
    if (!isMountedRef.current || hasTriggeredRevealRef.current || isRevealed) {
      return;
    }

    setIsFadingOut(true);

    if (revealTimeoutRef.current) {
      clearTimeout(revealTimeoutRef.current);
    }

    revealTimeoutRef.current = setTimeout(async () => {
      revealTimeoutRef.current = null;
      if (!isMountedRef.current || hasTriggeredRevealRef.current) return;

      // Handle claim promise lifecycle
      let promise = claimPromiseRef.current;
      if (!promise && onFirstScratch) {
        promise = triggerFirstScratchIfNeeded();
      }

      if (promise && typeof promise.then === 'function') {
        try {
          await promise;
        } catch {
          // Claim rejected by backend: do NOT call onAutoReveal()
          if (!isMountedRef.current) return;

          // Restore interactive state and clean up pending reveal lifecycle
          setIsFadingOut(false);
          hasTriggeredRevealRef.current = false;
          hasTriggeredFirstRef.current = false;
          claimPromiseRef.current = null;
          return;
        }
      } else if (onFirstScratch) {
        // Claim was expected but never initiated: do not assume success
        if (!isMountedRef.current) return;
        setIsFadingOut(false);
        hasTriggeredRevealRef.current = false;
        hasTriggeredFirstRef.current = false;
        claimPromiseRef.current = null;
        return;
      }

      // Claim successfully confirmed: continue existing idempotent reveal flow
      if (isMountedRef.current && !hasTriggeredRevealRef.current) {
        triggerReveal();
      }
    }, delay);
  }, [isRevealed, onFirstScratch, triggerFirstScratchIfNeeded, triggerReveal]);

  // Check transparent pixels percentage with rAF throttling and 45% threshold
  const calculateScratchedArea = useCallback(() => {
    const canvas = canvasRef.current;
    if (
      !canvas ||
      isRevealed ||
      isFadingOut ||
      hasTriggeredRevealRef.current ||
      isCalculatingRef.current
    ) {
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    isCalculatingRef.current = true;
    try {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      let transparentCount = 0;
      const totalSampled = data.length / 16; // Sample every 4th pixel (16 bytes)

      for (let i = 3; i < data.length; i += 16) {
        if (data[i] < 32) {
          // Alpha near zero
          transparentCount++;
        }
      }

      const pct = Math.round((transparentCount / totalSampled) * 100);
      setScratchedPercent(pct);

      if (pct >= 45 && !isRevealed && !isFadingOut && !hasTriggeredRevealRef.current) {
        scheduleReveal(350);
      }
    } finally {
      isCalculatingRef.current = false;
    }
  }, [isRevealed, isFadingOut, scheduleReveal]);

  // Schedule rAF transparency calculation
  const scheduleCheck = useCallback(() => {
    const now = performance.now();
    if (now - lastCheckTimeRef.current > 120) {
      lastCheckTimeRef.current = now;
      if (checkRafRef.current) {
        cancelAnimationFrame(checkRafRef.current);
      }
      checkRafRef.current = requestAnimationFrame(calculateScratchedArea);
    }
  }, [calculateScratchedArea]);

  // Handle scratch stroke with quadratic Bézier curves and coordinate normalization
  const scratch = (clientX, clientY) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    // Coordinate normalization for responsive scaling
    const scaleX = width / rect.width;
    const scaleY = height / rect.height;
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;

    // Trigger claim API call on first touch/drag
    triggerFirstScratchIfNeeded();

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineWidth = 56; // 28px brush radius * 2
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

      // Sound and gentle haptic feedback
      const dist = Math.hypot(x - p1.x, y - p1.y);
      playScratchSound(dist);
      triggerHaptic([10]);
    }

    lastPointRef.current = { x, y };
    scheduleCheck();
  };

  const handlePointerDown = (e) => {
    if (isRevealed || isFadingOut || hasTriggeredRevealRef.current) return;
    isScratchingRef.current = true;

    // Pointer capture for uninterrupted drag tracking
    if (e.target && e.target.setPointerCapture) {
      try {
        e.target.setPointerCapture(e.pointerId);
      } catch {
        // Fallback if pointer capture is unsupported in mock environment
      }
    }

    const canvas = canvasRef.current;
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      const scaleX = rect.width > 0 ? width / rect.width : 1;
      const scaleY = rect.height > 0 ? height / rect.height : 1;
      lastPointRef.current = {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    }
    scratch(e.clientX, e.clientY);
  };

  const handlePointerMove = (e) => {
    if (!isScratchingRef.current || isRevealed || isFadingOut || hasTriggeredRevealRef.current) return;
    scratch(e.clientX, e.clientY);
  };

  const handlePointerUp = (e) => {
    if (!isScratchingRef.current) return;
    isScratchingRef.current = false;
    lastPointRef.current = null;

    if (e?.target && e.target.releasePointerCapture) {
      try {
        if (e.target.hasPointerCapture(e.pointerId)) {
          e.target.releasePointerCapture(e.pointerId);
        }
      } catch {
        // Ignore release errors
      }
    }

    calculateScratchedArea();
  };

  // Interaction safety: cancellation stops scratching cleanly and NEVER triggers an unsafe reveal
  const handlePointerCancel = (e) => {
    isScratchingRef.current = false;
    lastPointRef.current = null;

    if (e?.target && e.target.releasePointerCapture) {
      try {
        if (e.target.hasPointerCapture(e.pointerId)) {
          e.target.releasePointerCapture(e.pointerId);
        }
      } catch {
        // Ignore release errors
      }
    }
    // Do NOT run calculateScratchedArea() or scheduleReveal() on cancel
  };

  // Keyboard accessibility: Enter or Space to reveal, synchronizing with backend claim confirmation
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (isRevealed || isFadingOut || hasTriggeredRevealRef.current) return;

      // Start claim API call if not yet triggered (same lifecycle as first touch)
      triggerFirstScratchIfNeeded();

      // Trigger visual fadeout and auto-reveal via scheduleReveal (which awaits claim confirmation)
      setScratchedPercent(100);
      triggerHaptic([20, 40]);
      scheduleReveal(350);
    }
  };

  return (
    <div
      role="button"
      tabIndex={isRevealed || isFadingOut ? -1 : 0}
      aria-label="Festival scratch card. Scratch with finger, mouse, or press Enter to reveal."
      aria-valuenow={scratchedPercent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={`${scratchedPercent}% revealed`}
      onKeyDown={handleKeyDown}
      className="absolute inset-0 z-20 select-none touch-none focus:outline-hidden focus:ring-4 focus:ring-amber-400 rounded-2xl"
      style={{ width: `${width}px`, height: `${height}px` }}
    >
      {/* Top Foil Canvas */}
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        style={{
          width: `${width}px`,
          height: `${height}px`,
        }}
        className={`absolute inset-0 z-20 rounded-2xl cursor-grab active:cursor-grabbing shadow-lg transition-opacity duration-350 ${
          isFadingOut || isRevealed ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
      />

      {/* Scratched percentage indicator pill */}
      {!isRevealed && !isFadingOut && scratchedPercent > 5 && (
        <div
          aria-hidden="true"
          className="absolute top-3 right-3 z-30 px-2.5 py-1 bg-navy-950/75 backdrop-blur-md text-amber-300 rounded-full text-[11px] font-mono font-bold shadow-xs border border-amber-400/30"
        >
          {scratchedPercent}%
        </div>
      )}
    </div>
  );
}
