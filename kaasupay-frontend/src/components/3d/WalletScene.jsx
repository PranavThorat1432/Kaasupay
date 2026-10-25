import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Float, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';

function PaymentCard() {
  const cardGroupRef = useRef();

  useFrame((state, delta) => {
    if (!cardGroupRef.current) return;
    const t = state.clock.getElapsedTime();
    
    // Smooth pointer-responsive parallax with damping
    const targetRotY = (state.pointer.x * 0.35) + Math.sin(t * 0.6) * 0.12;
    const targetRotX = -(state.pointer.y * 0.25) + 0.08 + Math.cos(t * 0.5) * 0.05;
    
    cardGroupRef.current.rotation.y = THREE.MathUtils.damp(
      cardGroupRef.current.rotation.y,
      targetRotY,
      4,
      delta
    );
    cardGroupRef.current.rotation.x = THREE.MathUtils.damp(
      cardGroupRef.current.rotation.x,
      targetRotX,
      4,
      delta
    );
  });

  return (
    <Float speed={1.6} rotationIntensity={0.15} floatIntensity={0.35}>
      <group ref={cardGroupRef}>
        {/* Physical Card Body (Standard ISO/IEC 7810 ID-1 ratio ~ 1.586) */}
        <RoundedBox args={[3.38, 2.14, 0.08]} radius={0.12} smoothness={4}>
          <meshStandardMaterial
            color="#0f2b5c"
            metalness={0.78}
            roughness={0.22}
            envMapIntensity={1.5}
          />
        </RoundedBox>

        {/* Sapphire Metallic Face Sheen */}
        <mesh position={[0, 0, 0.042]}>
          <planeGeometry args={[3.34, 2.1]} />
          <meshStandardMaterial
            color="#1d4ed8"
            metalness={0.85}
            roughness={0.18}
            transparent
            opacity={0.3}
          />
        </mesh>

        {/* Real Gold EMV Security Chip */}
        <group position={[-1.0, 0.35, 0.046]}>
          <RoundedBox args={[0.62, 0.46, 0.02]} radius={0.03} smoothness={2}>
            <meshStandardMaterial
              color="#d97706"
              metalness={0.92}
              roughness={0.25}
              emissive="#b45309"
              emissiveIntensity={0.15}
            />
          </RoundedBox>
          {/* Chip circuit contact divider */}
          <mesh position={[0, 0, 0.012]}>
            <planeGeometry args={[0.54, 0.02]} />
            <meshBasicMaterial color="#78350f" />
          </mesh>
          <mesh position={[0, 0, 0.012]}>
            <planeGeometry args={[0.02, 0.38]} />
            <meshBasicMaterial color="#78350f" />
          </mesh>
        </group>

        {/* Contactless Waves Symbol */}
        <group position={[-0.45, 0.35, 0.046]}>
          <mesh position={[0, 0, 0]}>
            <ringGeometry args={[0.08, 0.10, 16, 1, -Math.PI / 3, (2 * Math.PI) / 3]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.8} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0.05, 0, 0]}>
            <ringGeometry args={[0.13, 0.15, 16, 1, -Math.PI / 3, (2 * Math.PI) / 3]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.65} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0.10, 0, 0]}>
            <ringGeometry args={[0.18, 0.20, 16, 1, -Math.PI / 3, (2 * Math.PI) / 3]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.5} side={THREE.DoubleSide} />
          </mesh>
        </group>

        {/* Holographic Security Foil Badge (Top Right) */}
        <mesh position={[1.15, 0.65, 0.045]}>
          <circleGeometry args={[0.22, 32]} />
          <meshStandardMaterial
            color="#38bdf8"
            metalness={0.9}
            roughness={0.1}
            emissive="#0284c7"
            emissiveIntensity={0.3}
          />
        </mesh>

        {/* Secondary Overlapping Security Ring */}
        <mesh position={[0.95, 0.65, 0.045]}>
          <circleGeometry args={[0.22, 32]} />
          <meshStandardMaterial
            color="#818cf8"
            metalness={0.9}
            roughness={0.1}
            emissive="#4f46e5"
            emissiveIntensity={0.25}
            transparent
            opacity={0.8}
          />
        </mesh>

        {/* Embossed Masked Card Number Bar */}
        <mesh position={[-0.1, -0.15, 0.044]}>
          <planeGeometry args={[2.4, 0.12]} />
          <meshStandardMaterial color="#ffffff" transparent opacity={0.4} />
        </mesh>

        {/* Cardholder Name Bar */}
        <mesh position={[-0.55, -0.6, 0.044]}>
          <planeGeometry args={[1.5, 0.08]} />
          <meshStandardMaterial color="#ffffff" transparent opacity={0.35} />
        </mesh>

        {/* Expiry Pill */}
        <mesh position={[0.9, -0.6, 0.044]}>
          <planeGeometry args={[0.6, 0.08]} />
          <meshStandardMaterial color="#ffffff" transparent opacity={0.35} />
        </mesh>

        {/* Bottom Cyan Edge Glow Accent */}
        <mesh position={[0, -1.02, 0.043]}>
          <planeGeometry args={[3.1, 0.03]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.7} />
        </mesh>
      </group>
    </Float>
  );
}

export function WalletScene() {
  return (
    <>
      <ambientLight intensity={1.1} />
      {/* Key light for primary reflection */}
      <directionalLight position={[4, 6, 6]} intensity={2.2} color="#ffffff" />
      {/* Soft cyan fill light */}
      <pointLight position={[-4, -2, 3]} intensity={1.8} color="#38bdf8" />
      {/* Warm amber rim light for edge separation */}
      <pointLight position={[3, -3, -2]} intensity={1.4} color="#f59e0b" />
      {/* Deep cobalt backlight */}
      <pointLight position={[0, 4, -4]} intensity={1.5} color="#1d4ed8" />
      <PaymentCard />
    </>
  );
}

export default WalletScene;
