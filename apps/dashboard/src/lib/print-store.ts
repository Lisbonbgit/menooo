'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface PrintState {
  printerName: string | null; // impressora QZ selecionada
  autoPrint: boolean; // imprimir automaticamente cada nova encomenda
  width: number; // largura do talão: 42 (80mm) ou 32 (58mm)
  setPrinter: (name: string | null) => void;
  setAutoPrint: (v: boolean) => void;
  setWidth: (w: number) => void;
}

export const usePrintStore = create<PrintState>()(
  persist(
    (set) => ({
      printerName: null,
      autoPrint: false,
      width: 42,
      setPrinter: (printerName) => set({ printerName }),
      setAutoPrint: (autoPrint) => set({ autoPrint }),
      setWidth: (width) => set({ width }),
    }),
    { name: 'comanda-print' },
  ),
);
