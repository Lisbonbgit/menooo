/**
 * E2e do pedido na mesa + sessão (Fase 2b, Task 2): gate `dineInOrderingEnabled`, ISOLAMENTO de
 * menu (só produtos de Sala), ISOLAMENTO de QR (slug+qrToken têm de bater os dois), e o ciclo de
 * vida da `TableSession` (abre no 1º pedido, acumula no 2º, fecha, novo pedido depois de fechar
 * abre outra sessão).
 *
 * Requer a stack local: DB :5433 + API em http://localhost:3001 (build/watch).
 *   node scripts/e2e-dine-in-orders.mjs
 *
 * Self-contained (não depende da demo estar pristina): cria uma unidade B nova na conta do dono
 * da demo (mesmo padrão do e2e-dine-tables.mjs — POST /tenants + ativar por prisma + /auth/switch),
 * com o seu próprio menu de Sala (categoria+produto) e menu de Delivery (categoria+produto, só
 * para o isolamento de menu) e a sua própria mesa. Limpa tudo no `finally`.
 *
 * Isolamento de QR (ponto 6): usa uma mesa da demo (tenant A = pizzaria-demo) — criada e apagada
 * pelo próprio script — para provar que um qrToken válido de A não serve pedidos a B, mesmo com
 * slug B genuíno (mesmo racional do ponto 6 de e2e-dine-tables.mjs).
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');

const BASE = process.env.API_URL ?? 'http://localhost:3001/api';
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://comanda:comanda@localhost:5433/comanda?schema=public';
const SLUG_A = 'pizzaria-demo';
const RUN = Date.now();

let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

async function req(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* respostas vazias */
  }
  return { status: res.status, json };
}

async function main() {
  const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
  let tokenA;
  const created = { tenantBId: null, tableAId: null };

  try {
    // =========================================================================
    // 0. login owner A (demo) + criar tenant B (nova unidade da mesma conta)
    // =========================================================================
    console.log('— 0. login owner A + setup tenant B');
    const login = await req('POST', '/auth/login', {
      body: { email: 'dono@pizzaria-demo.pt', password: 'demo1234' },
    });
    check('owner A login 201', login.status === 201, `got ${login.status}`);
    tokenA = login.json?.accessToken;
    check('accessToken A obtido', !!tokenA);

    const unitB = await req('POST', '/tenants', {
      token: tokenA,
      body: { name: 'Dine Orders E2E', slug: `dine-orders-e2e-${RUN}` },
    });
    check('tenant B criado 201', unitB.status === 201, `got ${unitB.status} ${JSON.stringify(unitB.json)}`);
    created.tenantBId = unitB.json?.id;
    const slugB = unitB.json?.slug;

    // ativar B por prisma direto (POST /tenants não define status; fica PENDING por omissão) —
    // dineInOrderingEnabled fica FALSE por omissão (schema): é exatamente o estado do ponto 1 (gate OFF).
    await prisma.tenant.update({ where: { id: created.tenantBId }, data: { status: 'ACTIVE' } });

    const switchRes = await req('POST', '/auth/switch', { token: tokenA, body: { tenantId: created.tenantBId } });
    check('switch para tenant B 201', switchRes.status === 201, `got ${switchRes.status}`);
    const tokenB = switchRes.json?.accessToken;
    check('accessToken B obtido', !!tokenB);

    // =========================================================================
    // catálogo de B: categoria+produto de Sala (dine-in) + categoria+produto de Delivery
    // =========================================================================
    console.log('— catálogo de B: produto de Sala + produto de Delivery');
    const salaCat = await req('POST', '/catalog/categories?menu=dine_in', {
      token: tokenB,
      body: { name: `Sala E2E ${RUN}` },
    });
    check('categoria de Sala criada 201', salaCat.status === 201, `got ${salaCat.status} ${JSON.stringify(salaCat.json)}`);
    const salaProd = await req('POST', '/catalog/products', {
      token: tokenB,
      body: { categoryId: salaCat.json?.id, name: 'Bifana Sala E2E', price: 5 },
    });
    check('produto de Sala criado 201', salaProd.status === 201, `got ${salaProd.status} ${JSON.stringify(salaProd.json)}`);
    const salaProductId = salaProd.json?.id;

    const deliveryCat = await req('POST', '/catalog/categories', {
      token: tokenB,
      body: { name: `Delivery E2E ${RUN}` },
    });
    check('categoria de Delivery criada 201', deliveryCat.status === 201, `got ${deliveryCat.status} ${JSON.stringify(deliveryCat.json)}`);
    const deliveryProd = await req('POST', '/catalog/products', {
      token: tokenB,
      body: { categoryId: deliveryCat.json?.id, name: 'Pizza Delivery E2E', price: 8 },
    });
    check('produto de Delivery criado 201', deliveryProd.status === 201, `got ${deliveryProd.status} ${JSON.stringify(deliveryProd.json)}`);
    const deliveryProductId = deliveryProd.json?.id;

    // =========================================================================
    // mesa de B
    // =========================================================================
    console.log('— criar mesa de B');
    const tableName = `Mesa E2E ${RUN}`;
    const tableB = await req('POST', '/dine-tables', { token: tokenB, body: { name: tableName } });
    check('POST /dine-tables (B) 201', tableB.status === 201, `got ${tableB.status} ${JSON.stringify(tableB.json)}`);
    const tableId = tableB.json?.id;
    const qrTokenB = tableB.json?.qrToken;
    check('mesa de B tem qrToken', typeof qrTokenB === 'string' && qrTokenB.length > 0, JSON.stringify(tableB.json));

    // mesa de A (para o isolamento de QR — ponto 5)
    const tableA = await req('POST', '/dine-tables', { token: tokenA, body: { name: `Mesa A E2E ${RUN}` } });
    check('POST /dine-tables (A) 201', tableA.status === 201, `got ${tableA.status} ${JSON.stringify(tableA.json)}`);
    created.tableAId = tableA.json?.id;
    const qrTokenA = tableA.json?.qrToken;

    const pedido = (productId, quantity) => ({ items: [{ productId, quantity }] });

    // =========================================================================
    // 1. gate OFF: dineInOrderingEnabled=false → POST mesa/orders → 400
    // =========================================================================
    console.log('— 1. gate OFF');
    const gateOff = await req('POST', `/public/stores/${slugB}/mesa/${qrTokenB}/orders`, {
      body: pedido(salaProductId, 1),
    });
    check('*** GATE OFF *** dineInOrderingEnabled=false → 400', gateOff.status === 400,
      `got ${gateOff.status} ${JSON.stringify(gateOff.json)}`);
    check('mensagem do gate OFF', /aceita pedidos na mesa/i.test(gateOff.json?.message ?? ''),
      JSON.stringify(gateOff.json));

    // ligar o gate
    await prisma.tenant.update({ where: { id: created.tenantBId }, data: { dineInOrderingEnabled: true } });

    // =========================================================================
    // 2. POST mesa/orders {item Sala} → 201, DINE_IN, customerName = mesa, trackToken, tableSessionId
    // =========================================================================
    console.log('— 2. 1º pedido na mesa (Sala)');
    const order1 = await req('POST', `/public/stores/${slugB}/mesa/${qrTokenB}/orders`, {
      body: pedido(salaProductId, 2), // 2× 5€ = 10€
    });
    check('POST pedido na mesa 201', order1.status === 201, `got ${order1.status} ${JSON.stringify(order1.json)}`);
    check('pedido type DINE_IN', order1.json?.type === 'DINE_IN', JSON.stringify(order1.json?.type));
    check('customerName = nome da mesa', order1.json?.customerName === tableName, JSON.stringify(order1.json?.customerName));
    check('customerPhone vazio', order1.json?.customerPhone === '', JSON.stringify(order1.json?.customerPhone));
    check('trackToken presente', typeof order1.json?.trackToken === 'string' && order1.json.trackToken.length > 0);
    check('tableSessionId presente', typeof order1.json?.tableSessionId === 'string' && order1.json.tableSessionId.length > 0,
      JSON.stringify(order1.json?.tableSessionId));
    check('total = 10 (2× 5€)', Number(order1.json?.total) === 10, JSON.stringify(order1.json?.total));
    const sessionId1 = order1.json?.tableSessionId;

    // =========================================================================
    // 3. 2º POST na mesma mesa → MESMO tableSessionId (conta acumula)
    // =========================================================================
    console.log('— 3. 2º pedido na mesma mesa (acumula)');
    const order2 = await req('POST', `/public/stores/${slugB}/mesa/${qrTokenB}/orders`, {
      body: pedido(salaProductId, 1), // 1× 5€ = 5€
    });
    check('2º pedido 201', order2.status === 201, `got ${order2.status} ${JSON.stringify(order2.json)}`);
    check('*** SESSÃO ACUMULA *** mesmo tableSessionId', order2.json?.tableSessionId === sessionId1,
      `${order2.json?.tableSessionId} !== ${sessionId1}`);

    // =========================================================================
    // 4. ISOLAMENTO DE MENU (crítico): produto do Delivery → 400 "Produto indisponível"
    // =========================================================================
    console.log('— 4. ISOLAMENTO de menu: produto de Delivery na mesa');
    const menuIsolation = await req('POST', `/public/stores/${slugB}/mesa/${qrTokenB}/orders`, {
      body: pedido(deliveryProductId, 1),
    });
    check('*** ISOLAMENTO DE MENU *** produto de Delivery na mesa → 400', menuIsolation.status === 400,
      `got ${menuIsolation.status} ${JSON.stringify(menuIsolation.json)}`);
    check('mensagem "Produto indisponível"', /indispon[ií]vel/i.test(menuIsolation.json?.message ?? ''),
      JSON.stringify(menuIsolation.json));

    // =========================================================================
    // 5. ISOLAMENTO DE QR (crítico): slug B + qrToken de A → 404
    // =========================================================================
    console.log('— 5. ISOLAMENTO de QR: slug B + token de A');
    check('pré-condição: qrTokenA existe e é diferente de qrTokenB', !!qrTokenA && qrTokenA !== qrTokenB);
    const qrIsolation = await req('POST', `/public/stores/${slugB}/mesa/${qrTokenA}/orders`, {
      body: pedido(salaProductId, 1),
    });
    check('*** ISOLAMENTO DE QR *** slug B + token A → 404', qrIsolation.status === 404,
      `got ${qrIsolation.status} ${JSON.stringify(qrIsolation.json)}`);

    // =========================================================================
    // 6. GET /dine-tables/table-sessions?status=open → 1 sessão, total = soma dos pedidos
    // =========================================================================
    console.log('— 6. GET sessões abertas');
    const openList1 = await req('GET', '/dine-tables/table-sessions?status=open', { token: tokenB });
    check('GET sessões abertas 200', openList1.status === 200, `got ${openList1.status} ${JSON.stringify(openList1.json)}`);
    check('1 sessão aberta', Array.isArray(openList1.json) && openList1.json.length === 1,
      JSON.stringify(openList1.json?.length));
    const session1 = openList1.json?.[0];
    check('sessão é a da mesa certa', session1?.table === tableName, JSON.stringify(session1?.table));
    check('sessão tem 2 pedidos', session1?.orders?.length === 2, JSON.stringify(session1?.orders?.length));
    check('total da sessão = 15 (10+5)', Number(session1?.total) === 15, JSON.stringify(session1?.total));

    // =========================================================================
    // 7. PATCH /dine-tables/table-sessions/:id/close → ok; GET open → 0
    // =========================================================================
    console.log('— 7. fechar a conta');
    const closeRes = await req('PATCH', `/dine-tables/table-sessions/${sessionId1}/close`, { token: tokenB });
    check('PATCH close 200', closeRes.status === 200, `got ${closeRes.status} ${JSON.stringify(closeRes.json)}`);
    check('close devolve ok:true', closeRes.json?.ok === true, JSON.stringify(closeRes.json));
    const openList2 = await req('GET', '/dine-tables/table-sessions?status=open', { token: tokenB });
    check('GET open → 0 sessões depois de fechar', Array.isArray(openList2.json) && openList2.json.length === 0,
      JSON.stringify(openList2.json));

    // fechar sessão já fechada → 404
    const closeAgain = await req('PATCH', `/dine-tables/table-sessions/${sessionId1}/close`, { token: tokenB });
    check('fechar sessão já fechada → 404', closeAgain.status === 404, `got ${closeAgain.status}`);

    // =========================================================================
    // 8. novo POST depois de fechar → NOVA sessão (id diferente)
    // =========================================================================
    console.log('— 8. novo pedido depois de fechar → nova sessão');
    const order3 = await req('POST', `/public/stores/${slugB}/mesa/${qrTokenB}/orders`, {
      body: pedido(salaProductId, 1),
    });
    check('3º pedido 201', order3.status === 201, `got ${order3.status} ${JSON.stringify(order3.json)}`);
    check('*** NOVA SESSÃO *** tableSessionId diferente da fechada',
      !!order3.json?.tableSessionId && order3.json.tableSessionId !== sessionId1,
      `${order3.json?.tableSessionId} vs fechada ${sessionId1}`);
    const openList3 = await req('GET', '/dine-tables/table-sessions?status=open', { token: tokenB });
    check('GET open → 1 sessão nova', Array.isArray(openList3.json) && openList3.json.length === 1,
      JSON.stringify(openList3.json));
    check('sessão nova tem 1 pedido', openList3.json?.[0]?.orders?.length === 1,
      JSON.stringify(openList3.json?.[0]));

    // fechar a sessão nova para não deixar nada aberto (higiene, não é parte do check)
    if (order3.json?.tableSessionId) {
      await req('PATCH', `/dine-tables/table-sessions/${order3.json.tableSessionId}/close`, { token: tokenB }).catch(() => {});
    }
  } catch (e) {
    console.error('erro fatal durante os testes:', e);
    failed++;
  } finally {
    // Limpeza: apagar a mesa de A e o tenant B inteiro (cascade: mesas, sessões, produtos, categorias).
    try {
      if (created.tableAId) {
        await req('DELETE', `/dine-tables/${created.tableAId}`, { token: tokenA }).catch(() => {});
      }
      if (created.tenantBId) {
        await prisma.tenant.delete({ where: { id: created.tenantBId } }).catch(() => {});
      }
    } catch (e) {
      console.error('  limpeza falhou:', e?.message ?? e);
    }
    await prisma.$disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('erro fatal fora do main:', e);
  process.exit(1);
});
