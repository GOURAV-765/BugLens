import React from 'react';

interface ShinyTextProps {
  text: string;
  disabled?: boolean;
  speed?: number;
  className?: string;
}

export const ShinyText: React.FC<ShinyTextProps> = ({
  text,
  disabled = false,
  className = '',
}) => {
  const animationStyle = disabled
    ? {}
    : {
        backgroundSize: '200% auto',
      };

  return (
    <span
      style={animationStyle}
      className={`inline-block text-transparent bg-clip-text bg-gradient-to-r from-neutral-400 via-white to-neutral-400 ${
        disabled ? '' : 'animate-shine'
      } ${className}`}
    >
      {text}
    </span>
  );
};
