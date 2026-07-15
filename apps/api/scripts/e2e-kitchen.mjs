/**
 * E2e do papel KITCHEN + emparelhamento (Fase 1 da app de cozinha).
 * Requer a stack local: embedded-db (serve) + API em http://localhost:3001.
 *   node scripts/e2e-kitchen.mjs
 */
const BASE = process.env.API_URL ?? 'http://localhost:3001/api';

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
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* respostas vazias */
  }
  return { status: res.status, json };
}

function jwtPayload(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
}

// procura recursivamente objetos que pareçam produtos (id + name + price-like)
function findProducts(node, out = []) {
  if (Array.isArray(node)) node.forEach((n) => findProducts(n, out));
  else if (node && typeof node === 'object') {
    if (node.id && node.name && ('price' in node || 'basePrice' in node)) out.push(node);
    Object.values(node).forEach((v) => findProducts(v, out));
  }
  return out;
}

async function main() {
  console.log('— login do dono');
  const owner = await req('POST', '/auth/login', {
    body: { email: 'dono@pizzaria-demo.pt', password: 'demo1234' },
  });
  check('owner login 201', owner.status === 201, `got ${owner.status}`);
  const ownerToken = owner.json.accessToken;

  console.log('— lockout: 5 tentativas erradas bloqueiam o código');
  const gen1 = await req('POST', '/tenants/me/kitchen/pair-code', { token: ownerToken });
  check('gerar código 201', gen1.status === 201, `got ${gen1.status}`);
  const code1 = gen1.json.code;
  const wrong = code1.slice(0, -4) + (code1.endsWith('AAAA') ? 'BBBB' : 'AAAA');
  for (let i = 0; i < 5; i++) {
    const r = await req('POST', '/auth/kitchen/pair', { body: { code: wrong } });
    check(`tentativa errada ${i + 1} → 401`, r.status === 401, `got ${r.status}`);
  }
  const lockedTry = await req('POST', '/auth/kitchen/pair', { body: { code: code1 } });
  check('código certo mas bloqueado → 401', lockedTry.status === 401, `got ${lockedTry.status}`);

  console.log('— emparelhar com código novo');
  const gen2 = await req('POST', '/tenants/me/kitchen/pair-code', { token: ownerToken });
  const pair = await req('POST', '/auth/kitchen/pair', { body: { code: gen2.json.code } });
  check('pair 201', pair.status === 201, `got ${pair.status} ${JSON.stringify(pair.json)}`);
  check('role KITCHEN', pair.json?.user?.role === 'KITCHEN');
  check('tem refreshToken', !!pair.json?.refreshToken);
  const kToken = pair.json.accessToken;
  const kRefresh1 = pair.json.refreshToken;
  const pairedTenantId = pair.json.tenant.id;

  console.log('— uso-único: reusar o mesmo código falha');
  const reuse = await req('POST', '/auth/kitchen/pair', { body: { code: gen2.json.code } });
  check('reuso do código → 401', reuse.status === 401, `got ${reuse.status}`);

  console.log('— código minúsculas/sem hífens também funciona (normalização)');
  const gen3 = await req('POST', '/tenants/me/kitchen/pair-code', { token: ownerToken });
  const sloppy = gen3.json.code.toLowerCase().replaceAll('-', '');
  const pairSloppy = await req('POST', '/auth/kitchen/pair', { body: { code: sloppy } });
  check('pair com código "sujo" 201', pairSloppy.status === 201, `got ${pairSloppy.status}`);

  console.log('— matriz de permissões do KITCHEN');
  const matrix = [
    ['GET', '/orders', 200],
    ['GET', '/tenants/me', 200],
    ['GET', '/tenants/me/hours', 200],
    ['GET', '/orders/summary', 403],
    ['GET', '/tenants/mine', 403],
    ['PATCH', '/tenants/me', 403],
    ['POST', '/tenants', 403],
    ['PUT', '/tenants/me/hours', 403],
    ['POST', '/auth/switch', 403],
    ['GET', '/tenants/me/kitchen', 403],
    ['POST', '/tenants/me/kitchen/pair-code', 403],
    ['DELETE', '/tenants/me/kitchen', 403],
  ];
  for (const [method, path, expected] of matrix) {
    const r = await req(method, path, {
      token: kToken,
      body: method === 'GET' ? undefined : { name: 'x', slug: 'x', tenantId: 'x', hours: [] },
    });
    check(`${method} ${path} → ${expected}`, r.status === expected, `got ${r.status}`);
  }

  console.log('— payload mínimo de /tenants/me para KITCHEN');
  const kMe = await req('GET', '/tenants/me', { token: kToken });
  check('KITCHEN /tenants/me tem name', typeof kMe.json?.name === 'string');
  check('KITCHEN /tenants/me SEM subscription', !('subscription' in (kMe.json ?? {})));
  check('KITCHEN /tenants/me SEM stripeSubscriptionId', !('stripeSubscriptionId' in (kMe.json ?? {})));
  const oMe = await req('GET', '/tenants/me', { token: ownerToken });
  check('OWNER /tenants/me mantém subscription', 'subscription' in (oMe.json ?? {}));

  console.log('— KITCHEN avança um pedido (fluxo principal da cozinha)');
  // Nota: GET /public/stores/:slug devolve só metadados da loja (sem produtos,
  // mas com minOrderValue); os produtos estão em GET /public/stores/:slug/menu
  // (categorias → products[]).
  const storeInfo = await req('GET', '/public/stores/pizzaria-demo');
  const store = await req('GET', '/public/stores/pizzaria-demo/menu');
  const product = findProducts(store.json)[0];
  check('há produto na loja pública', !!product);
  if (product) {
    const price = Number(product.price ?? product.basePrice ?? 0);
    const minOrderValue = Number(storeInfo.json?.minOrderValue ?? 0);
    const quantity = price > 0 ? Math.max(1, Math.ceil(minOrderValue / price)) : 1;
    const created = await req('POST', '/public/stores/pizzaria-demo/orders', {
      body: {
        items: [{ productId: product.id, quantity }],
        type: 'PICKUP',
        customerName: 'Teste Cozinha',
        customerPhone: '912345678',
        paymentMethod: 'CASH',
      },
    });
    check('pedido público criado 201', created.status === 201, `got ${created.status} ${JSON.stringify(created.json)}`);
    if (created.status === 201) {
      const orderId = created.json.id;
      const upd = await req('PATCH', `/orders/${orderId}/status`, {
        token: kToken,
        body: { status: 'ACCEPTED' },
      });
      check('KITCHEN PATCH status → 200', upd.status === 200, `got ${upd.status}`);
    }
  }

  console.log('— pin de unidade: refresh ignora tenantId de outra unidade');
  const unit2 = await req('POST', '/tenants', {
    token: ownerToken,
    body: { name: 'Unidade Teste Cozinha', slug: `un-teste-coz-${Date.now()}` },
  });
  check('2ª unidade criada 201', unit2.status === 201, `got ${unit2.status}`);
  const ref1 = await req('POST', '/auth/refresh', {
    body: { refreshToken: kRefresh1, tenantId: unit2.json?.id },
  });
  check('refresh do KITCHEN 201', ref1.status === 201, `got ${ref1.status}`);
  const pinned = jwtPayload(ref1.json.accessToken).tenantId;
  check('token continua preso à unidade emparelhada', pinned === pairedTenantId, `got ${pinned}`);
  const kRefresh2 = ref1.json.refreshToken;

  console.log('— reutilização de refresh revoga a família');
  const replay = await req('POST', '/auth/refresh', { body: { refreshToken: kRefresh1 } });
  check('replay do refresh antigo → 401', replay.status === 401, `got ${replay.status}`);
  const familyDead = await req('POST', '/auth/refresh', { body: { refreshToken: kRefresh2 } });
  check('família toda revogada → 401', familyDead.status === 401, `got ${familyDead.status}`);

  console.log('— desemparelhar corta a sessão');
  const gen4 = await req('POST', '/tenants/me/kitchen/pair-code', { token: ownerToken });
  const pair4 = await req('POST', '/auth/kitchen/pair', { body: { code: gen4.json.code } });
  check('re-pair 201', pair4.status === 201, `got ${pair4.status}`);
  const status1 = await req('GET', '/tenants/me/kitchen', { token: ownerToken });
  check('estado paired=true', status1.json?.paired === true, JSON.stringify(status1.json));
  const unpair = await req('DELETE', '/tenants/me/kitchen', { token: ownerToken });
  check('unpair 200', unpair.status === 200, `got ${unpair.status}`);
  const afterUnpair = await req('POST', '/auth/refresh', {
    body: { refreshToken: pair4.json.refreshToken },
  });
  check('refresh pós-unpair → 401', afterUnpair.status === 401, `got ${afterUnpair.status}`);
  const status2 = await req('GET', '/tenants/me/kitchen', { token: ownerToken });
  check('estado paired=false', status2.json?.paired === false, JSON.stringify(status2.json));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('erro fatal:', e);
  process.exit(1);
});
