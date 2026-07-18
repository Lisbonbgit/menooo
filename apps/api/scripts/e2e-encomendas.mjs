/**
 * E2e das ENCOMENDAS — smoke da máquina de estados (Fase A dos emails).
 *
 * Requer a stack local: DB :5433 + API em http://localhost:3001 (watch).
 * NÃO afirma emails: os scripts e2e ligam a uma API noutro processo e não
 * espiam o transporter. O disparo por transição é coberto por
 * orders.service.spec.ts. Aqui provamos que percorrer os estados por HTTP
 * continua 200 + persistente (regressão do fire-and-forget).
 *
 * A loja tem de estar ABERTA para o checkout público passar. Se a demo
 * estiver fechada à hora do teste, o create devolve 400 "loja fechada" —
 * o script avisa e sai 0 (skip), não falha.
 */
const BASE = process.env.API_URL ?? 'http://localhost:3001/api';
const SLUG = process.env.DEMO_SLUG ?? 'pizzaria-demo';
const EMAIL = process.env.DEMO_EMAIL ?? 'dono@pizzaria-demo.pt';
const PASS = process.env.DEMO_PASS ?? 'demo1234';

let pass = 0;
let fail = 0;
function check(name, ok, extra = '') {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

async function req(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* respostas sem corpo */
  }
  return { status: res.status, json };
}

async function main() {
  console.log('— login do dono da demo');
  const login = await req('POST', '/auth/login', { body: { email: EMAIL, password: PASS } });
  // POST no NestJS devolve 201 por omissão; o login é bem-sucedido em 200 OU 201.
  check('login 200/201', login.status === 200 || login.status === 201, `got ${login.status}`);
  const token = login.json?.accessToken;
  if (!token) {
    console.log('  sem token — abortar');
    process.exit(1);
  }

  console.log('— obter um produto real');
  const prods = await req('GET', '/catalog/products', { token });
  check('GET produtos 200', prods.status === 200, `got ${prods.status}`);
  const produto = prods.json?.[0];
  const productId = produto?.id;
  if (!productId) {
    console.log('  demo sem produtos — abortar');
    process.exit(1);
  }
  // A demo pode ter encomenda mínima (ex.: 10 €). Pede quantidade que ultrapasse
  // com folga qualquer mínimo razoável, a partir do preço real do produto.
  const preco = Number(produto.price) || 5;
  const qty = Math.max(1, Math.ceil(15 / preco));
  const novoPedido = (nome, email) => ({
    type: 'PICKUP',
    customerName: nome,
    customerPhone: '912000000',
    customerEmail: email,
    paymentMethod: 'CASH',
    items: [{ productId, quantity: qty }],
  });

  console.log(`— criar encomenda pública (PICKUP, ${qty}× produto, com email)`);
  const create = await req('POST', `/public/stores/${SLUG}/orders`, {
    body: novoPedido('Cliente E2E', 'cliente.e2e@exemplo.pt'),
  });
  // SÓ a loja fechada é motivo de SKIP (ambiental). Qualquer outro 400 é falha real.
  if (create.status === 400 && /fechad/i.test(create.json?.message ?? '')) {
    console.log(`  loja fechada à hora do teste (${create.json?.message}) — SKIP, sem falha`);
    console.log(`\n${pass} passed, ${fail} failed (create em skip)`);
    process.exit(fail === 0 ? 0 : 1);
  }
  check('POST encomenda 201/200', create.status === 201 || create.status === 200, `got ${create.status}`);
  const orderId = create.json?.id;
  check('encomenda tem id', !!orderId);
  check('encomenda tem number legível', typeof create.json?.number === 'number');

  const setStatus = async (status) => {
    const r = await req('PATCH', `/orders/${orderId}/status`, { token, body: { status } });
    check(`PATCH ${status} → 200`, r.status === 200, `got ${r.status} ${JSON.stringify(r.json)}`);
    const g = await req('GET', `/orders/${orderId}`, { token });
    check(`estado persistido = ${status}`, g.json?.status === status, `got ${g.json?.status}`);
  };

  console.log('— percorrer ACCEPTED → PREPARING → READY → COMPLETED');
  await setStatus('ACCEPTED');
  await setStatus('PREPARING');
  await setStatus('READY');
  await setStatus('COMPLETED');

  console.log('— transição inválida é recusada (COMPLETED → ACCEPTED)');
  const bad = await req('PATCH', `/orders/${orderId}/status`, { token, body: { status: 'ACCEPTED' } });
  check('transição inválida → 400', bad.status === 400, `got ${bad.status}`);

  console.log('— um 2.º pedido para o caminho REJECTED (PENDING → REJECTED)');
  const create2 = await req('POST', `/public/stores/${SLUG}/orders`, {
    body: novoPedido('Cliente E2E 2', 'cliente.e2e2@exemplo.pt'),
  });
  if (create2.status === 201 || create2.status === 200) {
    const rej = await req('PATCH', `/orders/${create2.json.id}/status`, { token, body: { status: 'REJECTED' } });
    check('PATCH REJECTED → 200', rej.status === 200, `got ${rej.status}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
