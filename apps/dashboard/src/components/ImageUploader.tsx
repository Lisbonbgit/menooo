'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { uploadImage } from '@/lib/upload';

interface Props {
  value: string | null | undefined;
  /** Recebe o novo URL, ou null quando o dono remove a imagem. */
  onChange: (url: string | null) => unknown | Promise<unknown>;
  /** 'square' = miniatura (produto/logótipo); 'cover' = faixa larga. */
  variant?: 'square' | 'cover';
  /** Miniaturas: 'sm' (16) para listas, 'md' (24) para destaque. */
  size?: 'sm' | 'md';
  label?: string;
  hint?: string;
  /** Maior lado após compressão (px). */
  maxDim?: number;
}

export function ImageUploader({
  value,
  onChange,
  variant = 'square',
  size = 'md',
  label,
  hint,
  maxDim,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const isCover = variant === 'cover';

  async function pick(file?: File) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Escolhe um ficheiro de imagem (JPG, PNG, WebP ou GIF).');
      return;
    }
    setBusy(true);
    try {
      const url = await uploadImage(file, maxDim);
      await onChange(url);
      toast.success('Imagem carregada');
    } catch {
      toast.error('Não foi possível carregar a imagem.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const box = isCover
    ? 'aspect-[16/6] w-full'
    : size === 'sm'
      ? 'h-16 w-16'
      : 'h-24 w-24';

  return (
    <div className={isCover ? 'w-full' : 'shrink-0'}>
      {label && (
        <label className="mb-1.5 block text-[12.5px] font-medium text-ink-soft">{label}</label>
      )}
      <div
        className={
          'group relative overflow-hidden rounded-xl border border-line bg-cream/50 ' + box
        }
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-ink-mute">
            <ImagePlus size={isCover ? 22 : size === 'sm' ? 16 : 20} strokeWidth={1.6} />
            {isCover && <span className="text-[11.5px]">Adicionar foto de capa</span>}
          </div>
        )}

        {/* sobreposição de ação (aparece ao passar o rato ou enquanto carrega) */}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className={
            'absolute inset-0 flex items-center justify-center bg-espresso/50 text-[12px] font-medium text-cream transition-opacity ' +
            (busy ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')
          }
        >
          {busy ? (
            <Loader2 className="animate-spin" size={18} />
          ) : (
            <span>{value ? 'Alterar' : 'Carregar'}</span>
          )}
        </button>

        {value && !busy && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="absolute right-1.5 top-1.5 z-10 rounded-full bg-espresso/70 p-1 text-cream opacity-0 transition-opacity group-hover:opacity-100"
            title="Remover imagem"
          >
            <X size={13} />
          </button>
        )}
      </div>
      {hint && <p className="mt-1 text-[11.5px] text-ink-mute">{hint}</p>}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => pick(e.target.files?.[0])}
      />
    </div>
  );
}
