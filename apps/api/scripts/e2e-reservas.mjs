/**
 * E2e de reservas de mesas (Fase R1: disponibilidade, corridas, tokens, matriz, gating).
 * Requer a stack local: DB :5433 + API em http://localhost:3001 (watch).
 *   node scripts/e2e-reservas.mjs
 *
 * Segue o padrão de e2e-kitchen.mjs (helpers req/check, contadores, exit code).
 *
 * NOTAS DE DESENHO (documentadas no report):
 * - As janelas de reserva (ReservationWindow) são por WEEKDAY, não por data — por
 *   isso cada grupo de checks que precisa de mesas "limpas" usa uma DATA FUTURA
 *   DIFERENTE mas do MESMO weekday de "amanhã" (+7 dias entre grupos), evitando
 *   que reservas de um ponto interfiram na ocupação de mesas testada noutro ponto.
 *   Isto exige reservationMaxAdvanceDays maior que o default (30) — sobe-se para
 *   90 no PATCH inicial (restaurado no fim).
 * - Pré-ocupações de mesas específicas usam reservas MANUAL com `tableIds` forçado
 *   (o painel ignora capacidade/joinable ao forçar — serve só para "encher" mesas
 *   de forma determinística sem gastar o throttle público de 5/min).
 * - O throttle público (5/min por IP em POST /public/.../reservations) é gerido
 *   com pacing (sleeps ~13s entre grupos de até 5 POSTs) + retry único em caso de
 *   429. Desde a R3 o cap por contacto é 409 (CONTACT_CAP), logo TODO o 429 é do
 *   throttle — já não é preciso distingui-los pela mensagem.
 * - Cada balde do throttle é por HANDLER (slots 30/min, days 30/min, POST 5/min,
 *   GET/cancel por code 10/min), por isso os pontos 23 e 25 pedem baldes limpos e
 *   pagam um sleep de 61s cada um: o teste do lote gasta 30 GETs de slots de uma vez
 *   e o tracker do throttle precisa que o 6.º POST seja inequivocamente o 6.º.
 * - Viajar no tempo (TTL do token, cancelamento tardio) não tem endpoint: o ponto 22
 *   mexe em startsAt/endsAt por prisma direto, a mesma exceção documentada abaixo.
 * - Limpeza final: a API não expõe "apagar reserva" (só mudar estado) e
 *   DELETE /tables/:id recusa mesas com histórico — por isso a limpeza de
 *   reservas/mesas/janelas/blocos usa o Prisma diretamente (única exceção ao
 *   "tudo via HTTP" deste script, só para arrumar a BD no fim). A config do
 *   tenant é restaurada via PATCH /tenants/me (HTTP) para os valores originais.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');

const BASE = process.env.API_URL ?? 'http://localhost:3001/api';
const SOCKET_URL = process.env.SOCKET_URL ?? 'http://localhost:3001';
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://comanda:comanda@localhost:5433/comanda?schema=public';
const SLUG = 'pizzaria-demo';
const RUN = Date.now(); // sufixo para contactos/slugs únicos por corrida

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

async function req(method, path, { token, body, headers } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers ?? {}),
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- datas: "amanhã" em Europe/Lisbon + N dias (mesma "semana lógica" = mesmo weekday) ----
function lisbonTodayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon' }).format(new Date());
}
function addDaysISO(dateISO, n) {
  const [y, m, d] = dateISO.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
function weekdayOf(dateISO) {
  return new Date(`${dateISO}T12:00:00Z`).getUTCDay();
}
function hhmmInTz(isoOrDate, tz = 'Europe/Lisbon') {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(isoOrDate));
}

const TODAY = lisbonTodayISO();
const DATE_A = addDaysISO(TODAY, 1); // amanhã — grid, 1ª reserva, ocupação parcial
const DATE_B = addDaysISO(TODAY, 8); // corrida
const DATE_C = addDaysISO(TODAY, 15); // par juntável
const DATE_D = addDaysISO(TODAY, 22); // fallback VIP (manual)
const DATE_E = addDaysISO(TODAY, 29); // cap por contacto + GET/cancel por token
const DATE_F = addDaysISO(TODAY, 36); // manual invisível ao público
const DATE_G = addDaysISO(TODAY, 43); // edição
const DATE_H = addDaysISO(TODAY, 50); // NO_SHOW liberta
const DATE_I = addDaysISO(TODAY, 57); // bloqueio de dia
const DATE_SOCKET = addDaysISO(TODAY, 64); // gatilho do teste de socket
const DATE_J = addDaysISO(TODAY, 71); // janela larga: alternativas por proximidade, TTL, cancelamento tardio
const WEEKDAY = weekdayOf(DATE_A);

async function slots(date, party, token) {
  return req('GET', `/public/stores/${SLUG}/reservation-slots?date=${date}&party=${party}`, { token });
}

// throttle dedicado dos slots: 30/min por IP. Ao varrer 30 dias de uma vez fica-se no
// limite exato — retry único (61s) para a corrida não produzir uma falha falsa.
async function slotsSafe(date, party) {
  let r = await slots(date, party);
  if (r.status === 429) {
    console.log('    … 429 de throttle nos slots — sleep 61s e retry único');
    await sleep(61_000);
    r = await slots(date, party);
  }
  return r;
}

async function days(from, to, party) {
  return req(
    'GET',
    `/public/stores/${SLUG}/reservation-days?from=${from}&to=${to}&party=${party}`,
  );
}

/** "HH:MM" → minutos do dia (só para o teste; o servidor compara instantes). */
function minutesOfLabel(label) {
  return Number(label.slice(0, 2)) * 60 + Number(label.slice(3, 5));
}

let contactSeq = 0;
function contact(prefix) {
  contactSeq++;
  // sufixo sequencial (não só 1 dígito aleatório) — evita colisões acidentais de
  // telefone entre pontos diferentes do script, que disparariam o cap por engano
  return {
    customerEmail: `${prefix}-${RUN}-${contactSeq}@teste.pt`,
    customerPhone: `9${String(RUN).slice(-6)}${String(contactSeq).padStart(3, '0')}`,
  };
}

// throttle público: 5/min por IP em POST /public/stores/:slug/reservations — retry
// único com sleep de 61s. Desde a R3 o cap por contacto é 409, logo todo o 429 é throttle.
async function publicPost(date, time, partySize, extra, contactPrefix) {
  const body = { date, time, partySize, customerName: 'Cliente Teste', ...contact(contactPrefix), ...extra };
  let res = await req('POST', `/public/stores/${SLUG}/reservations`, { body });
  if (res.status === 429) {
    console.log('    … 429 de throttle — sleep 61s e retry único');
    await sleep(61_000);
    res = await req('POST', `/public/stores/${SLUG}/reservations`, { body });
  }
  return res;
}

async function manualBook(ownerToken, { date, time, partySize, tableIds, customerName, notes }) {
  return req('POST', '/reservations', {
    token: ownerToken,
    body: { date, time, partySize, customerName: customerName ?? 'Bloqueio Manual', customerPhone: '910000000', tableIds, notes },
  });
}

async function reservationIdByCode(ownerToken, date, code) {
  const r = await req('GET', `/reservations?date=${date}`, { token: ownerToken });
  return r.json?.find((x) => x.code === code)?.id;
}

async function tableNameOfReservation(ownerToken, date, code) {
  const r = await req('GET', `/reservations?date=${date}`, { token: ownerToken });
  const row = r.json?.find((x) => x.code === code);
  return row?.tables?.[0]?.table?.name;
}

async function cleanup(prisma, tenantId, ownerToken, originalConfig) {
  console.log('\n— limpeza final —');
  try {
    if (tenantId) {
      const delRes = await prisma.reservation.deleteMany({ where: { tenantId } });
      const delTab = await prisma.table.deleteMany({ where: { tenantId } });
      const delBlk = await prisma.reservationBlock.deleteMany({ where: { tenantId } });
      const delWin = await prisma.reservationWindow.deleteMany({ where: { tenantId } });
      console.log(
        `  apagados: ${delRes.count} reservas, ${delTab.count} mesas, ${delBlk.count} bloqueios, ${delWin.count} janelas (prisma direto)`,
      );
    }
  } catch (e) {
    console.error('  limpeza direta (prisma) falhou:', e?.message ?? e);
  }
  try {
    if (ownerToken) {
      const data = originalConfig ?? { reservationsEnabled: false };
      const r = await req('PATCH', '/tenants/me', { token: ownerToken, body: data });
      console.log(`  config do tenant restaurada (PATCH /tenants/me) → ${r.status}`);
    }
  } catch (e) {
    console.error('  restauro da config do tenant falhou:', e?.message ?? e);
  }
  try {
    if (ownerToken) await req('DELETE', '/tenants/me/kitchen', { token: ownerToken });
  } catch {
    /* melhor esforço */
  }
}

async function main() {
  const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
  let ownerToken;
  let tenantId;
  let originalConfig;

  try {
    // =========================================================================
    // 1. Login owner; PATCH /tenants/me (config de reservas)
    // =========================================================================
    console.log('— 1. login + configuração de reservas');
    const login = await req('POST', '/auth/login', { body: { email: 'dono@pizzaria-demo.pt', password: 'demo1234' } });
    check('owner login 201', login.status === 201, `got ${login.status}`);
    ownerToken = login.json.accessToken;

    const before = await req('GET', '/tenants/me', { token: ownerToken });
    tenantId = before.json?.id;
    check('tenant id obtido', !!tenantId);
    originalConfig = {
      reservationsEnabled: before.json.reservationsEnabled,
      reservationDurationMin: before.json.reservationDurationMin,
      reservationBufferMin: before.json.reservationBufferMin,
      reservationMinNoticeMin: before.json.reservationMinNoticeMin,
      reservationMaxAdvanceDays: before.json.reservationMaxAdvanceDays,
      reservationMaxPartySize: before.json.reservationMaxPartySize,
    };

    const cfg = await req('PATCH', '/tenants/me', {
      token: ownerToken,
      body: {
        reservationDurationMin: 120,
        reservationMinNoticeMin: 0,
        reservationBufferMin: 0,
        // acima do default (30) — testes usam datas até +64 dias para isolar
        // estado de mesas por ponto (janelas são por weekday, não por data).
        reservationMaxAdvanceDays: 90,
      },
    });
    check('PATCH /tenants/me 200', cfg.status === 200, `got ${cfg.status} ${JSON.stringify(cfg.json)}`);

    // A guarda de prontidão (R3) recusa ligar reservas com 0 mesas reserváveis — e o ponto 2
    // precisa exatamente do estado que ela proíbe (reservas ligadas, 0 mesas). Prova-se a
    // recusa por HTTP e liga-se o interruptor por prisma direto (a mesma exceção documentada
    // no cabeçalho para a limpeza). As mesas só nascem no ponto 3.
    const enableNoTables = await req('PATCH', '/tenants/me', {
      token: ownerToken,
      body: { reservationsEnabled: true },
    });
    check(
      'ligar reservas sem mesas reserváveis → 400',
      enableNoTables.status === 400,
      `got ${enableNoTables.status} ${JSON.stringify(enableNoTables.json)}`,
    );
    await prisma.tenant.update({ where: { id: tenantId }, data: { reservationsEnabled: true } });
    const afterEnable = await req('GET', '/tenants/me', { token: ownerToken });
    check('reservationsEnabled true', afterEnable.json?.reservationsEnabled === true, JSON.stringify(afterEnable.json?.reservationsEnabled));

    // =========================================================================
    // 2. Slots ANTES de mesas → lista vazia
    // =========================================================================
    console.log('— 2. slots antes de existirem mesas/janelas');
    const beforeTables = await slots(DATE_A, 2);
    check('GET slots 200', beforeTables.status === 200, `got ${beforeTables.status}`);
    check('slots vazios sem mesas/janelas', Array.isArray(beforeTables.json?.slots) && beforeTables.json.slots.length === 0);

    // =========================================================================
    // 3. Criar mesas
    // =========================================================================
    console.log('— 3. criar mesas');
    const mkTable = async (name, seats, extra) => {
      const r = await req('POST', '/tables', { token: ownerToken, body: { name, seats, ...extra } });
      check(`mesa ${name} criada 201`, r.status === 201, `got ${r.status} ${JSON.stringify(r.json)}`);
      return r.json?.id;
    };
    const m2Id = await mkTable('M2', 2, { area: 'Sala', joinable: true, sortOrder: 1 });
    const m2bId = await mkTable('M2b', 2, { area: 'Sala', joinable: true, sortOrder: 2 });
    const m4Id = await mkTable('M4', 4, { area: 'Sala', sortOrder: 3 });
    const m8Id = await mkTable('M8', 8, { area: 'Esplanada', sortOrder: 4 });
    const vipId = await mkTable('VIP', 6, { bookableOnline: false, sortOrder: 5 });
    const tableIdByName = { M2: m2Id, M2b: m2bId, M4: m4Id, M8: m8Id, VIP: vipId };

    const listT = await req('GET', '/tables', { token: ownerToken });
    check('listagem tem as 5 mesas', listT.json?.length === 5, `got ${listT.json?.length}`);

    // =========================================================================
    // 4. PUT /reservation-windows: amanhã (weekday calculado) 12:00–14:00
    // =========================================================================
    console.log(`— 4. janela de reservas (weekday ${WEEKDAY}, 12:00–14:00)`);
    const win = await req('PUT', '/reservation-windows', {
      token: ownerToken,
      body: { windows: [{ weekday: WEEKDAY, openMinute: 720, closeMinute: 840 }] },
    });
    check('PUT windows 200', win.status === 200, `got ${win.status} ${JSON.stringify(win.json)}`);
    check('janela devolvida', win.json?.length === 1 && win.json[0].weekday === WEEKDAY);

    // =========================================================================
    // 5. Slots amanhã party=2 → contém 12:00 e 14:00, não 14:30
    // =========================================================================
    console.log('— 5. grelha de slots (12:00–14:00, passo 30)');
    const gridSlots = await slots(DATE_A, 2);
    check('slots 200', gridSlots.status === 200, `got ${gridSlots.status}`);
    check('12:00 presente', gridSlots.json?.slots?.includes('12:00'), JSON.stringify(gridSlots.json));
    check('14:00 presente (inclusive)', gridSlots.json?.slots?.includes('14:00'), JSON.stringify(gridSlots.json));
    check('14:30 ausente (fora da grelha)', !gridSlots.json?.slots?.includes('14:30'), JSON.stringify(gridSlots.json));

    // =========================================================================
    // 6. Reservar 12:00 party=2 (ONLINE) → 201, code+manageUrl, mesa=M2
    // =========================================================================
    console.log('— 6. 1ª reserva pública (12:00, party 2)');
    const r6 = await publicPost(DATE_A, '12:00', 2, {}, 'p6');
    check('POST público 201', r6.status === 201, `got ${r6.status} ${JSON.stringify(r6.json)}`);
    check('tem code', typeof r6.json?.code === 'string');
    check('tem manageUrl', typeof r6.json?.manageUrl === 'string' && r6.json.manageUrl.includes('#t='));
    check('mesa atribuída = M2', JSON.stringify(r6.json?.tableNames) === JSON.stringify(['M2']), JSON.stringify(r6.json?.tableNames));

    // =========================================================================
    // 7. Ocupação parcial: 12:00 ausente p/ party=9, presente p/ party=2 (M2b livre)
    // =========================================================================
    console.log('— 7. ocupação parcial em 12:00 (M2 já ocupada)');
    const s7big = await slots(DATE_A, 9);
    check('12:00 ausente p/ party=9 (só M8 cabe e é <9)', !s7big.json?.slots?.includes('12:00'), JSON.stringify(s7big.json));
    const s7small = await slots(DATE_A, 2);
    check('12:00 presente p/ party=2 (M2b livre)', s7small.json?.slots?.includes('12:00'), JSON.stringify(s7small.json));

    // =========================================================================
    // 8. Corrida: 2 POSTs simultâneos, mesmo slot, party=4 → 1×201 + 1×409(alternatives)
    // =========================================================================
    console.log('— 8. corrida na mesma vaga (party=4)');
    // pré-ocupa M2 (a única mesa >=4 além de M4 seria M8) para que só M4 sirva sozinha
    const preRace = await manualBook(ownerToken, { date: DATE_B, time: '12:00', partySize: 10, tableIds: [m2Id, m8Id], customerName: 'Bloqueio Corrida' });
    check('pré-bloqueio M2+M8 (manual) 201', preRace.status === 201, `got ${preRace.status} ${JSON.stringify(preRace.json)}`);

    const bodyRaceA = { date: DATE_B, time: '12:00', partySize: 4, customerName: 'Corrida A', ...contact('raceA') };
    const bodyRaceB = { date: DATE_B, time: '12:00', partySize: 4, customerName: 'Corrida B', ...contact('raceB') };
    const [raceA, raceB] = await Promise.all([
      req('POST', `/public/stores/${SLUG}/reservations`, { body: bodyRaceA }),
      req('POST', `/public/stores/${SLUG}/reservations`, { body: bodyRaceB }),
    ]);
    const statuses = [raceA.status, raceB.status].sort();
    check('exatamente um 201 e um 409', statuses[0] === 201 && statuses[1] === 409, `got ${JSON.stringify(statuses)}`);
    const loser = raceA.status === 409 ? raceA : raceB;
    check('perdedor tem alternatives (array)', Array.isArray(loser.json?.alternatives), JSON.stringify(loser.json));
    const winner = raceA.status === 201 ? raceA : raceB;
    check('vencedor ficou com M4', JSON.stringify(winner.json?.tableNames) === JSON.stringify(['M4']), JSON.stringify(winner.json?.tableNames));

    // =========================================================================
    // 9. Par juntável: party=4 às 13:00 quando só M2+M2b restam → 201, 2 mesas
    // =========================================================================
    console.log('— 9. par juntável (M2+M2b)');
    const preC = await manualBook(ownerToken, { date: DATE_C, time: '12:00', partySize: 10, tableIds: [m4Id, m8Id], customerName: 'Bloqueio Par' });
    check('pré-bloqueio M4+M8 (manual) 201', preC.status === 201, `got ${preC.status} ${JSON.stringify(preC.json)}`);
    const r9 = await publicPost(DATE_C, '13:00', 4, {}, 'p9');
    check('POST par juntável 201', r9.status === 201, `got ${r9.status} ${JSON.stringify(r9.json)}`);
    const namesSet9 = new Set(r9.json?.tableNames ?? []);
    check('2 mesas M2+M2b da mesma área', namesSet9.size === 2 && namesSet9.has('M2') && namesSet9.has('M2b'), JSON.stringify(r9.json?.tableNames));

    // =========================================================================
    // 10. ONLINE nunca usa a VIP (409); MANUAL nas mesmas condições → 201 na VIP
    // =========================================================================
    console.log('— 10. fallback VIP (só em MANUAL)');
    const preD1 = await manualBook(ownerToken, { date: DATE_D, time: '12:00', partySize: 10, tableIds: [m2Id, m2bId], customerName: 'Bloqueio VIP 1' });
    const preD2 = await manualBook(ownerToken, { date: DATE_D, time: '12:00', partySize: 10, tableIds: [m4Id, m8Id], customerName: 'Bloqueio VIP 2' });
    check('pré-bloqueio M2+M2b (manual) 201', preD1.status === 201, `got ${preD1.status}`);
    check('pré-bloqueio M4+M8 (manual) 201', preD2.status === 201, `got ${preD2.status}`);
    const r10online = await publicPost(DATE_D, '12:00', 6, {}, 'p10');
    check('ONLINE party=6 sem mesas → 409', r10online.status === 409, `got ${r10online.status} ${JSON.stringify(r10online.json)}`);
    const r10manual = await manualBook(ownerToken, { date: DATE_D, time: '12:00', partySize: 6, customerName: 'Grupo VIP' });
    check('MANUAL party=6 → 201', r10manual.status === 201, `got ${r10manual.status} ${JSON.stringify(r10manual.json)}`);
    check('MANUAL ficou na VIP', r10manual.json?.tables?.some((t) => t.tableId === vipId), JSON.stringify(r10manual.json?.tables));

    // =========================================================================
    // 11. time fora da grelha → 422; fora da janela → 422 (divergência documentada:
    //     o plano original previa 409 para fora-da-janela, a implementação dá 422 em ambos)
    // =========================================================================
    console.log('— 11. validação de hora (grelha / janela)');
    const r11grid = await publicPost(DATE_A, '12:17', 2, {}, 'p11a');
    check('hora fora da grelha (12:17) → 422', r11grid.status === 422, `got ${r11grid.status} ${JSON.stringify(r11grid.json)}`);
    const r11window = await publicPost(DATE_A, '18:00', 2, {}, 'p11b');
    check('hora fora da janela (18:00) → 422 (divergência doc.)', r11window.status === 422, `got ${r11window.status} ${JSON.stringify(r11window.json)}`);

    // ---- divergência documentada: partySize>max → 422 com mensagem; GET slots vazio ----
    console.log('— 11b. divergência: partySize > max (422 + slots vazios)');
    const maxParty = originalConfig.reservationMaxPartySize ?? 12;
    const rMaxSlots = await slots(DATE_A, maxParty + 1);
    check('GET slots party>max → vazio', Array.isArray(rMaxSlots.json?.slots) && rMaxSlots.json.slots.length === 0, JSON.stringify(rMaxSlots.json));
    check('GET slots party>max → reason=party', rMaxSlots.json?.reason === 'party', JSON.stringify(rMaxSlots.json));
    const rMaxPost = await publicPost(DATE_A, '12:00', maxParty + 1, {}, 'pmax');
    check('POST party>max → 422', rMaxPost.status === 422, `got ${rMaxPost.status} ${JSON.stringify(rMaxPost.json)}`);
    check(
      `mensagem menciona "mais de ${maxParty}"`,
      typeof rMaxPost.json?.message === 'string' && rMaxPost.json.message.includes(`mais de ${maxParty}`),
      JSON.stringify(rMaxPost.json),
    );

    console.log('    … pacing: sleep 13s (throttle público 5/min)');
    await sleep(13_000);

    // =========================================================================
    // 12. Cap por contacto NORMALIZADO: 4ª reserva futura → 409 CONTACT_CAP
    // =========================================================================
    console.log('— 12. cap por contacto normalizado (3 ok, 4ª → 409 CONTACT_CAP)');
    // pré-ocupa M4+M8 em DATE_E para que o "slot reappears" do ponto 14 seja nítido
    const preE = await manualBook(ownerToken, { date: DATE_E, time: '12:00', partySize: 10, tableIds: [m4Id, m8Id], customerName: 'Bloqueio Cap' });
    check('pré-bloqueio M4+M8 em DATE_E (manual) 201', preE.status === 201, `got ${preE.status}`);
    const capContact = contact('cap');
    const g1 = await publicPost(DATE_E, '12:00', 2, capContact, 'capA');
    check('1ª reserva do contacto → 201', g1.status === 201, `got ${g1.status} ${JSON.stringify(g1.json)}`);
    const g2 = await publicPost(DATE_E, '12:00', 2, capContact, 'capB');
    check('2ª reserva do contacto → 201', g2.status === 201, `got ${g2.status} ${JSON.stringify(g2.json)}`);
    // 3ª com o MESMO contacto escrito de outra forma (email em maiúsculas, telefone com
    // indicativo e espaços): se a normalização não funcionar, isto conta como um contacto
    // NOVO e a 4ª passa a 201 — este 201 é que arma o 409 seguinte. Vai às 14:00 porque às
    // 12:00 M2+M2b já estão cheias (o ponto 14 depende disso) e às 14:00 as mesas do
    // pré-bloqueio (12:00–14:00, duração 120) já estão livres.
    const capContactVariant = {
      customerEmail: capContact.customerEmail.toUpperCase(),
      customerPhone: `+351 ${capContact.customerPhone}`,
    };
    const g3 = await publicPost(DATE_E, '14:00', 2, capContactVariant, 'capC');
    check('3ª reserva do contacto (email/telefone noutro formato) → 201', g3.status === 201, `got ${g3.status} ${JSON.stringify(g3.json)}`);
    const g4 = await publicPost(DATE_E, '14:00', 2, capContact, 'capD');
    check('4ª reserva do contacto → 409 (e NÃO 429: o 429 é exclusivo do throttle)', g4.status === 409, `got ${g4.status} ${JSON.stringify(g4.json)}`);
    check("4ª traz code 'CONTACT_CAP'", g4.json?.code === 'CONTACT_CAP', JSON.stringify(g4.json));
    check('4ª traz contactPhone do restaurante', 'contactPhone' in (g4.json ?? {}), JSON.stringify(g4.json));

    // =========================================================================
    // 13. GET público por code: sem token → 404; token errado → 404; certo → 200
    // =========================================================================
    console.log('— 13. GET público por code/token');
    const g1Token = g1.json.manageUrl.split('#t=')[1];
    const noToken = await req('GET', `/public/reservations/${g1.json.code}`);
    check('sem token → 404', noToken.status === 404, `got ${noToken.status}`);
    const wrongToken = await req('GET', `/public/reservations/${g1.json.code}`, { headers: { 'x-reservation-token': 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } });
    check('token errado → 404', wrongToken.status === 404, `got ${wrongToken.status}`);
    const rightToken = await req('GET', `/public/reservations/${g1.json.code}`, { headers: { 'x-reservation-token': g1Token } });
    check('token certo → 200', rightToken.status === 200, `got ${rightToken.status}`);
    check('dados corretos (code)', rightToken.json?.code === g1.json.code);

    // =========================================================================
    // 14. Cancel por token → 200; slot reaparece; cancel repetido → erro neutro
    // =========================================================================
    console.log('— 14. cancelamento por token');
    const g2Token = g2.json.manageUrl.split('#t=')[1];
    const beforeCancel = await slots(DATE_E, 2);
    check('12:00 ausente antes de cancelar (M2+M2b cheias)', !beforeCancel.json?.slots?.includes('12:00'), JSON.stringify(beforeCancel.json));
    const cancel1 = await req('POST', `/public/reservations/${g2.json.code}/cancel`, { body: { token: g2Token } });
    // 201, não 200: nenhum @Post deste codebase tem @HttpCode override (confirmado por
    // grep — login/pair/switch devolvem 201 também); "200" no plano foi uma estimativa,
    // não um comportamento implementado — divergência documentada no report.
    check('cancel 201 (default Nest p/ @Post, consistente c/ o resto do codebase)', cancel1.status === 201, `got ${cancel1.status} ${JSON.stringify(cancel1.json)}`);
    const afterCancel = await slots(DATE_E, 2);
    check('12:00 reaparece após cancelar (M2b livre)', afterCancel.json?.slots?.includes('12:00'), JSON.stringify(afterCancel.json));
    const cancel2 = await req('POST', `/public/reservations/${g2.json.code}/cancel`, { body: { token: g2Token } });
    check(
      'cancel repetido → erro (400, neutro — divergência doc. do "404/409" do plano)',
      cancel2.status === 400,
      `got ${cancel2.status} ${JSON.stringify(cancel2.json)}`,
    );

    // =========================================================================
    // 15. Reserva MANUAL → GET público (qualquer token) → 404
    // =========================================================================
    console.log('— 15. reserva MANUAL é invisível ao público');
    const r15 = await manualBook(ownerToken, { date: DATE_F, time: '12:34', partySize: 2, customerName: 'Manual Invisível' });
    check('manual criada 201', r15.status === 201, `got ${r15.status} ${JSON.stringify(r15.json)}`);
    check('hora arredondada a 15min (12:34→12:30)', hhmmInTz(r15.json?.startsAt) === '12:30', hhmmInTz(r15.json?.startsAt));
    const r15get = await req('GET', `/public/reservations/${r15.json.code}`, { headers: { 'x-reservation-token': 'qualquer-coisa' } });
    check('GET público c/ qualquer token → 404', r15get.status === 404, `got ${r15get.status}`);

    // =========================================================================
    // 16. Edição: hora 12:00→13:30 → 200 e reflete; edição p/ slot ocupado → 409
    // =========================================================================
    console.log('— 16. edição de reserva');
    const r16a = await publicPost(DATE_G, '12:00', 2, {}, 'edit1');
    check('R1 criada 201', r16a.status === 201, `got ${r16a.status}`);
    const r16b = await publicPost(DATE_G, '13:30', 2, {}, 'edit2');
    check('R2 criada 201', r16b.status === 201, `got ${r16b.status}`);
    const r1Id = await reservationIdByCode(ownerToken, DATE_G, r16a.json.code);
    check('R1 id encontrado no painel', !!r1Id);
    const r1RowBefore = (await req('GET', `/reservations?date=${DATE_G}`, { token: ownerToken })).json?.find((x) => x.id === r1Id);
    const r1TableIdBefore = r1RowBefore?.tables?.[0]?.tableId;
    const editTime = await req('PATCH', `/reservations/${r1Id}`, { token: ownerToken, body: { time: '13:30' } });
    check('PATCH hora 200', editTime.status === 200, `got ${editTime.status} ${JSON.stringify(editTime.json)}`);
    const r1Row = (await req('GET', `/reservations?date=${DATE_G}`, { token: ownerToken })).json?.find((x) => x.id === r1Id);
    check('hora refletida no painel (13:30)', hhmmInTz(r1Row?.startsAt) === '13:30', hhmmInTz(r1Row?.startsAt));
    const r1TableIdAfter = r1Row?.tables?.[0]?.tableId;
    check(
      'mesa mantida (mesmo tableId)',
      r1Row?.tables?.length === 1 && !!r1TableIdBefore && r1TableIdBefore === r1TableIdAfter,
      `before=${r1TableIdBefore} after=${r1TableIdAfter}`,
    );

    const r2TableName = await tableNameOfReservation(ownerToken, DATE_G, r16b.json.code);
    const r2TableId = tableIdByName[r2TableName];
    const editConflict = await req('PATCH', `/reservations/${r1Id}`, {
      token: ownerToken,
      body: { time: '13:30', tableIds: [r2TableId] },
    });
    check('edição p/ mesa ocupada → 409', editConflict.status === 409, `got ${editConflict.status} ${JSON.stringify(editConflict.json)}`);

    // =========================================================================
    // 17. NO_SHOW liberta a mesa
    // =========================================================================
    console.log('— 17. NO_SHOW liberta a mesa');
    const preH = await manualBook(ownerToken, { date: DATE_H, time: '12:00', partySize: 10, tableIds: [m2bId, m4Id], customerName: 'Bloqueio NoShow 1' });
    const preH2 = await manualBook(ownerToken, { date: DATE_H, time: '12:00', partySize: 10, tableIds: [m8Id], customerName: 'Bloqueio NoShow 2' });
    check('pré-bloqueio M2b+M4 (manual) 201', preH.status === 201, `got ${preH.status}`);
    check('pré-bloqueio M8 (manual) 201', preH2.status === 201, `got ${preH2.status}`);
    const r17 = await publicPost(DATE_H, '12:00', 2, {}, 'noshow');
    check('R3 criada 201 (fica só com M2)', r17.status === 201, `got ${r17.status}`);
    const beforeNoShow = await slots(DATE_H, 2);
    check('12:00 ausente antes do NO_SHOW', !beforeNoShow.json?.slots?.includes('12:00'), JSON.stringify(beforeNoShow.json));
    const r3Id = await reservationIdByCode(ownerToken, DATE_H, r17.json.code);
    const noShow = await req('PATCH', `/reservations/${r3Id}/status`, { token: ownerToken, body: { status: 'NO_SHOW' } });
    check('PATCH status NO_SHOW 200', noShow.status === 200, `got ${noShow.status} ${JSON.stringify(noShow.json)}`);
    const afterNoShow = await slots(DATE_H, 2);
    check('12:00 reaparece após NO_SHOW', afterNoShow.json?.slots?.includes('12:00'), JSON.stringify(afterNoShow.json));

    // =========================================================================
    // 18. Bloqueio de dia: POST block → slots vazios; DELETE block → voltam
    // =========================================================================
    console.log('— 18. bloqueio de dia inteiro');
    const blockCreate = await req('POST', '/reservation-blocks', { token: ownerToken, body: { date: DATE_I, reason: 'Teste e2e' } });
    check('block criado 201', blockCreate.status === 201, `got ${blockCreate.status} ${JSON.stringify(blockCreate.json)}`);
    const slotsBlocked = await slots(DATE_I, 2);
    check('slots vazios com bloqueio', Array.isArray(slotsBlocked.json?.slots) && slotsBlocked.json.slots.length === 0, JSON.stringify(slotsBlocked.json));
    const blocksList = await req('GET', '/reservation-blocks', { token: ownerToken });
    const blockId = blocksList.json?.find((b) => b.date === DATE_I)?.id;
    check('bloqueio encontrado na listagem', !!blockId);
    const blockDelete = await req('DELETE', `/reservation-blocks/${blockId}`, { token: ownerToken });
    check('DELETE block 200', blockDelete.status === 200, `got ${blockDelete.status}`);
    const slotsUnblocked = await slots(DATE_I, 2);
    check('slots voltam após remover bloqueio', slotsUnblocked.json?.slots?.includes('12:00'), JSON.stringify(slotsUnblocked.json));

    // =========================================================================
    // 19. Matriz KITCHEN + socket (staff-only)
    // =========================================================================
    console.log('— 19. matriz KITCHEN + socket staff-only');
    const genK = await req('POST', '/tenants/me/kitchen/pair-code', { token: ownerToken });
    check('código de emparelhamento gerado 201', genK.status === 201, `got ${genK.status}`);
    const pairK = await req('POST', '/auth/kitchen/pair', { body: { code: genK.json.code } });
    check('pair KITCHEN 201', pairK.status === 201, `got ${pairK.status}`);
    const kToken = pairK.json.accessToken;

    const matrix = [
      ['GET', '/tables', undefined],
      ['GET', `/reservations?date=${DATE_A}`, undefined],
      ['POST', '/reservations', { date: DATE_A, time: '12:00', partySize: 2, customerName: 'x' }],
      ['PATCH', '/reservations/inexistente-id/status', { status: 'NO_SHOW' }],
      ['PUT', '/reservation-windows', { windows: [] }],
    ];
    for (const [method, path, body] of matrix) {
      const r = await req(method, path, { token: kToken, body });
      check(`${method} ${path} → 403 (KITCHEN)`, r.status === 403, `got ${r.status}`);
    }

    // socket: sala staff recebe reservation.created; KITCHEN não
    let ownerGot = false;
    let kitchenGot = false;
    let socketsOk = true;
    let ownerSocket;
    let kitchenSocket;
    try {
      const { io } = require('../../dashboard/node_modules/socket.io-client');
      ownerSocket = io(SOCKET_URL, { auth: { token: ownerToken }, transports: ['websocket'], forceNew: true });
      kitchenSocket = io(SOCKET_URL, { auth: { token: kToken }, transports: ['websocket'], forceNew: true });
      const waitConnect = (sock) =>
        new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('timeout a ligar')), 5000);
          sock.on('connect', () => {
            clearTimeout(t);
            resolve();
          });
          sock.on('connect_error', (e) => {
            clearTimeout(t);
            reject(e);
          });
        });
      await Promise.all([waitConnect(ownerSocket), waitConnect(kitchenSocket)]);
      ownerSocket.on('reservation.created', () => {
        ownerGot = true;
      });
      kitchenSocket.on('reservation.created', () => {
        kitchenGot = true;
      });
      const trigger = await manualBook(ownerToken, { date: DATE_SOCKET, time: '12:00', partySize: 2, customerName: 'Gatilho Socket' });
      check('reserva-gatilho criada 201', trigger.status === 201, `got ${trigger.status}`);
      await sleep(2000);
    } catch (e) {
      socketsOk = false;
      check('setup de sockets (socket.io-client via dashboard/node_modules)', false, e?.message ?? String(e));
    } finally {
      ownerSocket?.close();
      kitchenSocket?.close();
    }
    if (socketsOk) {
      check('socket OWNER recebeu reservation.created', ownerGot);
      check('socket KITCHEN NÃO recebeu reservation.created', !kitchenGot);
    }

    console.log('    … pacing: sleep 13s (throttle público 5/min)');
    await sleep(13_000);

    // =========================================================================
    // 20. Cross-tenant: 2ª unidade (mesma conta) via /tenants + /auth/switch —
    //     isolamento é por tenantId, não por conta (documentado no brief).
    // =========================================================================
    console.log('— 20. isolamento cross-tenant (2ª unidade, mesma conta)');
    const unit2 = await req('POST', '/tenants', { token: ownerToken, body: { name: 'Unidade Cross Teste', slug: `cross-teste-${RUN}` } });
    check('2ª unidade criada 201', unit2.status === 201, `got ${unit2.status} ${JSON.stringify(unit2.json)}`);
    const switchRes = await req('POST', '/auth/switch', { token: ownerToken, body: { tenantId: unit2.json.id } });
    check('switch para 2ª unidade 201', switchRes.status === 201, `got ${switchRes.status}`);
    const tokenB = switchRes.json.accessToken;

    const crossPatch = await req('PATCH', `/tables/${m2Id}`, { token: tokenB, body: { name: 'Hackeado' } });
    check('PATCH mesa do tenant A com token B → 404', crossPatch.status === 404, `got ${crossPatch.status}`);
    const crossManual = await req('POST', '/reservations', {
      token: tokenB,
      body: { date: DATE_A, time: '12:00', partySize: 2, customerName: 'Cross Teste', tableIds: [m2Id] },
    });
    check('MANUAL c/ tableIds do tenant A no tenant B → 400', crossManual.status === 400, `got ${crossManual.status} ${JSON.stringify(crossManual.json)}`);

    // =========================================================================
    // 21. DELETE /tables/:id: mesa com histórico → 409; mesa virgem → 200
    // =========================================================================
    console.log('— 21. apagar mesa (histórico vs virgem)');
    const delM2 = await req('DELETE', `/tables/${m2Id}`, { token: ownerToken });
    check('apagar M2 (tem histórico) → 409', delM2.status === 409, `got ${delM2.status} ${JSON.stringify(delM2.json)}`);
    const virgin = await req('POST', '/tables', { token: ownerToken, body: { name: 'Mesa Virgem', seats: 2 } });
    check('mesa virgem criada 201', virgin.status === 201, `got ${virgin.status}`);
    const delVirgin = await req('DELETE', `/tables/${virgin.json.id}`, { token: ownerToken });
    check('apagar mesa virgem → 200', delVirgin.status === 200, `got ${delVirgin.status} ${JSON.stringify(delVirgin.json)}`);

    // =========================================================================
    // 22. Janela larga (DATE_J): alternativas do 409 por PROXIMIDADE, Turnstile
    //     no-op, TTL do token e cancelamento tardio (entre startsAt e endsAt)
    // =========================================================================
    console.log('— 22. janela larga: alternativas por proximidade, Turnstile no-op, TTL, cancelamento tardio');
    // A janela 12:00–14:00 dos pontos anteriores só dá 5 slots — poucos para distinguir
    // "4 mais próximos" de "4 primeiros do dia". Alarga-se aqui (o PUT substitui a lista
    // toda) porque todos os pontos que dependiam da janela estreita já correram.
    const wideWin = await req('PUT', '/reservation-windows', {
      token: ownerToken,
      body: { windows: [{ weekday: WEEKDAY, openMinute: 720, closeMinute: 1320 }] }, // 12:00–22:00
    });
    check('PUT janela larga 12:00–22:00 200', wideWin.status === 200, `got ${wideWin.status} ${JSON.stringify(wideWin.json)}`);

    // Ocupa TODAS as mesas reserváveis online às 20:00 (duração 120 → [20:00, 22:00)):
    // sobra 12:00–18:00 antes e 22:00 depois, logo os 4 mais próximos de 20:00 caem nas
    // duas pontas e NUNCA coincidem com os 4 primeiros do dia (12:00–13:30).
    const preJ1 = await manualBook(ownerToken, { date: DATE_J, time: '20:00', partySize: 10, tableIds: [m2Id, m2bId], customerName: 'Bloqueio Prox 1' });
    const preJ2 = await manualBook(ownerToken, { date: DATE_J, time: '20:00', partySize: 10, tableIds: [m4Id, m8Id], customerName: 'Bloqueio Prox 2' });
    check('pré-bloqueio M2+M2b às 20:00 (manual) 201', preJ1.status === 201, `got ${preJ1.status} ${JSON.stringify(preJ1.json)}`);
    check('pré-bloqueio M4+M8 às 20:00 (manual) 201', preJ2.status === 201, `got ${preJ2.status} ${JSON.stringify(preJ2.json)}`);

    const availJ = (await slotsSafe(DATE_J, 2)).json?.slots ?? [];
    check('20:00 ausente (todas as mesas online ocupadas)', !availJ.includes('20:00'), JSON.stringify(availJ));
    check('sobram slots suficientes p/ 4 alternativas', availJ.length > 4, JSON.stringify(availJ));
    // Expectativa derivada dos slots REAIS do servidor com a mesma regra (|distância| e depois
    // cronológico) — se o service voltar ao slice(0,4) cru, isto falha.
    const wantedMin = minutesOfLabel('20:00');
    const expectedAlts = availJ
      .slice()
      .sort((a, b) => Math.abs(minutesOfLabel(a) - wantedMin) - Math.abs(minutesOfLabel(b) - wantedMin))
      .slice(0, 4)
      .sort((a, b) => minutesOfLabel(a) - minutesOfLabel(b));
    const prox = await publicPost(DATE_J, '20:00', 2, {}, 'prox');
    check('POST às 20:00 sem mesas → 409', prox.status === 409, `got ${prox.status} ${JSON.stringify(prox.json)}`);
    console.log(
      `    (${availJ.length} slots livres; 4 primeiros do dia = ${JSON.stringify(availJ.slice(0, 4))}; ` +
        `alternatives = ${JSON.stringify(prox.json?.alternatives)})`,
    );
    check(
      'alternatives = 4 mais próximas de 20:00 (e não as 4 primeiras do dia)',
      JSON.stringify(prox.json?.alternatives) === JSON.stringify(expectedAlts),
      `got ${JSON.stringify(prox.json?.alternatives)} esperado ${JSON.stringify(expectedAlts)}`,
    );
    check(
      'alternatives NÃO começam no 1º slot do dia (12:00)',
      !prox.json?.alternatives?.includes('12:00'),
      JSON.stringify(prox.json?.alternatives),
    );

    // ---- Turnstile: no-op com TURNSTILE_SECRET_KEY vazia (dev/e2e) ----
    const health = await req('GET', '/health');
    check('GET /health 200', health.status === 200, `got ${health.status}`);
    check(
      'health diz turnstile.enforced=false (secret vazia — pré-condição do no-op)',
      health.json?.turnstile?.enforced === false,
      JSON.stringify(health.json?.turnstile),
    );
    // Com a secret vazia o verify() sai à primeira linha: o token nem é olhado. Este POST leva
    // um token que a Cloudflare recusaria — se algum dia isto der 403, o no-op deixou de o ser.
    // (E prova também que `turnstileToken` está no DTO: sem isso o forbidNonWhitelisted dá 400.)
    const noop = await publicPost(DATE_J, '12:00', 2, { turnstileToken: 'token-invalido-de-teste' }, 'turnstile');
    check(
      'POST com turnstileToken lixo e secret vazia → 201 (no-op, e DTO aceita o campo)',
      noop.status === 201,
      `got ${noop.status} ${JSON.stringify(noop.json)}`,
    );

    // ---- TTL do token de gestão: startsAt a mais de 24h no passado → 404 ----
    const ttl = await publicPost(DATE_J, '12:30', 2, {}, 'ttl');
    check('reserva p/ teste de TTL criada 201', ttl.status === 201, `got ${ttl.status} ${JSON.stringify(ttl.json)}`);
    const ttlToken = ttl.json.manageUrl.split('#t=')[1];
    const ttlBefore = await req('GET', `/public/reservations/${ttl.json.code}`, {
      headers: { 'x-reservation-token': ttlToken },
    });
    check('GET antes de expirar → 200', ttlBefore.status === 200, `got ${ttlBefore.status}`);
    // Não há endpoint para viajar no tempo — prisma direto (a exceção já documentada no
    // cabeçalho). 30h no passado = fora da janela de 24h a contar de startsAt.
    await prisma.reservation.update({
      where: { code: ttl.json.code },
      data: {
        startsAt: new Date(Date.now() - 30 * 3_600_000),
        endsAt: new Date(Date.now() - 28 * 3_600_000),
      },
    });
    const ttlGet = await req('GET', `/public/reservations/${ttl.json.code}`, {
      headers: { 'x-reservation-token': ttlToken },
    });
    check('GET com startsAt >24h no passado → 404 (token não é credencial eterna)', ttlGet.status === 404, `got ${ttlGet.status} ${JSON.stringify(ttlGet.json)}`);
    const ttlCancel = await req('POST', `/public/reservations/${ttl.json.code}/cancel`, {
      body: { token: ttlToken },
    });
    check('cancel com startsAt >24h no passado → 404', ttlCancel.status === 404, `got ${ttlCancel.status} ${JSON.stringify(ttlCancel.json)}`);

    // ---- Cancelar entre startsAt e endsAt → OK (antes da R3 era 400) ----
    const late = await publicPost(DATE_J, '13:00', 2, {}, 'late');
    check('reserva p/ cancelamento tardio criada 201', late.status === 201, `got ${late.status} ${JSON.stringify(late.json)}`);
    const lateToken = late.json.manageUrl.split('#t=')[1];
    // já começou há 10 min, acaba daqui a 110 (duração 120): o cliente que se atrasa e avisa
    await prisma.reservation.update({
      where: { code: late.json.code },
      data: {
        startsAt: new Date(Date.now() - 10 * 60_000),
        endsAt: new Date(Date.now() + 110 * 60_000),
      },
    });
    const lateCancel = await req('POST', `/public/reservations/${late.json.code}/cancel`, {
      body: { token: lateToken },
    });
    // 201 e não 200 pela mesma razão do ponto 14 (default do Nest para @Post) — o que interessa
    // é já não ser 400: um cancelamento tardio vale sempre mais que um no-show mudo.
    check(
      'cancelar entre startsAt e endsAt → 201 (antes era 400)',
      lateCancel.status === 201,
      `got ${lateCancel.status} ${JSON.stringify(lateCancel.json)}`,
    );

    // =========================================================================
    // 23. reservation-days ≡ reservation-slots em 30 dias
    // =========================================================================
    console.log('— 23. lote (reservation-days) ≡ dia-a-dia (reservation-slots) em 30 dias');
    console.log('    … pacing: sleep 61s (o varrimento gasta 30 GETs e o balde dos slots é 30/min)');
    await sleep(61_000);
    const dFrom = TODAY;
    const dTo = addDaysISO(TODAY, 29);
    const batch = await days(dFrom, dTo, 2);
    check('GET reservation-days 200', batch.status === 200, `got ${batch.status} ${JSON.stringify(batch.json)}`);
    check('devolve os 30 dias do intervalo', batch.json?.days?.length === 30, `got ${batch.json?.days?.length}`);
    // Se o lote e o dia-a-dia divergirem, a grelha de dias mente ao cliente: dias esbatidos que
    // afinal têm vaga (perde reservas) ou dias clicáveis que abrem vazios (parece avariado).
    const mismatches = [];
    for (const d of batch.json?.days ?? []) {
      const one = await slotsSafe(d.date, 2);
      const hasSlots = Array.isArray(one.json?.slots) && one.json.slots.length > 0;
      if (one.status !== 200 || hasSlots !== d.hasSlots) {
        mismatches.push(`${d.date}: lote=${d.hasSlots} dia-a-dia=${hasSlots} (GET ${one.status})`);
      }
    }
    check(
      'hasSlots === (slots.length > 0) nos 30 dias',
      mismatches.length === 0,
      mismatches.join(' | '),
    );

    // =========================================================================
    // 24. Gating: reservationsEnabled:false → slots/POST público 404; GET por
    //     code/token continua 200 (não depende do gating)
    // =========================================================================
    console.log('— 24. gating (reservationsEnabled=false)');
    const disable = await req('PATCH', '/tenants/me', { token: ownerToken, body: { reservationsEnabled: false } });
    check('PATCH reservationsEnabled=false 200', disable.status === 200, `got ${disable.status}`);
    // slotsSafe e não slots: o varrimento do ponto 23 deixa o balde dos slots no limite exato
    // (30/min) e este pedido cai no mesmo minuto — sem o retry saía um 429 e uma falha FALSA.
    const slotsGated = await slotsSafe(DATE_A, 2);
    check('GET slots com gating → 404', slotsGated.status === 404, `got ${slotsGated.status}`);
    const postGated = await publicPost(DATE_A, '12:00', 2, {}, 'gated');
    check('POST público com gating → 404', postGated.status === 404, `got ${postGated.status}`);
    const getByCodeGated = await req('GET', `/public/reservations/${g1.json.code}`, { headers: { 'x-reservation-token': g1Token } });
    check('GET por code/token continua 200 (não depende de gating)', getByCodeGated.status === 200, `got ${getByCodeGated.status}`);

    // =========================================================================
    // 25. TRACKER DO THROTTLE — regressão do commit 2053fc8 (falha VIVA em produção).
    //
    //     O ThrottlerGuard identifica o cliente por `req.ips[0] ?? req.ip`. Com
    //     `trust proxy` ligado sem proxy à frente, o Express preenche `req.ips` a partir do
    //     X-Forwarded-For — um header por pedido = um balde novo por pedido, e TODOS os
    //     limites da API (login incluído) deixam de existir sem ninguém dar por ela.
    //     Este teste manda 6 POSTs do MESMO socket com XFF DIFERENTES: se o balde é do
    //     socket (correto), o 6.º leva 429; se voltou a seguir o header, saem 6× 400.
    // =========================================================================
    console.log('— 25. tracker do throttle: X-Forwarded-For NÃO cria balde novo (regressão de 2053fc8)');
    console.log('    … pacing: sleep 61s (o balde de POSTs públicos é 5/min e tem de estar limpo)');
    await sleep(61_000);
    const xffStatuses = [];
    for (let i = 1; i <= 6; i++) {
      const r = await req('POST', `/public/stores/${SLUG}/reservations`, {
        // Corpo deliberadamente inválido: o ValidationPipe recusa-o com 400 e nada é escrito
        // na BD — mas o guard do throttle corre ANTES dos pipes, logo o balde conta na mesma.
        body: { campoInexistente: true },
        headers: { 'X-Forwarded-For': `203.0.113.${i}` },
      });
      xffStatuses.push(r.status);
    }
    check(
      'os 5 primeiros POSTs (XFF diferentes) passam o guard (400 do DTO, não 429)',
      xffStatuses.slice(0, 5).every((s) => s === 400),
      `got ${JSON.stringify(xffStatuses)}`,
    );
    check(
      '6.º POST do mesmo socket com XFF diferente → 429 (o balde é do SOCKET, não do header)',
      xffStatuses[5] === 429,
      `got ${JSON.stringify(xffStatuses)} — se não há 429, req.ip voltou a seguir o X-Forwarded-For e TODOS os limites caíram`,
    );
  } catch (e) {
    console.error('erro fatal durante os testes:', e);
    failed++;
  } finally {
    await cleanup(prisma, tenantId, ownerToken, originalConfig);
    await prisma.$disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('erro fatal fora do main:', e);
  process.exit(1);
});
