'use client';

import { useEffect, useState } from 'react';
import { Loader2, MapPin, ExternalLink } from 'lucide-react';

interface Coords {
  lat: number;
  lon: number;
}

/**
 * Mostra a morada escrita num mapa (OpenStreetMap, grátis, sem chave) para o
 * cliente confirmar que o local está certo. Geocodifica via Nominatim com
 * debounce; se não encontrar, avisa para completar a morada.
 */
export function AddressMap({ query }: { query: string }) {
  const [coords, setCoords] = useState<Coords | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'notfound'>('idle');

  useEffect(() => {
    const q = query.trim();
    if (q.length < 8) {
      setStatus('idle');
      setCoords(null);
      return;
    }
    setStatus('loading');
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=pt&q=${encodeURIComponent(
          q,
        )}`;
        const res = await fetch(url, { signal: ctrl.signal, headers: { 'Accept-Language': 'pt' } });
        const data = (await res.json()) as { lat: string; lon: string }[];
        if (data?.[0]) {
          setCoords({ lat: Number(data[0].lat), lon: Number(data[0].lon) });
          setStatus('ok');
        } else {
          setCoords(null);
          setStatus('notfound');
        }
      } catch {
        // pedido cancelado ou erro de rede — mantém o estado anterior
      }
    }, 900);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  if (status === 'idle') return null;

  if (status === 'loading') {
    return (
      <div className="flex h-16 items-center justify-center gap-2 rounded-xl border border-line bg-cream/60 text-[12.5px] text-ink-mute">
        <Loader2 size={15} className="animate-spin" /> A localizar a morada…
      </div>
    );
  }

  if (status === 'notfound' || !coords) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12.5px] text-amber-800">
        <MapPin size={15} className="shrink-0" />
        Não encontrámos a morada no mapa — confirma que está completa (rua, número, código postal).
      </div>
    );
  }

  const d = 0.004;
  const bbox = `${coords.lon - d},${coords.lat - d},${coords.lon + d},${coords.lat + d}`;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${coords.lat},${coords.lon}`;
  const full = `https://www.openstreetmap.org/?mlat=${coords.lat}&mlon=${coords.lon}#map=18/${coords.lat}/${coords.lon}`;

  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <iframe title="Mapa da morada de entrega" src={src} className="h-44 w-full" loading="lazy" />
      <div className="flex items-center justify-between gap-2 bg-white px-3 py-2 text-[11.5px] text-ink-mute">
        <span className="flex items-center gap-1.5">
          <MapPin size={13} className="text-brand" /> Confirma que o pino está no local certo.
        </span>
        <a
          href={full}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 font-medium text-brand-dark hover:underline"
        >
          Ver maior <ExternalLink size={12} />
        </a>
      </div>
    </div>
  );
}
