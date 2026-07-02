'use client';

import { X, Printer } from 'lucide-react';
import { PrinterConfig } from './PrinterConfig';

/** Modal de impressão (acesso rápido a partir da Receção). */
export function PrinterSettings({
  storeName,
  onClose,
}: {
  storeName: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-espresso/60 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-fade-up max-h-[88vh] w-full max-w-md overflow-y-auto rounded-3xl bg-paper p-6 shadow-pop"
      >
        <div className="mb-5 flex items-center justify-between">
          <h3 className="flex items-center gap-2.5 font-display text-[19px] font-semibold">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-soft text-brand-dark">
              <Printer size={17} />
            </span>
            Impressão de pedidos
          </h3>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-full border border-line bg-white p-2 text-ink-soft transition-colors hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>
        <PrinterConfig storeName={storeName} />
      </div>
    </div>
  );
}
