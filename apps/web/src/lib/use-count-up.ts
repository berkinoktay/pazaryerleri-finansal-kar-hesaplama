'use client';

import * as React from 'react';

import { useIsMounted } from '@/lib/use-is-mounted';

/** Count-up duration (ms). Deliberately longer than micro-transitions (220ms). */
export const COUNT_UP_DURATION_MS = 700;

const easeOutQuart = (t: number): number => 1 - Math.pow(1 - t, 4);

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface UseCountUpOptions {
  durationMs?: number;
  /** Count from 0 on the first mount (default true); false → first value is shown without a tween. */
  animateOnMount?: boolean;
}

/**
 * Tweens a number from `from → target` with requestAnimationFrame. SSR and the
 * first hydration render return the target (deterministic, hydration-safe). On
 * the first mount it counts from 0 (when animateOnMount), and on later changes
 * from the last displayed value to the new target. Honors prefers-reduced-motion
 * (snaps to target). Display-only — the final frame is the exact target, so no
 * money is computed here (callers format the returned number).
 */
export function useCountUp(target: number, options: UseCountUpOptions = {}): number {
  const { durationMs = COUNT_UP_DURATION_MS, animateOnMount = true } = options;
  const mounted = useIsMounted();

  // Mount'ta display'i HEDEF değil BAŞLANGIÇ değeriyle başlat (animateOnMount → 0).
  // Böylece: (a) ilk boya hedefi 1-kare "flaş"lamaz, (b) StrictMode mount effect'i
  // iki kez çalıştırsa bile displayRef 0'da kalır → ikinci çalışma da 0→target
  // tween'ler. (Eskiden displayRef=target ile başlıyordu; StrictMode'un attığı ilk
  // çalışma firstRunRef'i tüketip RAF'ı iptal ettiğinden ikinci çalışma from=target
  // görüp SNAP ediyordu → mount'ta animasyon kaçıyordu.) SSR/hydration güvenliği
  // aşağıdaki `return mounted ? display : target` ile korunur (mounted=false → target).
  const initialDisplay = animateOnMount ? 0 : target;
  const [display, setDisplay] = React.useState(initialDisplay);
  const displayRef = React.useRef(initialDisplay);
  const frameRef = React.useRef<number | null>(null);
  const firstRunRef = React.useRef(true);

  const set = React.useCallback((value: number): void => {
    displayRef.current = value;
    setDisplay(value);
  }, []);

  React.useEffect(() => {
    if (!mounted) return undefined;

    const reduce = prefersReducedMotion();
    const from = firstRunRef.current && animateOnMount && !reduce ? 0 : displayRef.current;
    firstRunRef.current = false;

    const cleanup = (): void => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };

    // Snap cases (reduced motion, or already at the target): defer the write to a
    // frame so we never call setState synchronously inside the effect (React
    // Compiler: avoids cascading renders). No-op when already showing the target.
    if (reduce || from === target) {
      if (displayRef.current !== target) {
        frameRef.current = requestAnimationFrame(() => set(target));
      }
      return cleanup;
    }

    const start = performance.now();
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / durationMs);
      if (t < 1) {
        set(from + (target - from) * easeOutQuart(t));
        frameRef.current = requestAnimationFrame(tick);
      } else {
        set(target);
      }
    };
    frameRef.current = requestAnimationFrame(tick);

    return cleanup;
  }, [mounted, target, durationMs, animateOnMount, set]);

  return mounted ? display : target;
}
