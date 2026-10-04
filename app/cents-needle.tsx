'use client';

import { useEffect, useRef } from 'react';

// Spring tuned to be underdamped so the needle overshoots and settles like an analog meter.
const STIFFNESS = 140;
const DAMPING = 11;
const TREMOR = 0.6; // cents of idle wobble while a note is heard

interface Props {
  /** Offset from target in cents, or null when nothing is heard (needle rests at center). */
  cents: number | null;
  className: string;
}

export default function CentsNeedle({ cents, className }: Props) {
  const needleRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<number | null>(cents);

  useEffect(() => {
    targetRef.current = cents;
  }, [cents]);

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let position = 0;
    let velocity = 0;
    let last = performance.now();
    let frame: number;

    const step = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.032);
      last = now;
      const t = now / 1000;
      const heard = targetRef.current;
      let target = heard === null ? 0 : Math.max(-50, Math.min(50, heard));

      if (reduceMotion) {
        position = target;
      } else {
        if (heard !== null) {
          target += TREMOR * (Math.sin(t * 7.1) + 0.6 * Math.sin(t * 13.7 + 1.3));
        }
        velocity += (-STIFFNESS * (position - target) - DAMPING * velocity) * dt;
        position += velocity * dt;
      }

      if (needleRef.current) {
        needleRef.current.style.left = `${50 + Math.max(-52, Math.min(52, position))}%`;
      }
      frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      ref={needleRef}
      className={`absolute top-0 bottom-0 w-1 -ml-0.5 rounded-full transition-colors duration-200 ${className}`}
      style={{ left: '50%' }}
    />
  );
}
