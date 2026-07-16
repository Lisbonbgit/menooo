# Reservas — Fase R2: Painel — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Aba "Reservas" no painel (spec §8): vista do dia em tempo real com ações, reserva manual/walk-in e edição, gestão de mesas, janelas, dias bloqueados e config — mais a projeção do payload de reservas no backend (follow-up da R1).

**Architecture:** Uma rota nova `/reservations` no `apps/dashboard` com 3 separadores (Dia · Mesas · Definições). A T2 cria a página + os **ficheiros-stub** dos componentes pesados; T3 e T4 preenchem esses stubs em paralelo (ficheiros disjuntos, sem tocar na página). Dados via react-query + socket (mesmo padrão da Receção).

**Tech Stack:** Next.js 15/React 18, TanStack Query, socket.io-client, zustand, Tailwind (linguagem "editorial" do repo).

## Global Constraints

- Copy PT-PT; **ZERO emojis**; linguagem editorial: chips = ponto colorido + texto MAIÚSCULO `tracking-wide` (nunca badges pastel), cartões `rounded-xl border-line`, sombras achatadas (`shadow-card`), `tabular-nums` nos números, kicker maiúsculo 11px `tracking-[0.14em]` por cima de títulos.
- Nada de KITCHEN: a rota vive dentro do `AppShell`, cujo guard já redireciona a cozinha para `/orders` — **não acrescentar lógica de papel nova**.
- Node/pnpm: `PATH="$HOME/.local/node/bin:$PATH"`. Working dir: `/Users/matheus.moraes/dev/comanda`. Ramo: `matheus-reservas-fase2`.
- Typecheck do dashboard limpo no fim de cada task (`pnpm --filter @comanda/dashboard typecheck`).

## Contrato do backend (R1 — já no main, não mudar)

Painel (OWNER/STAFF, via `api` do dashboard):
- `GET /tables` · `POST /tables` `{name, seats, area?, joinable?, bookableOnline?, active?, sortOrder?}` · `PATCH /tables/:id` · `DELETE /tables/:id` (409 se tem histórico)
- `GET /reservations?date=YYYY-MM-DD` → `Reservation[]` com `tables: [{ tableId, table: { name } }]`
- `POST /reservations` (manual) `{date, time, partySize, durationMin?, customerName, customerPhone?, customerEmail?, notes?, tableIds?}`
- `PATCH /reservations/:id` (edição, mesmos campos opcionais) · `PATCH /reservations/:id/status` `{status: 'COMPLETED'|'NO_SHOW'|'CANCELLED'}`
- `GET/PUT /reservation-windows` `{windows: [{weekday, openMinute, closeMinute}]}` (máx 2/weekday, `closeMinute ≤ 1380`)
- `GET/POST/DELETE /reservation-blocks` `{date, reason?}`
- Config: `PATCH /tenants/me` aceita `reservationsEnabled, reservationDurationMin (30-480), reservationBufferMin (0-120), reservationMinNoticeMin (0-2880), reservationMaxAdvanceDays (1-90), reservationMaxPartySize (1-50), email`
- Slots (para o modal manual sugerir horas): `GET /public/stores/:slug/reservation-slots?date&party` — público, só funciona com `reservationsEnabled`.

Socket (sala staff): eventos `reservation.created` / `reservation.updated` com a linha da reserva.

---

### Task 1: Backend — projeção do payload + camada de dados do painel

**Files:**
- Modify: `apps/api/src/modules/reservations/reservations.service.ts`
- Create: `apps/dashboard/src/lib/reservation-types.ts`
- Create: `apps/dashboard/src/lib/reservations-hooks.ts`

**Interfaces:**
- Produces (backend): helper privado `publicRow(row)` que remove `cancelTokenHash` de TUDO o que sai para o painel/socket (`listReservations`, `emitReservationCreated/Updated`, retornos de `createManual`/`updateReservation`/`updateStatus`).
- Produces (dashboard):
  - `reservation-types.ts`: `ReservationStatus = 'CONFIRMED'|'CANCELLED'|'COMPLETED'|'NO_SHOW'`; `ReservationTableRef = { tableId: string; table: { name: string } }`; `Reservation = { id, code, status, source: 'ONLINE'|'MANUAL', partySize, startsAt, endsAt, customerName, customerPhone, customerEmail: string|null, notes: string|null, tables: ReservationTableRef[] }`; `Table = { id, name, area: string|null, seats, joinable, bookableOnline, active, sortOrder }`; `ReservationWindow = { weekday: number; openMinute: number; closeMinute: number }`; `ReservationBlock = { id, date, reason: string|null }`; `ReservationConfig = { reservationsEnabled, reservationDurationMin, reservationBufferMin, reservationMinNoticeMin, reservationMaxAdvanceDays, reservationMaxPartySize }`.
  - `reservations-hooks.ts`: `useLiveReservations(dateISO)` → `{ reservations, connected, refetch }` (query + socket, re-sync no connect, alarme em `reservation.created` de HOJE); `useTables()`; `useCreateTable()`, `useUpdateTable()`, `useDeleteTable()`; `useCreateReservation()`, `useUpdateReservation()`, `useUpdateReservationStatus()`; `useWindows()`, `useSetWindows()`; `useBlocks()`, `useCreateBlock()`, `useDeleteBlock()`; `useTenantConfig()` + `useUpdateTenantConfig()`. Chaves de query: `['reservations', date]`, `['tables']`, `['reservation-windows']`, `['reservation-blocks']`, `['tenant-me']`.

- [ ] **Step 1 (backend):** em `reservations.service.ts`, adicionar o helper e aplicá-lo:

```ts
  /** Row de reserva para o painel/socket — sem o hash do token de cancelamento. */
  private publicRow<T extends { cancelTokenHash?: string | null }>(row: T) {
    const { cancelTokenHash: _drop, ...rest } = row;
    return rest;
  }
```

Aplicar em: o `return` de `listReservations` (`rows.filter(...).map((r) => this.publicRow(r))`), e em cada `emitReservationCreated/Updated(...)` e retorno de `createManual`/`updateReservation`/`updateStatus` (envolver o row com `this.publicRow(...)`). NÃO tocar nos caminhos públicos (já não expõem o hash).

- [ ] **Step 2 (types):** criar `reservation-types.ts` com os tipos das Interfaces acima (todos `export interface`/`export type`; datas como `string` ISO).

- [ ] **Step 3 (hooks):** criar `reservations-hooks.ts` seguindo EXATAMENTE o padrão de `apps/dashboard/src/lib/orders-hooks.ts` (lê-o primeiro):

```ts
'use client';

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ensureFreshSession } from './api';
import { useAuthStore } from './auth-store';
import { playAlarm } from './alarm';
import type {
  Reservation, Table, ReservationWindow, ReservationBlock, ReservationConfig,
} from './reservation-types';

const WS_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/** tenantId do access token (o socket junta-se à sala desta unidade). */
function tokenTenantId(token: string | null): string | null {
  if (!token) return null;
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64)).tenantId ?? null;
  } catch {
    return null;
  }
}

/** Reservas de um dia + atualização em tempo real (sala staff). */
export function useLiveReservations(dateISO: string) {
  const activeTenantId = useAuthStore((s) => tokenTenantId(s.token));
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  const dateRef = useRef(dateISO);
  dateRef.current = dateISO;

  const query = useQuery({
    queryKey: ['reservations', dateISO],
    queryFn: async () => (await api.get<Reservation[]>('/reservations', { params: { date: dateISO } })).data,
    enabled: !!activeTenantId,
  });

  useEffect(() => {
    if (!activeTenantId) return;
    const socket = io(WS_URL, {
      auth: (cb) => cb({ token: useAuthStore.getState().token }),
      transports: ['websocket'],
    });

    const resync = () => qc.invalidateQueries({ queryKey: ['reservations', dateRef.current] });

    socket.on('connect', () => {
      setConnected(true);
      resync(); // o socket não repõe eventos perdidos num gap
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => void ensureFreshSession());
    socket.on('reservation.created', (r: Reservation) => {
      if (r.startsAt.slice(0, 10) === dateRef.current) playAlarm();
      resync();
    });
    socket.on('reservation.updated', () => resync());

    const onVisible = () => {
      if (document.visibilityState === 'visible' && !socket.connected) {
        void ensureFreshSession().finally(() => socket.connect());
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      socket.disconnect();
    };
  }, [activeTenantId, qc]);

  return { reservations: query.data ?? [], connected, isLoading: query.isLoading };
}
```

e as mutações no padrão (exemplo a replicar para todas):

```ts
export function useTables() {
  return useQuery({ queryKey: ['tables'], queryFn: async () => (await api.get<Table[]>('/tables')).data });
}

export function useCreateTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: Partial<Table>) => (await api.post<Table>('/tables', body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tables'] }),
  });
}
```

(`useUpdateTable` → `PATCH /tables/:id`; `useDeleteTable` → `DELETE /tables/:id`; `useCreateReservation` → `POST /reservations` e invalida `['reservations']` todas; `useUpdateReservation` → `PATCH /reservations/:id`; `useUpdateReservationStatus` → `PATCH /reservations/:id/status`; `useWindows`/`useSetWindows` → `GET/PUT /reservation-windows` (o PUT manda `{ windows }`); `useBlocks`/`useCreateBlock`/`useDeleteBlock` → `/reservation-blocks`; `useTenantConfig` → `GET /tenants/me` (queryKey `['tenant-me']`), `useUpdateTenantConfig` → `PATCH /tenants/me` + invalida `['tenant-me']`.)

- [ ] **Step 4:** typecheck api + dashboard; `pnpm --filter @comanda/api test` → 20/20. Commit:

```bash
git add apps/api/src/modules/reservations/reservations.service.ts apps/dashboard/src/lib/reservation-types.ts apps/dashboard/src/lib/reservations-hooks.ts
git commit -m "feat(reservas): projeção do payload no painel + camada de dados do dashboard"
```

---

### Task 2: Aba Reservas — página, separadores, vista do dia e NAV

**Files:**
- Modify: `apps/dashboard/src/components/AppShell.tsx` (NAV)
- Create: `apps/dashboard/src/app/reservations/page.tsx`
- Create: `apps/dashboard/src/components/TablesManager.tsx` (**STUB**)
- Create: `apps/dashboard/src/components/ReservationSettings.tsx` (**STUB**)
- Create: `apps/dashboard/src/components/ReservationFormModal.tsx` (**STUB**)

**Interfaces:**
- Consumes: hooks/tipos da Task 1.
- Produces (contratos que a T3/T4 vão preencher — criar os stubs com ESTAS assinaturas exatas):
  - `export function TablesManager(): JSX.Element`
  - `export function ReservationSettings(): JSX.Element`
  - `export function ReservationFormModal({ mode, reservation, onClose }: { mode: 'create' | 'edit'; reservation?: Reservation; onClose: () => void }): JSX.Element`

- [ ] **Step 1: NAV** — em `AppShell.tsx`, juntar `CalendarCheck` ao import do lucide-react e inserir no `NAV`, entre Receção e Menu:

```ts
  { href: '/reservations', label: 'Reservas', icon: CalendarCheck },
```

(O modo cozinha já filtra o NAV para só `/orders` — não mexer nisso.)

- [ ] **Step 2: Stubs** — criar os 3 ficheiros com a assinatura acima e corpo mínimo (`return <p className="text-[13px] text-ink-mute">Em construção.</p>;`), com `'use client';` no topo. **A T3 e a T4 substituem estes corpos; a página não volta a ser tocada.**

- [ ] **Step 3: Página** — criar `app/reservations/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { clsx } from 'clsx';
import { toast } from 'sonner';
import { Wifi, WifiOff, Plus, CalendarOff, Check, X, UserX, Pencil } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { TablesManager } from '@/components/TablesManager';
import { ReservationSettings } from '@/components/ReservationSettings';
import { ReservationFormModal } from '@/components/ReservationFormModal';
import {
  useLiveReservations, useTables, useBlocks, useCreateBlock, useDeleteBlock,
  useUpdateReservationStatus,
} from '@/lib/reservations-hooks';
import type { Reservation, ReservationStatus } from '@/lib/reservation-types';

const TABS = [
  { key: 'day', label: 'Dia' },
  { key: 'tables', label: 'Mesas' },
  { key: 'settings', label: 'Definições' },
] as const;

const STATUS_CHIP: Record<ReservationStatus, { label: string; dot: string; text: string }> = {
  CONFIRMED: { label: 'Confirmada', dot: 'bg-green-500', text: 'text-green-800' },
  COMPLETED: { label: 'Concluída', dot: 'bg-stone-400', text: 'text-ink-soft' },
  NO_SHOW: { label: 'Não apareceu', dot: 'bg-red-500', text: 'text-red-700' },
  CANCELLED: { label: 'Cancelada', dot: 'bg-stone-300', text: 'text-ink-mute' },
};

/** YYYY-MM-DD de hoje na timezone do browser (o servidor filtra pela tz da loja). */
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
}

export default function ReservationsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('day');
  const [date, setDate] = useState(todayISO());
  const [modal, setModal] = useState<{ mode: 'create' | 'edit'; reservation?: Reservation } | null>(null);

  const { reservations, connected } = useLiveReservations(date);
  const tables = useTables();
  const blocks = useBlocks();
  const createBlock = useCreateBlock();
  const deleteBlock = useDeleteBlock();
  const updateStatus = useUpdateReservationStatus();

  const todayBlock = (blocks.data ?? []).find((b) => b.date === date);
  const confirmed = reservations.filter((r) => r.status === 'CONFIRMED');
  const covers = confirmed.reduce((sum, r) => sum + r.partySize, 0);
  const noTables = (tables.data ?? []).length === 0;

  async function setStatus(r: Reservation, status: ReservationStatus) {
    if (status === 'CANCELLED' && !confirm(`Cancelar a reserva de ${r.customerName}?`)) return;
    try {
      await updateStatus.mutateAsync({ id: r.id, status });
      toast.success('Reserva atualizada');
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Não foi possível atualizar');
    }
  }

  async function toggleTodayBlock() {
    try {
      if (todayBlock) {
        await deleteBlock.mutateAsync(todayBlock.id);
        toast.success('Reservas reabertas neste dia');
      } else {
        await createBlock.mutateAsync({ date, reason: 'Pausado no painel' });
        toast.success('Reservas pausadas neste dia');
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Não foi possível mudar o bloqueio');
    }
  }

  return (
    <AppShell
      title="Reservas"
      actions={
        tab === 'day' ? (
          <>
            <span
              className={clsx(
                'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold',
                connected ? 'bg-green-100 text-green-800' : 'bg-stone-200 text-stone-500',
              )}
            >
              {connected ? <Wifi size={13} /> : <WifiOff size={13} />}
              {connected ? 'Ao vivo' : 'A ligar…'}
            </span>
            <button
              onClick={toggleTodayBlock}
              className={clsx(
                'flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-[13px] font-medium shadow-card transition-colors',
                todayBlock
                  ? 'border-red-200 bg-red-50 text-red-800 hover:border-red-300'
                  : 'border-line bg-white hover:border-brand/40',
              )}
            >
              <CalendarOff size={15} /> {todayBlock ? 'Reabrir este dia' : 'Pausar este dia'}
            </button>
            <button
              onClick={() => setModal({ mode: 'create' })}
              className="flex items-center gap-1.5 rounded-xl bg-brand px-3.5 py-2 text-[13px] font-semibold text-white shadow-card transition-colors hover:bg-brand-dark"
            >
              <Plus size={15} /> Reserva
            </button>
          </>
        ) : null
      }
    >
      {/* separadores */}
      <div className="mb-6 flex gap-1.5 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={clsx(
              '-mb-px border-b-2 px-3.5 py-2 text-[13px] font-medium transition-colors',
              tab === t.key
                ? 'border-brand text-brand'
                : 'border-transparent text-ink-soft hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'day' && (
        <>
          {noTables && (
            <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
              <strong>Ainda não tens mesas.</strong> Cria as tuas mesas no separador Mesas para
              começares a aceitar reservas.
            </div>
          )}
          {todayBlock && (
            <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">
              <strong>Reservas pausadas neste dia.</strong> Os clientes não conseguem reservar
              online; as reservas já confirmadas mantêm-se.
            </div>
          )}

          <div className="mb-5 flex flex-wrap items-center gap-3">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value || todayISO())}
              className="rounded-xl border border-line bg-white px-3.5 py-2 text-[13.5px] shadow-card outline-none focus:border-brand"
            />
            <button
              onClick={() => setDate(todayISO())}
              className="text-[12.5px] font-medium text-brand hover:underline"
            >
              Hoje
            </button>
            <span className="ml-auto flex gap-4 text-[12.5px] text-ink-soft">
              <span>
                <strong className="tabular-nums text-ink">{confirmed.length}</strong> reservas
              </span>
              <span>
                <strong className="tabular-nums text-ink">{covers}</strong> pessoas
              </span>
            </span>
          </div>

          {reservations.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line py-12 text-center">
              <p className="text-[13px] text-ink-mute">Sem reservas neste dia.</p>
            </div>
          ) : (
            <ul className="stagger flex flex-col gap-2.5">
              {reservations.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line bg-white px-4 py-3 shadow-card"
                >
                  <span className="font-display text-[17px] font-semibold tabular-nums">
                    {hhmm(r.startsAt)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-[13.5px] font-medium">{r.customerName}</span>
                    <span className="ml-2 text-[12px] text-ink-mute">
                      {r.partySize} {r.partySize === 1 ? 'pessoa' : 'pessoas'}
                      {r.tables.length > 0 && ` · ${r.tables.map((t) => t.table.name).join(' + ')}`}
                      {r.customerPhone && ` · ${r.customerPhone}`}
                      {r.source === 'MANUAL' && ' · manual'}
                    </span>
                    {r.notes && (
                      <span className="mt-0.5 block text-[11.5px] italic text-ink-mute">“{r.notes}”</span>
                    )}
                  </span>
                  <span
                    className={clsx(
                      'flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide',
                      STATUS_CHIP[r.status].text,
                    )}
                  >
                    <span className={clsx('h-1.5 w-1.5 rounded-full', STATUS_CHIP[r.status].dot)} />
                    {STATUS_CHIP[r.status].label}
                  </span>
                  {r.status === 'CONFIRMED' && (
                    <span className="flex gap-1.5">
                      <button
                        onClick={() => setModal({ mode: 'edit', reservation: r })}
                        title="Editar"
                        className="rounded-lg border border-line p-1.5 text-ink-mute transition-colors hover:border-brand/40 hover:text-brand-dark"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => setStatus(r, 'COMPLETED')}
                        title="Concluída"
                        className="rounded-lg border border-line p-1.5 text-ink-mute transition-colors hover:border-green-400 hover:text-green-700"
                      >
                        <Check size={14} />
                      </button>
                      <button
                        onClick={() => setStatus(r, 'NO_SHOW')}
                        title="Não apareceu"
                        className="rounded-lg border border-line p-1.5 text-ink-mute transition-colors hover:border-amber-400 hover:text-amber-700"
                      >
                        <UserX size={14} />
                      </button>
                      <button
                        onClick={() => setStatus(r, 'CANCELLED')}
                        title="Cancelar"
                        className="rounded-lg border border-line p-1.5 text-ink-mute transition-colors hover:border-red-400 hover:text-red-700"
                      >
                        <X size={14} />
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {tab === 'tables' && <TablesManager />}
      {tab === 'settings' && <ReservationSettings />}

      {modal && (
        <ReservationFormModal
          mode={modal.mode}
          reservation={modal.reservation}
          onClose={() => setModal(null)}
        />
      )}
    </AppShell>
  );
}
```

- [ ] **Step 4:** typecheck; verificar no browser que `/reservations` abre com os 3 separadores e o dia vazio (a stack local corre: DB :5433 + API :3001 + dashboard :3002). Commit `feat(dashboard): aba Reservas com vista do dia em tempo real e NAV`.

---

### Task 3: `TablesManager` — CRUD de mesas *(paralela à T4 — só toca neste ficheiro)*

**Files:**
- Modify: `apps/dashboard/src/components/TablesManager.tsx` (substituir o stub)

**Interfaces:**
- Consumes: `useTables`, `useCreateTable`, `useUpdateTable`, `useDeleteTable` (T1); `Table` de `reservation-types`.
- Produces: `export function TablesManager(): JSX.Element` (assinatura do stub — não mudar).

- [ ] **Step 1:** Implementar, respeitando a linguagem editorial e este comportamento:
  - Lista das mesas ordenada por `sortOrder` e depois `name`, agrupada por **área** (mesas sem área ficam em "Sem área"). Cada linha: nome, `seats` lugares, chips discretos para **JUNTÁVEL** e **SÓ BALCÃO** (quando `bookableOnline === false`), e para mesas inativas o chip **INATIVA** com a linha esbatida (`opacity-60`).
  - Ações por mesa: **Editar** (form inline ou modal simples), **Ativar/Desativar** (PATCH `active`), **Apagar** (com `confirm`; se a API devolver **409**, mostrar o toast com a mensagem do servidor — "tem reservas no histórico, desativa-a" — e NÃO tratar como erro genérico).
  - Botão **"+ Mesa"** abre um form com: nome (obrigatório), lugares (número 1–50, obrigatório), área (texto livre opcional, com `datalist` das áreas já existentes), **juntável** (toggle; ajuda: "pode ser juntada a outra mesa juntável da mesma área"), **reservável online** (toggle, default ligado; ajuda: "desliga para guardar a mesa para walk-ins"), ordem (número, default 0).
  - Estado vazio: "Ainda não tens mesas. Cria a primeira para começares a aceitar reservas." com o botão.
  - Toasts de sucesso/erro em todas as mutações (mensagem do servidor quando existir).
- [ ] **Step 2:** typecheck + verificação no browser (criar/editar/desativar/apagar uma mesa na loja demo; incluir o caso 409). Commit `feat(dashboard): gestão de mesas na aba Reservas`.

---

### Task 4: `ReservationFormModal` + `ReservationSettings` *(paralela à T3 — só toca nestes 2 ficheiros)*

**Files:**
- Modify: `apps/dashboard/src/components/ReservationFormModal.tsx` (substituir o stub)
- Modify: `apps/dashboard/src/components/ReservationSettings.tsx` (substituir o stub)

**Interfaces:**
- Consumes: `useCreateReservation`, `useUpdateReservation`, `useTables`, `useWindows`, `useSetWindows`, `useBlocks`, `useCreateBlock`, `useDeleteBlock`, `useTenantConfig`, `useUpdateTenantConfig` (T1).
- Produces: as assinaturas exatas dos stubs (`ReservationFormModal({ mode, reservation, onClose })`, `ReservationSettings()`).

- [ ] **Step 1: `ReservationFormModal`** — modal no padrão do `PrinterSettings.tsx` (overlay `bg-espresso/60`, cartão `rounded-3xl bg-paper p-6 shadow-pop`, fecha no overlay e no X):
  - Campos: **data** (date, default hoje / a da reserva), **hora** (time — texto livre; o backend arredonda a 15 min no manual), **pessoas** (número ≥1), **duração** (opcional, minutos 30–480 — ajuda "vazio = duração padrão da loja"), **nome** (obrigatório), **telefone** (opcional), **email** (opcional), **notas** (opcional), e **mesa** (select múltiplo simples: "Automática" por omissão + lista das mesas ativas, no máx. **2** — ajuda: "forçar mesa ignora lugares e juntabilidade").
  - `mode === 'edit'`: pré-preenche a partir de `reservation` (hora/data derivadas de `startsAt` na tz do browser; mesas atuais pré-selecionadas) e submete `PATCH`; aviso discreto: "se mudares a hora, a mesa mantém-se se continuar livre".
  - `mode === 'create'`: submete `POST` (reserva manual — o servidor ignora antecedências/grelha).
  - Erros: mostrar a **mensagem do servidor** (409 "não há mesas disponíveis", 422 "hora inválida"/grupo, 400 data inválida) via toast; não fechar o modal em erro. Em sucesso: toast + `onClose()`.
- [ ] **Step 2: `ReservationSettings`** — três blocos em cartões (`rounded-xl border-line`), cada um com kicker maiúsculo:
  1. **Reservas online**: toggle `reservationsEnabled` (ajuda: "quando desligado, o separador de reservas desaparece da tua loja"); `reservationDurationMin` (30–480), `reservationBufferMin` (0–120, ajuda "tempo para limpar e voltar a pôr a mesa"), `reservationMinNoticeMin` (0–2880, "antecedência mínima"), `reservationMaxAdvanceDays` (1–90), `reservationMaxPartySize` (1–50, "grupos maiores são encaminhados para o telefone"). Guardar com **um** botão "Guardar" (PATCH `/tenants/me` só com os campos alterados) + toast.
  2. **Janelas de reserva**: por weekday (Segunda→Domingo, convenção 0=domingo do backend), até **2** janelas com `openMinute`/`closeMinute` em inputs `time` (converter HH:MM ↔ minutos; **closeMinute máx. 23:00**); ajuda: "vazio usa o teu horário de abertura (última reserva 1h antes de fechar)"; botão "Guardar janelas" → `PUT` com a lista completa (só as preenchidas); validação no cliente: fim > início.
  3. **Dias bloqueados**: lista das datas (ordenadas) com motivo e botão apagar; input date + motivo opcional + "Bloquear dia" (`POST`; **409** → toast "esse dia já está bloqueado").
- [ ] **Step 3:** typecheck + verificação no browser (criar reserva manual "agora" na demo; editar; ligar reservas + janelas + bloquear/desbloquear um dia). Commit `feat(dashboard): reserva manual/edição e definições de reservas`.

---

### Task 5: Verificação integrada (CONTROLLER — browser, stack local)

> Executada pelo controlador, não por subagente.

- [ ] Stack local (DB :5433 + API :3001 + dashboard :3002); login owner demo.
- [ ] `/reservations` → 3 separadores; estado vazio de mesas com o aviso.
- [ ] Mesas: criar M2/M4 (uma juntável, uma só-balcão) → aparecem agrupadas; desativar/reativar; apagar mesa virgem OK.
- [ ] Definições: ligar reservas, duração 120, janela de hoje; bloquear hoje → banner + "Reabrir" volta atrás.
- [ ] Reserva manual "agora" → aparece na lista ao vivo (chip Confirmada, mesa atribuída) e o alarme não rebenta a consola.
- [ ] Ações: Concluída / Não apareceu / Cancelar mudam o chip; Editar hora mantém a mesa.
- [ ] Reserva ONLINE (POST público via curl com a loja ligada) → **aparece sozinha na lista** (socket, sem refresh).
- [ ] Regressões: Receção (`/orders`) intacta; modo cozinha continua sem ver "Reservas" no NAV.
- [ ] `pnpm --filter @comanda/api test` 20/20 + `node scripts/e2e-reservas.mjs` 96/96 (a projeção do payload não pode partir o e2e).

---

## Notas de execução

- **T3 e T4 correm em PARALELO** (ficheiros disjuntos; a T2 já criou os stubs e a página não é mais tocada).
- Revisores: sonnet (é UI; sem fronteira de auth nem concorrência). A T1 leva revisão um pouco mais atenta (mexe no backend).
- Fim: revisão de ramo (sonnet) → merge ao main + push. Deploy junta-se ao pendente da R1.
