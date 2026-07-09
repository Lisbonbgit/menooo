'use client';

import { api } from './api';

/**
 * Redimensiona/comprime a imagem no browser antes de enviar — poupa dados do
 * dono e espaço no servidor, e acelera o carregamento na loja. GIFs passam
 * intactos (para não perder a animação). Se algo falhar, envia o original.
 */
async function compress(file: File, maxDim: number, quality = 0.82): Promise<Blob> {
  if (file.type === 'image/gif') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob(res, 'image/jpeg', quality),
    );
    return blob ?? file;
  } catch {
    return file;
  }
}

/** Comprime e envia a imagem; devolve o URL público guardado no servidor. */
export async function uploadImage(file: File, maxDim = 1400): Promise<string> {
  const blob = await compress(file, maxDim);
  const isGif = blob === file && file.type === 'image/gif';
  const form = new FormData();
  form.append('file', blob, isGif ? file.name : 'foto.jpg');
  const { data } = await api.post<{ url: string }>('/uploads', form);
  return data.url;
}
