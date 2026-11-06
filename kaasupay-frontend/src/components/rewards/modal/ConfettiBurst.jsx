import { useEffect, useRef } from 'react';

/**
 * High-performance full-screen particle confetti explosion with gold coins,
 * holographic ribbons, and twinkling sparkles.
 */
export default function ConfettiBurst({ onComplete }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let animationFrameId;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const colors = ['#f59e0b', '#fbbf24', '#e11d48', '#3b82f6', '#10b981', '#8b5cf6', '#ec4899'];
    const particleCount = 140;
    const particles = [];

    const centerX = canvas.width / 2;
    const centerY = canvas.height * 0.45;

    for (let i = 0; i < particleCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 12 + 6;
      const isCoin = Math.random() > 0.65;

      particles.push({
        x: centerX,
        y: centerY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (Math.random() * 6 + 4),
        radius: isCoin ? Math.random() * 6 + 6 : Math.random() * 4 + 3,
        width: Math.random() * 12 + 6,
        height: Math.random() * 6 + 3,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.25,
        alpha: 1,
        decay: Math.random() * 0.008 + 0.006,
        gravity: 0.35,
        isCoin,
      });
    }

    let isRunning = true;

    function render() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let aliveCount = 0;

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        if (p.alpha <= 0) continue;

        aliveCount++;
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.gravity;
        p.vx *= 0.985;
        p.rotation += p.rotationSpeed;
        p.alpha -= p.decay;

        ctx.save();
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);

        if (p.isCoin) {
          // Gold coin
          ctx.beginPath();
          ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
          ctx.fillStyle = '#f59e0b';
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = '#fef3c7';
          ctx.stroke();

          // Coin inner crest
          ctx.font = 'bold 9px sans-serif';
          ctx.fillStyle = '#78350f';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('₹', 0, 0);
        } else {
          // Ribbon
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.width / 2, -p.height / 2, p.width, p.height);
        }

        ctx.restore();
      }

      if (aliveCount > 0 && isRunning) {
        animationFrameId = requestAnimationFrame(render);
      } else if (onComplete) {
        onComplete();
      }
    }

    render();

    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    return () => {
      isRunning = false;
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
    };
  }, [onComplete]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-50 w-full h-full"
    />
  );
}
