'use client';

import { useEffect } from 'react';

/**
 * Aplica as cores escolhidas pelo dono à montra: define as variáveis CSS que
 * o Tailwind consome (ver tailwind.config.ts). Sem cores definidas, remove as
 * variáveis e a loja volta ao tema Menooo. Os tons derivados (hover, fundos
 * suaves, texto sobre fundo suave) são calculados a partir da cor base.
 */

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mistura a cor com um alvo (0 = preto, 255 = branco) na fração f. */
const mix = (c: Rgb, target: number, f: number): Rgb =>
  c.map((v) => Math.round(v + (target - v) * f)) as Rgb;

const triplet = (c: Rgb) => c.join(' ');

const ALL_VARS = [
  '--store-brand',
  '--store-brand-dark',
  '--store-brand-soft',
  '--store-brand-ink',
  '--store-hero',
  '--store-hero-light',
];

export function StoreTheme({
  brandColor,
  heroColor,
}: {
  brandColor: string | null;
  heroColor: string | null;
}) {
  useEffect(() => {
    const root = document.documentElement;
    const brand = brandColor ? hexToRgb(brandColor) : null;
    const hero = heroColor ? hexToRgb(heroColor) : null;

    if (brand) {
      root.style.setProperty('--store-brand', triplet(brand));
      root.style.setProperty('--store-brand-dark', triplet(mix(brand, 0, 0.18)));
      root.style.setProperty('--store-brand-soft', triplet(mix(brand, 255, 0.88)));
      root.style.setProperty('--store-brand-ink', triplet(mix(brand, 0, 0.45)));
    } else {
      for (const v of ALL_VARS.slice(0, 4)) root.style.removeProperty(v);
    }

    if (hero) {
      root.style.setProperty('--store-hero', triplet(hero));
      root.style.setProperty('--store-hero-light', triplet(mix(hero, 255, 0.08)));
    } else {
      root.style.removeProperty('--store-hero');
      root.style.removeProperty('--store-hero-light');
    }

    return () => {
      for (const v of ALL_VARS) root.style.removeProperty(v);
    };
  }, [brandColor, heroColor]);

  return null;
}
