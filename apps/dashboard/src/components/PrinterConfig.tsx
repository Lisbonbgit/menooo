'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { RefreshCw, Printer, CheckCircle2, XCircle } from 'lucide-react';
import { usePrintStore } from '@/lib/print-store';
import { listPrinters } from '@/lib/qz';
import { printOrder } from '@/lib/print';
import { isNativeApp } from '@/lib/kitchen-printer';
import type { Order } from '@/lib/types';

const SAMPLE: Order = {
  id: 'sample',
  number: 0,
  status: 'PENDING',
  type: 'DELIVERY',
  customerName: 'Cliente Teste',
  customerPhone: '912 345 678',
  customerEmail: 'cliente@exemplo.pt',
  marketingConsent: true,
  deliveryAddress: 'Rua de Teste 1, 3º Esq.',
  deliveryCity: 'Lisboa',
  deliveryZipCode: '1000-100',
  notes: 'Sem cebola',
  scheduledFor: null,
  subtotal: '11.50',
  deliveryFee: '2.50',
  discount: '1.15',
  couponCode: 'BEMVINDO10',
  total: '12.85',
  vatTotal: '2.41',
  paymentMethod: 'CASH',
  changeFor: '20.00',
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

/** Configuração de impressão de pedidos (QZ Tray + fallback do browser). */
export function PrinterConfig({ storeName }: { storeName: string }) {
  const {
    printerName,
    autoPrint,
    width,
    setPrinter,
    setAutoPrint,
    setWidth,
    printerIp,
    printerPort,
    setPrinterIp,
    setPrinterPort,
  } = usePrintStore();
  const native = isNativeApp();
  const [printers, setPrinters] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [qzStatus, setQzStatus] = useState<'unknown' | 'ok' | 'missing'>('unknown');

  async function detect() {
    setLoading(true);
    try {
      const found = await listPrinters();
      setPrinters(found);
      setQzStatus('ok');
      toast.success(
        found.length > 0
          ? `${found.length} impressora(s) encontrada(s)`
          : 'QZ Tray ligado, mas sem impressoras no sistema',
      );
    } catch {
      setQzStatus('missing');
      toast.error('QZ Tray não encontrado neste computador.');
    } finally {
      setLoading(false);
    }
  }

  async function testPrint() {
    try {
      const via = await printOrder({ ...SAMPLE }, storeName);
      if (via === 'unconfigured') {
        toast.error('Preenche o IP da impressora primeiro.');
        return;
      }
      toast.success(
        via === 'native'
          ? 'Talão de teste enviado para a impressora de rede'
          : via === 'qz'
            ? 'Talão de teste enviado para a térmica'
            : 'Talão aberto no browser',
      );
    } catch (e: any) {
      toast.error(e?.message ?? 'Erro ao imprimir');
    }
  }

  return (
    <div className="space-y-4">
      {!native && (
        <>
          {/* estado / deteção */}
          <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-cream/40 px-3.5 py-3">
            <div className="flex items-center gap-2 text-[12.5px]">
              {qzStatus === 'ok' && (
                <>
                  <CheckCircle2 size={15} className="text-green-600" />
                  <span className="text-ink-soft">QZ Tray ligado neste computador</span>
                </>
              )}
              {qzStatus === 'missing' && (
                <>
                  <XCircle size={15} className="text-red-500" />
                  <span className="text-ink-soft">
                    QZ Tray não encontrado —{' '}
                    <a
                      href="https://qz.io/download/"
                      target="_blank"
                      className="font-medium text-brand underline"
                    >
                      instalar
                    </a>{' '}
                    para usar impressora térmica
                  </span>
                </>
              )}
              {qzStatus === 'unknown' && (
                <span className="text-ink-soft">
                  Liga a impressora térmica através do <strong>QZ Tray</strong> (programa gratuito no
                  computador do balcão).
                </span>
              )}
            </div>
            <button
              onClick={detect}
              disabled={loading}
              className="flex shrink-0 items-center gap-1.5 rounded-xl border border-line bg-white px-3 py-2 text-[12.5px] font-semibold shadow-card transition-colors hover:border-brand/40"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              Detetar impressoras
            </button>
          </div>

          {/* impressora */}
          <div className="space-y-1.5">
            <label className="block text-[12.5px] font-medium text-ink-soft">Impressora</label>
            <select
              value={printerName ?? ''}
              onChange={(e) => setPrinter(e.target.value || null)}
              className="w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-[13.5px] outline-none focus:border-brand"
            >
              <option value="">— Impressão pelo browser (sem QZ Tray) —</option>
              {printers.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
              {printerName && !printers.includes(printerName) && (
                <option value={printerName}>{printerName} (guardada)</option>
              )}
            </select>
            <p className="text-[11.5px] text-ink-mute">
              Sem impressora selecionada, o talão abre numa janela para imprimir em qualquer
              impressora.
            </p>
          </div>
        </>
      )}

      {native && (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-[12.5px] font-medium text-ink-soft">
              IP da impressora de rede
            </label>
            <div className="flex gap-2">
              <input
                value={printerIp ?? ''}
                onChange={(e) => setPrinterIp(e.target.value.trim() || null)}
                placeholder="192.168.1.50"
                inputMode="decimal"
                className="min-w-0 flex-1 rounded-xl border border-line bg-white px-3.5 py-2.5 font-mono text-[14px] outline-none focus:border-brand"
              />
              <input
                value={printerPort}
                onChange={(e) => setPrinterPort(Number(e.target.value) || 9100)}
                inputMode="numeric"
                className="w-24 rounded-xl border border-line bg-white px-3.5 py-2.5 text-center font-mono text-[14px] outline-none focus:border-brand"
              />
            </div>
            <p className="text-[11.5px] leading-snug text-ink-mute">
              O tablet e a impressora têm de estar na mesma rede Wi-Fi (sem rede de
              convidados). Recomenda-se fixar o IP da impressora no router (reserva DHCP),
              senão pode mudar quando o router reinicia.
            </p>
          </div>
        </div>
      )}

      {/* largura do talão */}
      <div className="space-y-1.5">
        <label className="block text-[12.5px] font-medium text-ink-soft">Largura do talão</label>
        <div className="flex gap-2">
          {[
            { w: 42, label: '80 mm (normal)' },
            { w: 32, label: '58 mm (estreito)' },
          ].map(({ w, label }) => (
            <button
              key={w}
              onClick={() => setWidth(w)}
              className={
                'flex-1 rounded-xl border py-2.5 text-[13px] font-semibold transition-all ' +
                (width === w
                  ? 'border-brand bg-brand text-white shadow-card'
                  : 'border-line bg-white text-ink-soft hover:border-brand/40')
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* auto-impressão */}
      <div className="flex items-center justify-between rounded-xl border border-line px-3.5 py-3">
        <div>
          <p className="text-[13.5px] font-medium">Imprimir automaticamente</p>
          <p className="text-[11.5px] text-ink-mute">
            Cada nova encomenda sai logo na impressora, sem cliques.
          </p>
          <p className="mt-2 text-[11.5px] leading-snug text-amber-700">
            Liga a impressão automática só num dispositivo — com dois ligados saem dois
            talões por encomenda.
          </p>
        </div>
        <button
          onClick={() => setAutoPrint(!autoPrint)}
          aria-label="Alternar impressão automática"
          className={
            'relative h-7 w-12 shrink-0 rounded-full transition-colors ' +
            (autoPrint ? 'bg-green-500' : 'bg-stone-300')
          }
        >
          <span
            className={
              'absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ' +
              (autoPrint ? 'left-6' : 'left-1')
            }
          />
        </button>
      </div>

      <button
        onClick={testPrint}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-3 text-[13.5px] font-semibold text-white shadow-card transition-colors hover:bg-brand-dark"
      >
        <Printer size={16} /> Imprimir talão de teste
      </button>
    </div>
  );
}
