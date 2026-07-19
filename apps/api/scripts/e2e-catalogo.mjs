/**
 * E2e do catálogo (menu): reordenação em lote + mudar de categoria recoloca no fim.
 * Requer a stack local: DB :5433 + API em http://localhost:3001 (build/watch).
 *   node scripts/e2e-catalogo.mjs
 *
 * Segue o padrão de e2e-reservas.mjs (helpers req/check, contadores, exit code, finally-cleanup).
 *
 * Cobre (spec §6, Tasks 1 e 2):
 *  - reorderProducts com a lista COMPLETA e trocada → 200 e a ordem muda (sortOrder 0..n-1);
 *  - reorder INCOMPLETO (subconjunto) → 400 (invariante da completude);
 *  - ids repetidos → 400 (Set dedup);
 *  - id de OUTRA categoria → 400; id de OUTRO tenant → 400 (tenancy dentro da transação);
 *  - reorderCategories completo → 200 e a ordem muda; incompleto → 400; outro tenant → 400;
 *  - mudar de categoria pelo PATCH recoloca o produto no FIM da destino (sortOrder = max+1);
 *  - PATCH sem mudar de categoria NÃO mexe no sortOrder (o T2 não dispara à toa).
 *
 * Fixtures de OUTRO tenant criados por prisma direto (não há HTTP para outro tenant) e limpos no
 * finally — mesma exceção "prisma para arrumar a BD" documentada no e2e-reservas.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');

const BASE = process.env.API_URL ?? 'http://localhost:3001/api';
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://comanda:comanda@localhost:5433/comanda?schema=public';
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

/** ordem visível dos produtos de uma categoria, como o painel a vê (sortOrder asc, name asc). */
async function productIds(token, categoryId) {
  const r = await req('GET', `/catalog/products?categoryId=${categoryId}`, { token });
  return { status: r.status, ids: (r.json ?? []).map((p) => p.id), rows: r.json ?? [] };
}

async function main() {
  const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
  let token;
  const created = { catA: null, catB: null, catSala: null, prodSala: null, grpSala: null };
  const foreign = { tenantId: null, categoryId: null, productId: null };

  try {
    // =========================================================================
    // 0. Login owner
    // =========================================================================
    console.log('— 0. login owner');
    const login = await req('POST', '/auth/login', {
      body: { email: 'dono@pizzaria-demo.pt', password: 'demo1234' },
    });
    check('owner login 201', login.status === 201, `got ${login.status}`);
    token = login.json?.accessToken;
    check('accessToken obtido', !!token);

    // =========================================================================
    // 1. Fixtures: 2 categorias novas + produtos
    // =========================================================================
    console.log('— 1. fixtures (categorias + produtos)');
    const ca = await req('POST', '/catalog/categories', { token, body: { name: `E2E-A-${RUN}` } });
    const cb = await req('POST', '/catalog/categories', { token, body: { name: `E2E-B-${RUN}` } });
    check('POST categoria A 201', ca.status === 201, `got ${ca.status}`);
    check('POST categoria B 201', cb.status === 201, `got ${cb.status}`);
    created.catA = ca.json?.id;
    created.catB = cb.json?.id;

    async function newProduct(categoryId, name) {
      const r = await req('POST', '/catalog/products', {
        token,
        body: { categoryId, name, price: 5.0, vatRate: 23 },
      });
      check(`POST produto ${name} 201`, r.status === 201, `got ${r.status} ${JSON.stringify(r.json)}`);
      return r.json?.id;
    }
    // Nomes ordenáveis: com todos os sortOrder=0, o desempate é por name → ordem base previsível.
    const pa1 = await newProduct(created.catA, `E2E-A-1-${RUN}`);
    const pa2 = await newProduct(created.catA, `E2E-A-2-${RUN}`);
    const pa3 = await newProduct(created.catA, `E2E-A-3-${RUN}`);
    const pb1 = await newProduct(created.catB, `E2E-B-1-${RUN}`);
    const pb2 = await newProduct(created.catB, `E2E-B-2-${RUN}`);
    // 3 produtos em catB de propósito: assim max+1 = 3, diferente do sortOrder velho (2) que o
    // produto movido traz de catA — sem isto os dois valores colidiam e o teste do T2 não provava
    // nada (passaria mesmo sem o recálculo do sortOrder).
    const pb3 = await newProduct(created.catB, `E2E-B-3-${RUN}`);

    const base = await productIds(token, created.catA);
    check('catA arranca com [pa1,pa2,pa3]', JSON.stringify(base.ids) === JSON.stringify([pa1, pa2, pa3]),
      JSON.stringify(base.ids));

    // Fixture de OUTRO tenant (por prisma — não há HTTP para outro tenant).
    const otherTenant = await prisma.tenant.findFirst({
      where: { slug: { not: 'pizzaria-demo' } },
      select: { id: true },
    });
    check('outro tenant encontrado', !!otherTenant, 'nenhum outro tenant na BD');
    foreign.tenantId = otherTenant?.id;
    if (foreign.tenantId) {
      // Category.menuId é obrigatório (Fase 1 dine-in): o menu Delivery do tenant alheio já existe
      // (backfill da migração cria um por tenant), mas o upsert garante mesmo para tenants novos.
      const foreignMenu = await prisma.menu.upsert({
        where: { tenantId_type: { tenantId: foreign.tenantId, type: 'DELIVERY' } },
        create: { tenantId: foreign.tenantId, type: 'DELIVERY' },
        update: {},
      });
      const fcat = await prisma.category.create({
        data: { tenantId: foreign.tenantId, menuId: foreignMenu.id, name: `E2E-FOREIGN-${RUN}` },
      });
      foreign.categoryId = fcat.id;
      const fprod = await prisma.product.create({
        data: { tenantId: foreign.tenantId, categoryId: fcat.id, name: `E2E-FOREIGN-P-${RUN}`, price: 1 },
      });
      foreign.productId = fprod.id;
    }

    // =========================================================================
    // 2. reorderProducts — completo, incompleto, dup, outra categoria, outro tenant
    // =========================================================================
    console.log('— 2. PUT /catalog/products/reorder');
    const rp = await req('PUT', '/catalog/products/reorder', {
      token,
      body: { categoryId: created.catA, ids: [pa3, pa2, pa1] },
    });
    check('reorder produtos completo → 200', rp.status === 200, `got ${rp.status} ${JSON.stringify(rp.json)}`);
    check('reorder devolve {reordered:3}', rp.json?.reordered === 3, JSON.stringify(rp.json));

    const after = await productIds(token, created.catA);
    check('ordem inverteu para [pa3,pa2,pa1]', JSON.stringify(after.ids) === JSON.stringify([pa3, pa2, pa1]),
      JSON.stringify(after.ids));
    const so = Object.fromEntries(after.rows.map((r) => [r.id, r.sortOrder]));
    check('sortOrder reindexado 0..2', so[pa3] === 0 && so[pa2] === 1 && so[pa1] === 2,
      JSON.stringify(so));

    const incompleto = await req('PUT', '/catalog/products/reorder', {
      token,
      body: { categoryId: created.catA, ids: [pa1, pa2] },
    });
    check('reorder produtos INCOMPLETO → 400', incompleto.status === 400,
      `got ${incompleto.status} ${JSON.stringify(incompleto.json)}`);

    const dup = await req('PUT', '/catalog/products/reorder', {
      token,
      body: { categoryId: created.catA, ids: [pa1, pa2, pa2] },
    });
    check('reorder produtos com id repetido → 400', dup.status === 400,
      `got ${dup.status} ${JSON.stringify(dup.json)}`);

    const outraCat = await req('PUT', '/catalog/products/reorder', {
      token,
      body: { categoryId: created.catA, ids: [pa1, pa2, pb1] },
    });
    check('reorder produtos com id de OUTRA categoria → 400', outraCat.status === 400,
      `got ${outraCat.status} ${JSON.stringify(outraCat.json)}`);

    if (foreign.productId) {
      const outroTenant = await req('PUT', '/catalog/products/reorder', {
        token,
        body: { categoryId: created.catA, ids: [pa1, pa2, foreign.productId] },
      });
      check('reorder produtos com id de OUTRO tenant → 400', outroTenant.status === 400,
        `got ${outroTenant.status} ${JSON.stringify(outroTenant.json)}`);
    }

    // =========================================================================
    // 3. reorderCategories — completo, incompleto, outro tenant
    // =========================================================================
    console.log('— 3. PUT /catalog/categories/reorder');
    const catsBefore = await req('GET', '/catalog/categories', { token });
    const allCatIds = (catsBefore.json ?? []).map((c) => c.id);
    check('GET categorias 200 e contém A e B',
      catsBefore.status === 200 && allCatIds.includes(created.catA) && allCatIds.includes(created.catB),
      JSON.stringify(allCatIds));

    const reversed = [...allCatIds].reverse();
    const rc = await req('PUT', '/catalog/categories/reorder', { token, body: { ids: reversed } });
    check('reorder categorias completo → 200', rc.status === 200,
      `got ${rc.status} ${JSON.stringify(rc.json)}`);
    check('reorder devolve {reordered:N}', rc.json?.reordered === allCatIds.length, JSON.stringify(rc.json));

    const catsAfter = await req('GET', '/catalog/categories', { token });
    const afterIds = (catsAfter.json ?? []).map((c) => c.id);
    check('ordem das categorias inverteu', JSON.stringify(afterIds) === JSON.stringify(reversed),
      JSON.stringify(afterIds));

    const catIncompleto = await req('PUT', '/catalog/categories/reorder', {
      token,
      body: { ids: reversed.slice(0, -1) },
    });
    check('reorder categorias INCOMPLETO → 400', catIncompleto.status === 400,
      `got ${catIncompleto.status} ${JSON.stringify(catIncompleto.json)}`);

    if (foreign.categoryId) {
      const mixed = [...reversed];
      mixed[mixed.length - 1] = foreign.categoryId; // mesma cardinalidade, um id alheio
      const catOutroTenant = await req('PUT', '/catalog/categories/reorder', { token, body: { ids: mixed } });
      check('reorder categorias com id de OUTRO tenant → 400', catOutroTenant.status === 400,
        `got ${catOutroTenant.status} ${JSON.stringify(catOutroTenant.json)}`);
    }

    // restaurar a ordem original das categorias
    const restore = await req('PUT', '/catalog/categories/reorder', { token, body: { ids: allCatIds } });
    check('restaurar ordem das categorias → 200', restore.status === 200,
      `got ${restore.status} ${JSON.stringify(restore.json)}`);

    // =========================================================================
    // 4. T2 — mudar de categoria recoloca no FIM (sortOrder = max+1)
    // =========================================================================
    console.log('— 4. PATCH mudar de categoria → sortOrder = max+1');
    // catB numerado: pb1=0, pb2=1, pb3=2 → max = 2. pa1 traz sortOrder=2 de catA (do reorder acima),
    // logo o esperado (max+1 = 3) DIFERE do valor velho — o teste falha se o recálculo não acontecer.
    const rpb = await req('PUT', '/catalog/products/reorder', {
      token,
      body: { categoryId: created.catB, ids: [pb1, pb2, pb3] },
    });
    check('reorder catB → 200 (max fica 2)', rpb.status === 200, `got ${rpb.status}`);

    const moved = await req('PATCH', `/catalog/products/${pa1}`, {
      token,
      body: { categoryId: created.catB },
    });
    check('PATCH mudar categoria → 200', moved.status === 200, `got ${moved.status} ${JSON.stringify(moved.json)}`);
    check('produto ficou em catB', moved.json?.categoryId === created.catB, JSON.stringify(moved.json?.categoryId));
    check('sortOrder = max+1 = 3 (≠ do sortOrder velho 2)', moved.json?.sortOrder === 3,
      `got sortOrder=${moved.json?.sortOrder}`);

    const catBnow = await productIds(token, created.catB);
    check('produto movido aterra no FIM de catB', catBnow.ids[catBnow.ids.length - 1] === pa1,
      JSON.stringify(catBnow.ids));

    // Regressão: PATCH SEM mudar categoria NÃO mexe no sortOrder (o T2 não dispara à toa).
    const renamed = await req('PATCH', `/catalog/products/${pb1}`, {
      token,
      body: { name: `E2E-B-1-renomeado-${RUN}` },
    });
    check('PATCH sem mudar categoria → 200', renamed.status === 200, `got ${renamed.status}`);
    check('sortOrder intacto (continua 0)', renamed.json?.sortOrder === 0, `got sortOrder=${renamed.json?.sortOrder}`);

    // A ARMADILHA DO UNDEFINED (3× neste projeto): o modal envia a descrição limpa como "" (não
    // undefined). Se virasse undefined, o JSON.stringify deitava a chave fora, o backend mantinha
    // a antiga e a UI mentia "sucesso". Este teste prova que "" LIMPA mesmo.
    const withDesc = await req('PATCH', `/catalog/products/${pb1}`, {
      token,
      body: { description: 'Descrição a limpar' },
    });
    check('PATCH pôr descrição → 200', withDesc.status === 200, `got ${withDesc.status}`);
    check('descrição gravada', withDesc.json?.description === 'Descrição a limpar', `got ${JSON.stringify(withDesc.json?.description)}`);
    const cleared = await req('PATCH', `/catalog/products/${pb1}`, {
      token,
      body: { description: '' },
    });
    check('PATCH limpar descrição ("") → 200', cleared.status === 200, `got ${cleared.status}`);
    check('descrição REALMENTE limpa (não manteve a antiga)', cleared.json?.description === '',
      `got ${JSON.stringify(cleared.json?.description)} — se for a antiga, a armadilha do undefined voltou`);

    // =========================================================================
    // N. Menus separados (Fase 1 dine-in): isolamento Delivery vs Sala
    // =========================================================================
    console.log('— N. menus separados');
    const catSala = await req('POST', `/catalog/categories?menu=dine_in`, {
      token, body: { name: `Sala ${RUN}` },
    });
    check('criar categoria na Sala → 201', catSala.status === 201, `got ${catSala.status}`);
    created.catSala = catSala.json?.id;

    const listaDelivery = await req('GET', `/catalog/categories?menu=delivery`, { token });
    check(
      'categoria da Sala NÃO aparece no Delivery',
      Array.isArray(listaDelivery.json) && !listaDelivery.json.some((c) => c.id === created.catSala),
    );
    const listaSala = await req('GET', `/catalog/categories?menu=dine_in`, { token });
    check(
      'categoria da Sala aparece na Sala',
      Array.isArray(listaSala.json) && listaSala.json.some((c) => c.id === created.catSala),
    );

    // produto na Sala não aparece na lista de produtos do Delivery
    const prodSala = await req('POST', `/catalog/products`, {
      token, body: { categoryId: created.catSala, name: `PSala ${RUN}`, price: 5 },
    });
    check('criar produto na Sala → 201', prodSala.status === 201, `got ${prodSala.status}`);
    created.prodSala = prodSala.json?.id;
    const prodsDelivery = await req('GET', `/catalog/products?menu=delivery`, { token });
    check(
      'produto da Sala NÃO aparece nos produtos do Delivery',
      Array.isArray(prodsDelivery.json) && !prodsDelivery.json.some((p) => p.id === created.prodSala),
    );

    // guarda: grupo da Sala não anexa a produto do Delivery
    const grpSala = await req('POST', `/catalog/modifier-groups?menu=dine_in`, {
      token, body: { name: `GSala ${RUN}`, required: false, maxSelect: 1 },
    });
    created.grpSala = grpSala.json?.id;
    // `created.catA`/produto do Delivery são criados mais acima no script; usar um produto do Delivery.
    const algumProdDelivery = (prodsDelivery.json ?? [])[0]?.id;
    if (algumProdDelivery) {
      const attach = await req(
        'POST', `/catalog/products/${algumProdDelivery}/modifier-groups/${created.grpSala}`, { token },
      );
      check('anexar grupo da Sala a produto do Delivery → 400', attach.status === 400, `got ${attach.status}`);
    }

    // público: sem type = Delivery; type=dine_in mostra a Sala
    const pubDelivery = await req('GET', `/public/stores/pizzaria-demo/menu`, {});
    check('menu público sem type = Delivery (200)', pubDelivery.status === 200, `got ${pubDelivery.status}`);
    check(
      'menu público (delivery) NÃO tem a categoria da Sala',
      Array.isArray(pubDelivery.json) && !pubDelivery.json.some((c) => c.id === created.catSala),
    );
  } catch (e) {
    console.error('erro fatal durante os testes:', e);
    failed++;
  } finally {
    // Limpeza: apagar as categorias criadas (cascade apaga os produtos) e o fixture de outro tenant.
    try {
      if (created.catA) await req('DELETE', `/catalog/categories/${created.catA}`, { token });
      if (created.catB) await req('DELETE', `/catalog/categories/${created.catB}`, { token });
      if (foreign.productId) await prisma.product.delete({ where: { id: foreign.productId } }).catch(() => {});
      if (foreign.categoryId) await prisma.category.delete({ where: { id: foreign.categoryId } }).catch(() => {});
      if (created.prodSala) await prisma.product.delete({ where: { id: created.prodSala } }).catch(() => {});
      if (created.grpSala) await prisma.modifierGroup.delete({ where: { id: created.grpSala } }).catch(() => {});
      if (created.catSala) await prisma.category.delete({ where: { id: created.catSala } }).catch(() => {});
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
