'use client';

// ============================================================================
// Cliente QZ Tray. QZ Tray é um pequeno agente instalado no PC/tablet do balcão
// que expõe um WebSocket local e fala com a impressora térmica.
// Carregamos o script qz-tray.js dinamicamente e usamos o global `window.qz`.
// ============================================================================

import { toBase64 } from './escpos';

// URL do script qz-tray.js. Por defeito CDN; podes servir localmente em /public
// definindo NEXT_PUBLIC_QZ_SCRIPT_URL=/qz-tray.js para funcionar offline.
const QZ_SCRIPT_URL =
  process.env.NEXT_PUBLIC_QZ_SCRIPT_URL ?? 'https://cdn.jsdelivr.net/npm/qz-tray@2.2.4/qz-tray.js';

interface QzGlobal {
  websocket: {
    isActive(): boolean;
    connect(opts?: unknown): Promise<void>;
    disconnect(): Promise<void>;
  };
  printers: { find(): Promise<string[]>; getDefault(): Promise<string> };
  configs: { create(printer: string, opts?: unknown): unknown };
  print(config: unknown, data: unknown): Promise<void>;
}

declare global {
  interface Window {
    qz?: QzGlobal;
  }
}

let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('sem window'));
  if (window.qz) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = QZ_SCRIPT_URL;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error('Falha a carregar o qz-tray.js'));
    document.head.appendChild(el);
  });
  return scriptPromise;
}

export function isQzAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.qz;
}

/** Garante script carregado + ligação ativa ao QZ Tray. */
export async function ensureConnected(): Promise<void> {
  await loadScript();
  const qz = window.qz!;
  if (!qz.websocket.isActive()) {
    await qz.websocket.connect();
  }
}

export async function listPrinters(): Promise<string[]> {
  await ensureConnected();
  return window.qz!.printers.find();
}

export async function getDefaultPrinter(): Promise<string> {
  await ensureConnected();
  return window.qz!.printers.getDefault();
}

/** Envia bytes ESC/POS crus para a impressora indicada. */
export async function printRawBytes(printer: string, bytes: Uint8Array): Promise<void> {
  await ensureConnected();
  const qz = window.qz!;
  const config = qz.configs.create(printer, { encoding: 'CP858' });
  const data = [{ type: 'raw', format: 'command', flavor: 'base64', data: toBase64(bytes) }];
  await qz.print(config, data);
}
