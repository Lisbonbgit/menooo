'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { X, Printer, RefreshCw } from 'lucide-react';
import { usePrintStore } from '@/lib/print-store';
import { listPrinters } from '@/lib/qz';
import { printOrder } from '@/lib/print';
import type { Order } from '@/lib/types';

const SAMPLE: Order = {
  id: 'sample',
  number: 0,
  status: 'PENDING',
  type: 'DELIVERY',
  customerName: 'Cliente Teste',
  customerPhone: '912 345 678',
  deliveryAddress: 'Rua de Teste 1, Lisboa',
  notes: 'Sem cebola',
  subtotal: '11.50',
  deliveryFee: '2.50',
  total: '14.00',
  paymentMethod: 'CASH',
  createdAt: new Date().toISOString(),
  items: [
    {
      id: 'i1',
      name: 'Pizza Margherita',
      quantity: 1,
      unitPrice: '11.50',
      total: '11.50',
      modifiers: [{ id: 'm1', name: 'Grande', priceDelta: '3.00' }],
    },
  ],
};

export function PrinterSettings({ storeName, onClose }: { storeName: string; onClose: () => void }) {
  const { printerName, autoPrint, width, setPrinter, setAutoPrint, setWidth } = usePrintStore();
  const [printers, setPrinters] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  async function detect() {
    setLoading(true);
    try {
      const found = await listPrinters();
      setPrinters(found);
      toast.success(`${found.length} impressora(s) encontrada(s)`);
    } catch {
      toast.error('QZ Tray não disponível. Instala o QZ Tray no balcão ou usa a impressão do browser.');
    } finally {
      setLoading(false);
    }
  }

  async function testPrint() {
    try {
      const via = await printOrder({ ...SAMPLE, storeName } as never, storeName);
      toast.success(via === 'qz' ? 'Enviado para a térmica' : 'Aberto no browser para impressão');
    } catch (e: any) {
      toast.error(e?.message ?? 'Erro ao imprimir');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-bold">
            <Printer size={20} /> Impressão
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X size={22} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-sm font-medium">Impressora térmica (QZ Tray)</label>
              <button
                onClick={detect}
                disabled={loading}
                className="flex items-center gap-1 text-xs text-brand hover:underline"
              >
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Detetar
              </button>
            </div>
            <select
              value={printerName ?? ''}
              onChange={(e) => setPrinter(e.target.value || null)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">— Usar impressão do browser —</option>
              {printers.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
              {printerName && !printers.includes(printerName) && (
                <option value={printerName}>{printerName} (guardada)</option>
              )}
            </select>
            <p className="mt-1 text-xs text-gray-400">
              Sem QZ Tray, o talão abre no browser para impressão normal.
            </p>
          </div>

          <div>
            <label className="text-sm font-medium">Largura do talão</label>
            <div className="mt-1 flex gap-2">
              {[42, 32].map((w) => (
                <button
                  key={w}
                  onClick={() => setWidth(w)}
                  className={
                    'flex-1 rounded-lg border py-1.5 text-sm ' +
                    (width === w ? 'border-brand bg-brand text-white' : 'border-gray-300')
                  }
                >
                  {w === 42 ? '80mm' : '58mm'}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoPrint}
              onChange={(e) => setAutoPrint(e.target.checked)}
            />
            Imprimir automaticamente cada nova encomenda
          </label>

          <button
            onClick={testPrint}
            className="w-full rounded-lg bg-brand py-2.5 font-medium text-white hover:bg-brand-dark"
          >
            Imprimir talão de teste
          </button>
        </div>
      </div>
    </div>
  );
}
