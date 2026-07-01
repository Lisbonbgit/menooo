// ============================================================================
// Gerador de talão ESC/POS (comandos crus para impressora térmica).
// Função pura: Order -> bytes. Sem dependências de browser (testável em node).
// ============================================================================

import type { Order } from './types';

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

// remove acentos para garantir saída limpa em qualquer impressora/code-page
function asciiFold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const PAYMENT_LABELS: Record<string, string> = {
  CASH: 'Dinheiro',
  CARD_ON_DELIVERY: 'Multibanco a porta',
  MBWAY: 'MB WAY',
  CARD_ONLINE: 'Cartao online',
};

class EscPosBuilder {
  private bytes: number[] = [];
  constructor(private readonly width = 42) {}

  raw(...b: number[]) {
    this.bytes.push(...b);
    return this;
  }

  text(s: string) {
    for (const ch of asciiFold(s)) {
      const code = ch.charCodeAt(0);
      this.bytes.push(code < 256 ? code : 0x3f); // '?' para fora de Latin1
    }
    return this;
  }

  line(s = '') {
    return this.text(s).raw(LF);
  }

  /** Linha com texto à esquerda e valor à direita, preenchida com espaços. */
  lineLR(left: string, right: string) {
    const l = asciiFold(left);
    const r = asciiFold(right);
    const space = Math.max(1, this.width - l.length - r.length);
    return this.line(l + ' '.repeat(space) + r);
  }

  rule(char = '-') {
    return this.line(char.repeat(this.width));
  }

  init() {
    return this.raw(ESC, 0x40);
  }
  align(n: 0 | 1 | 2) {
    return this.raw(ESC, 0x61, n);
  }
  bold(on: boolean) {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }
  /** tamanho: 0 normal; 0x11 duplo (altura+largura). */
  size(n: number) {
    return this.raw(GS, 0x21, n);
  }
  feed(n = 1) {
    for (let i = 0; i < n; i++) this.bytes.push(LF);
    return this;
  }
  cut() {
    return this.raw(GS, 0x56, 0x00);
  }

  build(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

const eur = (v: string | number) => `${Number(v).toFixed(2)} EUR`;

export interface ReceiptOptions {
  storeName: string;
  width?: number; // 42 (80mm) ou 32 (58mm)
}

/** Gera os bytes ESC/POS do talão de uma encomenda. */
export function buildReceiptBytes(order: Order, opts: ReceiptOptions): Uint8Array {
  const b = new EscPosBuilder(opts.width ?? 42);

  b.init().align(1).bold(true).size(0x11).line(opts.storeName).size(0).bold(false);
  b.align(1).line(order.type === 'DELIVERY' ? 'ENTREGA' : 'TAKE-AWAY');
  b.feed(1).align(0);

  b.bold(true).size(0x01).line(`Encomenda #${order.number}`).size(0).bold(false);
  b.line(new Date(order.createdAt).toLocaleString('pt-PT'));
  b.rule();

  b.line(order.customerName);
  b.line(order.customerPhone);
  if (order.type === 'DELIVERY' && order.deliveryAddress) {
    b.line(order.deliveryAddress);
  }
  b.rule();

  for (const it of order.items) {
    b.lineLR(`${it.quantity}x ${it.name}`, eur(it.total));
    for (const m of it.modifiers) {
      b.line(`   + ${m.name}`);
    }
  }
  b.rule();

  b.lineLR('Subtotal', eur(order.subtotal));
  if (order.type === 'DELIVERY' && Number(order.deliveryFee) > 0) {
    b.lineLR('Entrega', eur(order.deliveryFee));
  }
  b.bold(true).size(0x01).lineLR('TOTAL', eur(order.total)).size(0).bold(false);
  b.feed(1);

  b.line(`Pagamento: ${PAYMENT_LABELS[order.paymentMethod] ?? order.paymentMethod}`);
  if (order.notes) {
    b.rule();
    b.line('Notas:');
    b.line(order.notes);
  }

  b.feed(2).align(1).line('Obrigado!').feed(3).cut();
  return b.build();
}

/** Codifica bytes em base64 (browser e node). */
export function toBase64(bytes: Uint8Array): string {
  if (typeof btoa === 'function') {
    let bin = '';
    for (const byte of bytes) bin += String.fromCharCode(byte);
    return btoa(bin);
  }
  // node
  return Buffer.from(bytes).toString('base64');
}
