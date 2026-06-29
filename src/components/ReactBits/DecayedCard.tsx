import React, { useState } from 'react';
import { motion } from 'framer-motion';

interface DecayedCardProps {
  children: React.ReactNode;
  className?: string;
  glowColor?: string;
}

export const DecayedCard: React.FC<DecayedCardProps> = ({
  children,
  className = '',
  glowColor = 'rgba(168, 85, 247, 0.15)', // default purple glow
}) => {
  const [rotate, setRotate] = useState({ x: 0, y: 0 });
  const [glowPos, setGlowPos] = useState({ x: 50, y: 50 });

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const card = e.currentTarget;
    const box = card.getBoundingClientRect();
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    
    // Calculate tilt
    const centerX = box.width / 2;
    const centerY = box.height / 2;
    const rotateX = -(y - centerY) / 20; // Max tilt: 10 deg
    const rotateY = (x - centerX) / 20;

    // Calculate spotlight position
    const glowX = (x / box.width) * 100;
    const glowY = (y / box.height) * 100;

    setRotate({ x: rotateX, y: rotateY });
    setGlowPos({ x: glowX, y: glowY });
  };

  const handleMouseLeave = () => {
    setRotate({ x: 0, y: 0 });
    setGlowPos({ x: 50, y: 50 });
  };

  return (
    <motion.div
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      animate={{ rotateX: rotate.x, rotateY: rotate.y }}
      transition={{ type: 'spring', stiffness: 200, damping: 20 }}
      style={{
        transformStyle: 'preserve-3d',
        background: `radial-gradient(circle 250px at ${glowPos.x}% ${glowPos.y}%, ${glowColor}, transparent 80%), #121217`,
      }}
      className={`relative overflow-hidden rounded-2xl border border-neutral-800 bg-[#121217] p-6 shadow-2xl transition-all duration-300 hover:border-neutral-700 ${className}`}
    >
      <div style={{ transform: 'translateZ(10px)' }}>
        {children}
      </div>
    </motion.div>
  );
};
