/**
 * E2e das mesas de sala (dine-in QR): CRUD, ISOLAMENTO do resolve público (crítico) e tenancy.
 * Requer a stack local: DB :5433 + API em http://localhost:3001 (build/watch).
 *   node scripts/e2e-dine-tables.mjs
 *
 * Segue o padrão de e2e-catalogo.mjs / e2e-reservas.mjs (helpers req/check, sufixo RUN,
 * contadores, exit code, finally-cleanup).
 *
 * Tenant B (para ISOLAMENTO + tenancy) = 2ª unidade da MESMA conta demo, criada via
 * POST /tenants + POST /auth/switch — o mesmo padrão do ponto 20 do e2e-reservas.mjs.
 * Ativada por prisma direto logo a seguir: POST /tenants não define `status` (fica PENDING
 * por omissão) e o resolve público exige `status: 'ACTIVE'`; sem isto o teste de isolamento
 * "passaria" só por B nunca bater ACTIVE, sem provar que o resolve filtra por slug+token
 * a sério (ver nota no ponto 6). Apagada no finally — nada fica na BD depois do script.
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
  let ownerToken;
  let tokenB;
  const created = { tableIds: [], tenantBId: null };

  try {
    // =========================================================================
    // 0. Login owner A (demo) + setup do tenant B (cross-tenant, mesma conta)
    // =========================================================================
    console.log('— 0. login owner A + setup tenant B');
    const login = await req('POST', '/auth/login', {
      body: { email: 'dono@pizzaria-demo.pt', password: 'demo1234' },
    });
    check('owner A login 201', login.status === 201, `got ${login.status}`);
    ownerToken = login.json?.accessToken;
    check('accessToken A obtido', !!ownerToken);

    const unitB = await req('POST', '/tenants', {
      token: ownerToken,
      body: { name: 'Dine E2E Cross', slug: `dine-e2e-b-${RUN}` },
    });
    check('tenant B criado 201', unitB.status === 201, `got ${unitB.status} ${JSON.stringify(unitB.json)}`);
    created.tenantBId = unitB.json?.id;
    const slugB = unitB.json?.slug;

    // ativar B por prisma direto (POST /tenants não define status; ver nota no cabeçalho)
    await prisma.tenant.update({ where: { id: created.tenantBId }, data: { status: 'ACTIVE' } });

    const switchRes = await req('POST', '/auth/switch', {
      token: ownerToken,
      body: { tenantId: created.tenantBId },
    });
    check('switch para tenant B 201', switchRes.status === 201, `got ${switchRes.status}`);
    tokenB = switchRes.json?.accessToken;
    check('accessToken B obtido', !!tokenB);

    // =========================================================================
    // 1. POST /dine-tables → tem qrToken
    // =========================================================================
    console.log('— 1. POST /dine-tables');
    const m1 = await req('POST', '/dine-tables', { token: ownerToken, body: { name: `Mesa 1 ${RUN}` } });
    check('POST /dine-tables 201', m1.status === 201, `got ${m1.status} ${JSON.stringify(m1.json)}`);
    check('mesa tem id', !!m1.json?.id);
    check('mesa tem qrToken', typeof m1.json?.qrToken === 'string' && m1.json.qrToken.length > 0,
      JSON.stringify(m1.json));
    const table1Id = m1.json?.id;
    const table1Token = m1.json?.qrToken;
    if (table1Id) created.tableIds.push(table1Id);

    // =========================================================================
    // 2. POST /dine-tables/bulk {count:3} → devolve a lista com 4 mesas
    // =========================================================================
    console.log('— 2. POST /dine-tables/bulk');
    const bulk = await req('POST', '/dine-tables/bulk', { token: ownerToken, body: { count: 3 } });
    check('POST /dine-tables/bulk 201', bulk.status === 201, `got ${bulk.status} ${JSON.stringify(bulk.json)}`);
    check('bulk devolve 4 mesas (1 + 3)', Array.isArray(bulk.json) && bulk.json.length === 4,
      JSON.stringify(bulk.json?.map((t) => t.name)));
    for (const t of bulk.json ?? []) {
      if (t.id && !created.tableIds.includes(t.id)) created.tableIds.push(t.id);
    }
    check('mesas do bulk usam o prefixo "Mesa"',
      (bulk.json ?? []).filter((t) => t.id !== table1Id).every((t) => t.name.startsWith('Mesa ')),
      JSON.stringify(bulk.json?.map((t) => t.name)));

    // =========================================================================
    // 3. GET /dine-tables → 4, ordenadas (sortOrder asc, name asc)
    // =========================================================================
    console.log('— 3. GET /dine-tables');
    const list1 = await req('GET', '/dine-tables', { token: ownerToken });
    check('GET /dine-tables 200', list1.status === 200, `got ${list1.status}`);
    check('lista tem 4 mesas', list1.json?.length === 4, JSON.stringify(list1.json?.length));
    const sortOrders = (list1.json ?? []).map((t) => t.sortOrder);
    const sortedAsc = [...sortOrders].sort((a, b) => a - b);
    check('lista ordenada por sortOrder asc', JSON.stringify(sortOrders) === JSON.stringify(sortedAsc),
      JSON.stringify(sortOrders));

    // =========================================================================
    // 4. PATCH /dine-tables/:id {name} → 200; GET reflete
    // =========================================================================
    console.log('— 4. PATCH nome');
    const novoNome = `Balcão ${RUN}`;
    const patch = await req('PATCH', `/dine-tables/${table1Id}`, { token: ownerToken, body: { name: novoNome } });
    check('PATCH nome 200', patch.status === 200, `got ${patch.status} ${JSON.stringify(patch.json)}`);
    check('resposta do PATCH tem o novo nome', patch.json?.name === novoNome, JSON.stringify(patch.json?.name));
    const list2 = await req('GET', '/dine-tables', { token: ownerToken });
    const reread = (list2.json ?? []).find((t) => t.id === table1Id);
    check('GET reflete o novo nome', reread?.name === novoNome, JSON.stringify(reread));

    // =========================================================================
    // 5. resolve OK: GET /public/stores/<slugA>/mesa/<qrTokenDeA> → 200 {id,name}
    // =========================================================================
    console.log('— 5. resolve público OK');
    const resolveOk = await req('GET', `/public/stores/${SLUG_A}/mesa/${table1Token}`, {});
    check('resolve OK → 200', resolveOk.status === 200, `got ${resolveOk.status} ${JSON.stringify(resolveOk.json)}`);
    check('resolve devolve {id,name} certos',
      resolveOk.json?.id === table1Id && resolveOk.json?.name === novoNome, JSON.stringify(resolveOk.json));

    // =========================================================================
    // 6. ISOLAMENTO (CRÍTICO): GET /public/stores/<slugB>/mesa/<qrTokenDeA> → 404
    //    Prova que o resolve nunca serve um token a um restaurante que não é o dele —
    //    mesmo com slugB a apontar para um tenant ACTIVE de verdade (não um slug ao acaso).
    // =========================================================================
    console.log('— 6. ISOLAMENTO: slug B + token A');
    check('pré-condição: slugB existe e é diferente de slugA', !!slugB && slugB !== SLUG_A, String(slugB));
    const isolation = await req('GET', `/public/stores/${slugB}/mesa/${table1Token}`, {});
    check('*** ISOLAMENTO *** slug B + token A → 404', isolation.status === 404,
      `got ${isolation.status} ${JSON.stringify(isolation.json)}`);

    // =========================================================================
    // 7. token inexistente → 404
    // =========================================================================
    console.log('— 7. token inexistente');
    const naoExiste = await req('GET', `/public/stores/${SLUG_A}/mesa/nao-existe-${RUN}`, {});
    check('token inexistente → 404', naoExiste.status === 404, `got ${naoExiste.status}`);

    // =========================================================================
    // 8. DELETE /dine-tables/:id → 200; GET reflete
    // =========================================================================
    console.log('— 8. DELETE mesa');
    const del = await req('DELETE', `/dine-tables/${table1Id}`, { token: ownerToken });
    check('DELETE 200', del.status === 200, `got ${del.status} ${JSON.stringify(del.json)}`);
    const list3 = await req('GET', '/dine-tables', { token: ownerToken });
    check('GET reflete a remoção (3 mesas)', list3.json?.length === 3, JSON.stringify(list3.json?.length));
    created.tableIds = created.tableIds.filter((id) => id !== table1Id);

    // resolvida a mesa apagada → também 404 (active continua true nas restantes, mas esta já não existe)
    const resolveApagada = await req('GET', `/public/stores/${SLUG_A}/mesa/${table1Token}`, {});
    check('resolve de mesa apagada → 404', resolveApagada.status === 404, `got ${resolveApagada.status}`);

    // =========================================================================
    // 9. tenancy: dono B (tokenB) não consegue PATCH/DELETE mesa de A → 404
    // =========================================================================
    console.log('— 9. tenancy: token B em mesa de A');
    const remainingId = created.tableIds[0];
    check('pré-condição: sobra pelo menos 1 mesa de A', !!remainingId);
    const crossPatch = await req('PATCH', `/dine-tables/${remainingId}`, {
      token: tokenB,
      body: { name: 'Hackeado' },
    });
    check('PATCH mesa de A com token B → 404', crossPatch.status === 404,
      `got ${crossPatch.status} ${JSON.stringify(crossPatch.json)}`);
    const crossDelete = await req('DELETE', `/dine-tables/${remainingId}`, { token: tokenB });
    check('DELETE mesa de A com token B → 404', crossDelete.status === 404,
      `got ${crossDelete.status} ${JSON.stringify(crossDelete.json)}`);
    // confirma que a mesa de A sobreviveu às tentativas do B
    const list4 = await req('GET', '/dine-tables', { token: ownerToken });
    check('mesa de A intacta (3 continuam lá)', list4.json?.length === 3, JSON.stringify(list4.json?.length));
  } catch (e) {
    console.error('erro fatal durante os testes:', e);
    failed++;
  } finally {
    // Limpeza: apagar as mesas de A criadas pelo script e o tenant B inteiro (cross-tenant de teste).
    try {
      for (const id of created.tableIds) {
        await req('DELETE', `/dine-tables/${id}`, { token: ownerToken }).catch(() => {});
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
