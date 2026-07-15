'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface PrintState {
  printerName: string | null; // impressora QZ selecionada (desktop)
  printerIp: string | null; // impressora de rede (app de cozinha, TCP 9100)
  printerPort: number; // porta TCP da impressora de rede
  autoPrint: boolean; // imprimir automaticamente cada nova encomenda
  width: number; // largura do talão: 42 (80mm) ou 32 (58mm)
  pendingPrints: string[]; // ids de encomendas cuja (auto)impressão falhou
  setPrinter: (name: string | null) => void;
  setPrinterIp: (ip: string | null) => void;
  setPrinterPort: (port: number) => void;
  setAutoPrint: (v: boolean) => void;
  setWidth: (w: number) => void;
  addPendingPrint: (id: string) => void;
  removePendingPrint: (id: string) => void;
}

export const usePrintStore = create<PrintState>()(
  persist(
    (set) => ({
      printerName: null,
      printerIp: null,
      printerPort: 9100,
      autoPrint: false,
      width: 42,
      pendingPrints: [],
      setPrinter: (printerName) => set({ printerName }),
      setPrinterIp: (printerIp) => set({ printerIp }),
      setPrinterPort: (printerPort) => set({ printerPort }),
      setAutoPrint: (autoPrint) => set({ autoPrint }),
      setWidth: (width) => set({ width }),
      addPendingPrint: (id) =>
        set((s) => (s.pendingPrints.includes(id) ? s : { pendingPrints: [...s.pendingPrints, id] })),
      removePendingPrint: (id) =>
        set((s) => ({ pendingPrints: s.pendingPrints.filter((x) => x !== id) })),
    }),
    { name: 'menoo-print' },
  ),
);
