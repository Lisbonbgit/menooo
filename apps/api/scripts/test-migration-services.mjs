/**
 * Prova a promessa da migração `_reservation_services`: os serviços geram os MESMOS slots que as
 * janelas geravam. A disponibilidade de ninguém muda.
 *
 *   node apps/api/scripts/test-migration-services.mjs
 *
 * Requer só a DB :5433 (a API não precisa de estar de pé).
 *
 * NOTAS DE DESENHO:
 * - O SQL testado é EXTRAÍDO do próprio migration.sql (entre `-- >>> BACKFILL` e `-- <<< BACKFILL`).
 *   Uma cópia do SQL aqui dentro provaria a cópia, não o que vai a produção.
 * - O `slotMinutes` é IMPORTADO do dist (o motor a sério), não reimplementado: uma reimplementação
 *   podia divergir e dar um verde falso. Exige `pnpm --filter @comanda/api build` antes.
 * - Dev tem 0 janelas (`reservationsEnabled @default(false)`): um teste sem dados PASSA sem tocar
 *   no problema. Por isso este script CRIA dados a sério e ABORTA se não houver >=1 janela e
 *   >=2 tenants.
 * - O tenant B tem janelas SOBREPOSTAS no mesmo weekday — estado LEGAL hoje (o setWindows só
 *   valida close>open e o teto de 2/dia, NÃO valida sobreposição) e o caso que rebenta o
 *   agrupamento ingénuo por (open, close): daria dois serviços sobrepostos, que a validação nova
 *   da T2 recusa com 400, deixando o dono sem poder gravar nada.
 * - Tudo corre dentro de UMA transação que leva ROLLBACK no fim: o backfill não tem filtro de
 *   tenant (é `FROM "ReservationWindow" w`), logo correria também sobre a demo. Rollback = zero
 *   residuo na BD de dev.
 */
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');

const AQUI = dirname(fileURLToPath(import.meta.url));

// O motor de slots a sério, compilado. Sem build não há prova nenhuma.
let slotMinutes;
try {
  ({ slotMinutes } = require(join(AQUI, '..', 'dist', 'modules', 'reservations', 'slots.util.js')));
} catch {
  console.error('✗ Falta o dist. Corre: pnpm --filter @comanda/api build');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// O SQL do backfill, extraído do migration.sql que vai a produção
// ---------------------------------------------------------------------------
const RAIZ_MIGS = join(AQUI, '..', 'prisma', 'migrations');
const DIR_MIG = readdirSync(RAIZ_MIGS).find((d) => d.endsWith('_reservation_services'));
if (!DIR_MIG) {
  console.error('✗ Migração `_reservation_services` não encontrada em', RAIZ_MIGS);
  process.exit(1);
}
const SQL_MIG = readFileSync(join(RAIZ_MIGS, DIR_MIG, 'migration.sql'), 'utf8');
const MARCADO = SQL_MIG.match(/-- >>> BACKFILL\n([\s\S]*?)\n-- <<< BACKFILL/);
if (!MARCADO) {
  console.error('✗ Marcadores `-- >>> BACKFILL` / `-- <<< BACKFILL` não encontrados em', DIR_MIG);
  process.exit(1);
}
const BACKFILL = MARCADO[1];

// ---------------------------------------------------------------------------
// Dados de propósito: >=2 tenants, >=1 janela, e um par SOBREPOSTO
// ---------------------------------------------------------------------------
const RUN = Date.now();
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const TENANTS = [
  {
    key: 'A',
    nota: 'janelas normais (almoço em 2 dias + jantar)',
    janelas: [
      { weekday: 1, openMinute: 720, closeMinute: 870 }, // seg 12:00-14:30
      { weekday: 2, openMinute: 720, closeMinute: 870 }, // ter 12:00-14:30
      { weekday: 1, openMinute: 1140, closeMinute: 1320 }, // seg 19:00-22:00
    ],
  },
  {
    key: 'B',
    nota: 'janelas SOBREPOSTAS no mesmo weekday (o caso que rebenta o agrupamento ingénuo)',
    janelas: [
      { weekday: 1, openMinute: 720, closeMinute: 900 }, // seg 12:00-15:00
      { weekday: 1, openMinute: 840, closeMinute: 1080 }, // seg 14:00-18:00  -> tem de fundir em 720-1080
    ],
  },
  {
    key: 'C',
    nota: 'sobreposição DESALINHADA do passo 30 + um par com folga (não pode fundir)',
    janelas: [
      { weekday: 3, openMinute: 720, closeMinute: 905 }, // qua 12:00-15:05
      { weekday: 3, openMinute: 845, closeMinute: 1080 }, // qua 14:05-18:00 -> funde em 720-1080
      { weekday: 5, openMinute: 720, closeMinute: 900 }, // sex 12:00-15:00
      { weekday: 5, openMinute: 910, closeMinute: 1080 }, // sex 15:10-18:00 -> NÃO funde (há folga)
    ],
  },
];

let passed = 0;
let failed = 0;
function check(nome, cond, extra = '') {
  if (cond) {
    passed++;
    console.log(`  ✓ ${nome}`);
  } else {
    failed++;
    console.log(`  ✗ ${nome} ${extra}`);
  }
}

const p = new PrismaClient();
const ROLLBACK = Symbol('rollback');
const linhas = [];
const servicosPorTenant = new Map();

try {
  await p
    .$transaction(
      async (tx) => {
        // 1) criar os tenants e as janelas
        for (const t of TENANTS) {
          const acc = await tx.account.create({ data: { name: `mig-test-${t.key}-${RUN}` } });
          const tenant = await tx.tenant.create({
            data: {
              accountId: acc.id,
              slug: `mig-test-${t.key.toLowerCase()}-${RUN}`,
              name: `Migração ${t.key}`,
              reservationsEnabled: true,
            },
          });
          t.id = tenant.id;
          await tx.reservationWindow.createMany({
            data: t.janelas.map((j) => ({ tenantId: tenant.id, ...j })),
          });
        }

        // 2) a guarda contra o teste vazio: sem dados isto passaria sem tocar no problema
        const nJanelas = await tx.reservationWindow.count({
          where: { tenantId: { in: TENANTS.map((t) => t.id) } },
        });
        const nTenants = TENANTS.length;
        console.log(`\nDados: ${nTenants} tenants, ${nJanelas} janelas.`);
        if (nJanelas < 1 || nTenants < 2) {
          throw new Error(`teste vazio: ${nJanelas} janelas, ${nTenants} tenants — não prova nada`);
        }
        const nSobrepostas = TENANTS.filter((t) =>
          t.janelas.some((a) =>
            t.janelas.some(
              (b) => a !== b && a.weekday === b.weekday && a.openMinute < b.closeMinute && b.openMinute < a.closeMinute,
            ),
          ),
        ).length;
        if (nSobrepostas < 1) throw new Error('sem tenants com janelas sobrepostas — falta o caso que interessa');
        console.log(`Tenants com janelas sobrepostas no mesmo weekday: ${nSobrepostas}.\n`);

        // 3) correr o backfill REAL
        const inseridos = await tx.$executeRawUnsafe(BACKFILL);
        console.log(`Backfill: ${inseridos} serviços inseridos.\n`);

        // 4) ler os serviços resultantes
        for (const t of TENANTS) {
          const svcs = await tx.reservationService.findMany({
            where: { tenantId: t.id },
            orderBy: { sortOrder: 'asc' },
          });
          servicosPorTenant.set(t.key, svcs);
        }

        // 5) comparar slots por (tenant, weekday) — o coração da prova
        for (const t of TENANTS) {
          const svcs = servicosPorTenant.get(t.key);
          for (let wd = 0; wd < 7; wd++) {
            const janelas = t.janelas.filter((j) => j.weekday === wd);
            const servicos = svcs.filter((s) => s.weekdays.includes(wd));
            const slotsJanelas = slotMinutes(janelas.map((j) => ({ openMinute: j.openMinute, closeMinute: j.closeMinute })));
            const slotsServicos = slotMinutes(
              servicos.map((s) => ({ openMinute: s.openMinute, closeMinute: s.closeMinute })),
            );
            if (janelas.length === 0 && servicos.length === 0) continue; // dia sem dados dos dois lados
            linhas.push({
              tenant: t.key,
              dia: DIAS[wd],
              janelas: janelas.map((j) => `${hhmm(j.openMinute)}-${hhmm(j.closeMinute)}`).join(' + '),
              servicos: servicos.map((s) => `${s.name} ${hhmm(s.openMinute)}-${hhmm(s.closeMinute)}`).join(' + '),
              nSlots: slotsJanelas.length,
              igual: JSON.stringify(slotsJanelas) === JSON.stringify(slotsServicos),
              slotsJanelas,
              slotsServicos,
            });
          }
        }

        // rollback: o backfill não filtra por tenant, correu sobre a BD toda
        throw ROLLBACK;
      },
      { timeout: 30000 },
    )
    .catch((e) => {
      if (e !== ROLLBACK) throw e;
    });
} catch (e) {
  console.error('\n✗ ERRO:', e.message ?? e);
  await p.$disconnect();
  process.exit(1);
}

// ---------------------------------------------------------------------------
// A tabela
// ---------------------------------------------------------------------------
const w = (s, n) => String(s).padEnd(n);
console.log('slotMinutes(janelas) === slotMinutes(serviços), por (tenant, weekday)');
console.log('─'.repeat(118));
console.log(`${w('Tenant', 7)}${w('Dia', 5)}${w('Janelas (antes)', 28)}${w('Serviços (depois)', 40)}${w('Slots', 7)}Igual`);
console.log('─'.repeat(118));
for (const l of linhas) {
  console.log(`${w(l.tenant, 7)}${w(l.dia, 5)}${w(l.janelas, 28)}${w(l.servicos, 40)}${w(l.nSlots, 7)}${l.igual ? '✓' : '✗'}`);
}
console.log('─'.repeat(118));

console.log('\nChecks:');
for (const l of linhas) {
  check(
    `${l.tenant} ${l.dia}: ${l.nSlots} slots idênticos`,
    l.igual,
    l.igual ? '' : `\n      janelas:  ${l.slotsJanelas.join(',')}\n      serviços: ${l.slotsServicos.join(',')}`,
  );
}

// O tenant B tem de ficar com UM só serviço 12:00-18:00 (a união das sobrepostas)
const b = servicosPorTenant.get('B') ?? [];
check(
  'B: janelas sobrepostas fundem num só serviço 12:00-18:00',
  b.length === 1 && b[0].openMinute === 720 && b[0].closeMinute === 1080,
  `→ ${b.map((s) => `${hhmm(s.openMinute)}-${hhmm(s.closeMinute)}`).join(' + ') || '(nenhum)'}`,
);

// C sex: a folga de 10 min NÃO pode fundir (senão inventava slots que não existiam)
const cSex = (servicosPorTenant.get('C') ?? []).filter((s) => s.weekdays.includes(5));
check('C sex: o par com folga NÃO funde (fica 2 serviços)', cSex.length === 2, `→ ${cSex.length}`);

// (b) do §10 do spec: o resultado passa na validação NOVA (dois serviços que partilhem um
// weekday não podem sobrepor-se) — senão o dono ficava sem poder gravar nada nas Definições.
let sobreposicoes = 0;
for (const [key, svcs] of servicosPorTenant) {
  for (let i = 0; i < svcs.length; i++) {
    for (let j = i + 1; j < svcs.length; j++) {
      const a = svcs[i];
      const c = svcs[j];
      if (!a.weekdays.some((d) => c.weekdays.includes(d))) continue;
      if (a.openMinute < c.closeMinute && c.openMinute < a.closeMinute) {
        sobreposicoes++;
        console.log(`      ${key}: "${a.name}" e "${c.name}" sobrepõem-se`);
      }
    }
  }
}
check('o resultado passa na validação nova (nenhum par sobreposto no mesmo weekday)', sobreposicoes === 0);

// sortOrder preenchido (§4.2 detalhe 3): @default(0) em todos deixaria a ordem dos chips ao Postgres
for (const [key, svcs] of servicosPorTenant) {
  const ordens = svcs.map((s) => s.sortOrder);
  check(
    `${key}: sortOrder preenchido e sem empates (${ordens.join(',')})`,
    svcs.length > 0 && new Set(ordens).size === ordens.length && !ordens.includes(0),
  );
}

// ids sintetizados (§4.2 detalhe 1): o @default(cuid()) não cria default na BD
const todos = [...servicosPorTenant.values()].flat();
check(
  'ids sintetizados pelo SQL (prefixo rs_)',
  todos.length > 0 && todos.every((s) => /^rs_[0-9a-f]{32}$/.test(s.id)),
);

await p.$disconnect();
console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passaram, ${failed} falharam.`);
process.exit(failed === 0 ? 0 : 1);
