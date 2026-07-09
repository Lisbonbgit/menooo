'use client';

import type { Order } from './types';
import { buildReceiptBytes } from './escpos';
import { printRawBytes } from './qz';
import { usePrintStore } from './print-store';

const eur = (v: string | number) => `${Number(v).toFixed(2)} €`;

const PAYMENT_LABELS: Record<string, string> = {
  CASH: 'Dinheiro',
  CARD_ON_DELIVERY: 'Cartão na entrega',
  MBWAY: 'MB WAY',
  CARD_ONLINE: 'Cartão online',
};

/** Talão em HTML para o fallback de impressão do browser. */
export function receiptHtml(order: Order, storeName: string): string {
  const rows = order.items
    .map(
      (it) => `
      <tr><td>${it.quantity}× ${esc(it.name)}</td><td class="r">${eur(it.total)}</td></tr>
      ${it.modifiers
        .map((m) => `<tr><td class="sub">+ ${esc(m.name)}</td><td></td></tr>`)
        .join('')}`,
    )
    .join('');

  return `<!doctype html><html><head><meta charset="utf-8"><title>Encomenda #${order.number}</title>
  <style>
    @page { margin: 4mm; }
    body { font-family: monospace; width: 280px; margin: 0 auto; color: #000; }
    h1 { font-size: 16px; text-align: center; margin: 0 0 4px; }
    .center { text-align: center; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    td.r { text-align: right; white-space: nowrap; }
    td.sub { color: #333; padding-left: 10px; font-size: 11px; }
    hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
    .total { font-weight: bold; font-size: 14px; }
  </style></head><body onload="window.print()">
    <h1>${esc(storeName)}</h1>
    <div class="center">${order.type === 'DELIVERY' ? 'ENTREGA' : 'TAKE-AWAY'}</div>
    <div class="center"><strong>Encomenda #${order.number}</strong></div>
    <div class="center">${new Date(order.createdAt).toLocaleString('pt-PT')}</div>
    ${order.scheduledFor ? `<div class="center"><strong>Agendado: ${new Date(order.scheduledFor).toLocaleString('pt-PT')}</strong></div>` : ''}
    <hr>
    <div>${esc(order.customerName)}<br>${esc(order.customerPhone)}${order.customerEmail ? '<br>' + esc(order.customerEmail) : ''}
    ${
      order.type === 'DELIVERY' && order.deliveryAddress
        ? '<br>' +
          esc(order.deliveryAddress) +
          ([order.deliveryZipCode, order.deliveryCity].filter(Boolean).length
            ? '<br>' + esc([order.deliveryZipCode, order.deliveryCity].filter(Boolean).join(' '))
            : '')
        : ''
    }</div>
    <hr>
    <table>${rows}</table>
    <hr>
    <table>
      <tr><td>Subtotal</td><td class="r">${eur(order.subtotal)}</td></tr>
      ${Number(order.discount) > 0 ? `<tr><td>Desconto${order.couponCode ? ` (${esc(order.couponCode)})` : ''}</td><td class="r">-${eur(order.discount)}</td></tr>` : ''}
      ${order.type === 'DELIVERY' && Number(order.deliveryFee) > 0 ? `<tr><td>Entrega</td><td class="r">${eur(order.deliveryFee)}</td></tr>` : ''}
      <tr class="total"><td>TOTAL</td><td class="r">${eur(order.total)}</td></tr>
      ${Number(order.vatTotal) > 0 ? `<tr><td>IVA incluído</td><td class="r">${eur(order.vatTotal)}</td></tr>` : ''}
    </table>
    <hr>
    <div>Pagamento: ${esc(PAYMENT_LABELS[order.paymentMethod] ?? order.paymentMethod)}${
      order.paymentMethod === 'CASH' && order.changeFor ? '<br>Troco para: ' + eur(order.changeFor) : ''
    }</div>
    ${order.notes ? `<hr><div>Notas: ${esc(order.notes)}</div>` : ''}
    <hr><div class="center">Obrigado!</div>
  </body></html>`;
}

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
}

function browserPrint(order: Order, storeName: string) {
  const w = window.open('', '_blank', 'width=320,height=600');
  if (!w) throw new Error('Pop-up bloqueado. Permite pop-ups para imprimir.');
  w.document.write(receiptHtml(order, storeName));
  w.document.close();
}

/**
 * Imprime a encomenda: usa o QZ Tray (impressora térmica) se houver uma
 * selecionada; caso contrário, recorre à impressão do browser.
 */
export async function printOrder(order: Order, storeName: string): Promise<'qz' | 'browser'> {
  const { printerName, width } = usePrintStore.getState();
  if (printerName) {
    const bytes = buildReceiptBytes(order, { storeName, width });
    await printRawBytes(printerName, bytes);
    return 'qz';
  }
  browserPrint(order, storeName);
  return 'browser';
}
