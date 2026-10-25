import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';

export function BankCardScene() {
  const cardRef = useRef();

  useFrame((state) => {
    if (!cardRef.current) return;
    const t = state.clock.getElapsedTime();
    cardRef.current.rotation.y = Math.sin(t * 0.6) * 0.22;
    cardRef.current.rotation.x = Math.sin(t * 0.4) * 0.08 + 0.05;
    cardRef.current.position.y = Math.sin(t * 1.2) * 0.08;
  });

  return (
    <>
      <ambientLight intensity={1.2} />
      <directionalLight position={[5, 8, 6]} intensity={2.0} color="#ffffff" />
      <pointLight position={[-4, -2, -3]} intensity={0.8} color="#3b82f6" />
      <pointLight position={[3, 2, 4]} intensity={1.0} color="#f59e0b" />

      <group ref={cardRef}>
        <RoundedBox args={[3.2, 2.0, 0.04]} radius={0.12} smoothness={4}>
          <meshStandardMaterial
            color="#0b132b"
            roughness={0.25}
            metalness={0.75}
            envMapIntensity={1.2}
          />
        </RoundedBox>

        <RoundedBox args={[0.55, 0.42, 0.05]} radius={0.03} smoothness={2} position={[-1.0, 0.35, 0.025]}>
          <meshStandardMaterial color="#f59e0b" roughness={0.3} metalness={0.9} />
        </RoundedBox>

        <mesh position={[0, -0.4, 0.025]}>
          <planeGeometry args={[3.1, 0.04]} />
          <meshBasicMaterial color="#3b82f6" transparent opacity={0.6} />
        </mesh>
      </group>
    </>
  );
}

export default BankCardScene;
