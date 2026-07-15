# App de Cozinha — Fase 2: Painel (modo cozinha + fiabilidade) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O painel (`apps/dashboard`) ganha o modo cozinha por papel (`KITCHEN`), o ecrã de emparelhamento `/pair`, o encaminhamento da impressão para o plugin nativo (com feature-detect), e as correções de fiabilidade ao código partilhado (re-sync do socket, token fresco, alarme, agendadas, fila "por imprimir") — spec §5.3–§8 de `docs/superpowers/specs/2026-07-15-app-cozinha-impressao-tcp-design.md`.

**Architecture:** Tudo no `apps/dashboard` exceto a Task 1 (payload mínimo de `/tenants/me` para KITCHEN, backend). O modo cozinha é decidido pelo PAPEL (não pela plataforma); `isNativeApp()` só encaminha a impressão. O plugin nativo não existe ainda (Fase 3) — o wrapper `kitchen-printer.ts` faz feature-detect via `window.Capacitor` (zero dependências novas no bundle web) e no browser é inerte.

**Tech Stack:** Next.js 15 + React 18, zustand (persist), socket.io-client v4, axios, NestJS (Task 1).

## Global Constraints

- Copy em PT-PT; linguagem visual "editorial" (ZERO emojis na UI; chips com ponto colorido + texto maiúsculo tracking-wide; cartões `rounded-xl border-line`; sombras achatadas).
- Node/pnpm: `PATH="$HOME/.local/node/bin:$PATH"` em todos os comandos. Working dir: `/Users/matheus.moraes/dev/comanda`. Ramo: `matheus-app-cozinha-fase2`.
- Typecheck do dashboard (`pnpm --filter @comanda/dashboard typecheck`) limpo no fim de cada task (Task 1: também `@comanda/api`).
- NUNCA adicionar `@capacitor/core` (ou outra dep) ao dashboard — o acesso ao bridge nativo é via `window.Capacitor` (spec §12).
- A fronteira de segurança é o servidor (Fase 1); o modo cozinha na UI é usabilidade, não segurança.

## Pré-requisito: stack local

```bash
# terminal 1 — Postgres embebido
cd /Users/matheus.moraes/dev/comanda/apps/api && PATH="$HOME/.local/node/bin:$PATH" node scripts/embedded-db.mjs serve
# terminal 2 — API
cd /Users/matheus.moraes/dev/comanda/apps/api && PATH="$HOME/.local/node/bin:$PATH" pnpm dev
# terminal 3 (tasks 2+) — painel
cd /Users/matheus.moraes/dev/comanda && PATH="$HOME/.local/node/bin:$PATH" pnpm --filter @comanda/dashboard dev
```

Seed: owner `dono@pizzaria-demo.pt` / `demo1234` (loja `pizzaria-demo`).

---

### Task 1: Backend — `/tenants/me` mínimo para KITCHEN

**Files:**
- Modify: `apps/api/src/modules/tenants/tenants.service.ts` (método `getMine`)
- Modify: `apps/api/src/modules/tenants/tenants.controller.ts` (método `getMine`)
- Modify: `apps/api/scripts/e2e-kitchen.mjs` (asserções novas)

**Interfaces:**
- Produces: `getMine(tenantId, minimal?: boolean)`; para KITCHEN a resposta é `{ id, name, slug, isOpen }` — SEM `subscription`, `stripeSubscriptionId`, `status`, contactos ou horários (spec §5.5: "se não vierem, nem é preciso escondê-los" nos banners).

- [ ] **Step 1: Service** — alterar `getMine` em `tenants.service.ts`:

```ts
  async getMine(tenantId: string, minimal = false) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { openingHours: { orderBy: { weekday: 'asc' } }, account: true },
    });
    if (!tenant) throw new NotFoundException('Restaurante não encontrado.');
    // payload mínimo para a cozinha: nome para o talão e pouco mais —
    // sem subscrição/estado, os banners de dono nem sequer têm dados para disparar
    if (minimal) {
      return { id: tenant.id, name: tenant.name, slug: tenant.slug, isOpen: tenant.isOpen };
    }
    const { account, ...rest } = tenant;
    return {
      ...rest,
      // subscrição é da CONTA (partilhada por todas as unidades)
      subscription: computeSubscription(account),
      stripeSubscriptionId: account.stripeSubscriptionId,
    };
  }
```

- [ ] **Step 2: Controller** — em `tenants.controller.ts`, o `getMine` passa a receber o utilizador (juntar `CurrentUser`/`AuthenticatedUser` aos imports existentes):

```ts
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
```

```ts
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF, UserRole.KITCHEN)
  @Get('tenants/me')
  getMine(@TenantId() tenantId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tenants.getMine(tenantId, user.role === UserRole.KITCHEN);
  }
```

- [ ] **Step 3: E2e** — em `apps/api/scripts/e2e-kitchen.mjs`, logo a seguir ao bloco da matriz de permissões, acrescentar:

```js
  console.log('— payload mínimo de /tenants/me para KITCHEN');
  const kMe = await req('GET', '/tenants/me', { token: kToken });
  check('KITCHEN /tenants/me tem name', typeof kMe.json?.name === 'string');
  check('KITCHEN /tenants/me SEM subscription', !('subscription' in (kMe.json ?? {})));
  check('KITCHEN /tenants/me SEM stripeSubscriptionId', !('stripeSubscriptionId' in (kMe.json ?? {})));
  const oMe = await req('GET', '/tenants/me', { token: ownerToken });
  check('OWNER /tenants/me mantém subscription', 'subscription' in (oMe.json ?? {}));
```

- [ ] **Step 4: Correr o e2e completo** (stack local viva):

```bash
cd /Users/matheus.moraes/dev/comanda/apps/api && PATH="$HOME/.local/node/bin:$PATH" node scripts/e2e-kitchen.mjs
```

Expected: `42 passed, 0 failed` (38 + 4 novos), exit 0.

- [ ] **Step 5: Typecheck e commit**

```bash
cd /Users/matheus.moraes/dev/comanda && PATH="$HOME/.local/node/bin:$PATH" pnpm --filter @comanda/api typecheck
git add apps/api && git commit -m "feat(api): /tenants/me mínimo para KITCHEN (sem subscrição/estado)"
```

---

### Task 2: Alarme — AudioContext partilhado + desbloqueio por gesto

**Files:**
- Modify: `apps/dashboard/src/lib/alarm.ts` (reescrita completa)

**Interfaces:**
- Produces: `unlockAudio(): void` (chamar num gesto do utilizador) e `playAlarm(): void` (mesma assinatura de hoje; os beeps mantêm 880/1175 Hz).

- [ ] **Step 1: Reescrever `alarm.ts`** na íntegra:

```ts
'use client';

// Beep via Web Audio, sem ficheiros de áudio. O Android suspende AudioContexts
// criados sem gesto do utilizador (política de autoplay) — por isso mantemos UM
// contexto partilhado, desbloqueado no primeiro toque (unlockAudio) e
// reutilizado por todos os beeps (nunca fechado).
let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctx) return null;
    ctx = new Ctx();
  }
  return ctx;
}

/** Chamar num gesto do utilizador (toque/clique) para desbloquear o áudio. */
export function unlockAudio() {
  const c = getCtx();
  if (c && c.state === 'suspended') void c.resume().catch(() => {});
}

export function playAlarm() {
  const c = getCtx();
  if (!c) return;
  try {
    if (c.state === 'suspended') void c.resume().catch(() => {});
    const beep = (start: number, freq: number) => {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(c.destination);
      gain.gain.setValueAtTime(0.001, c.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.3, c.currentTime + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + start + 0.25);
      osc.start(c.currentTime + start);
      osc.stop(c.currentTime + start + 0.26);
    };
    // dois bips ascendentes
    beep(0, 880);
    beep(0.3, 1175);
  } catch {
    /* áudio indisponível */
  }
}
```

- [ ] **Step 2: Typecheck e commit**

```bash
cd /Users/matheus.moraes/dev/comanda && PATH="$HOME/.local/node/bin:$PATH" pnpm --filter @comanda/dashboard typecheck
git add apps/dashboard/src/lib/alarm.ts && git commit -m "fix(dashboard): AudioContext partilhado com desbloqueio por gesto (autoplay Android)"
```

---

### Task 3: Fiabilidade do socket — re-sync, token fresco, reconexão em foreground

**Files:**
- Modify: `apps/dashboard/src/lib/api.ts` (exportar `ensureFreshSession`)
- Modify: `apps/dashboard/src/lib/orders-hooks.ts` (reescrever `useLiveOrders`)

**Interfaces:**
- Produces: `ensureFreshSession(): Promise<string | null>` exportado de `api.ts` (single-flight; devolve o access token novo ou null). `useLiveOrders` mantém a assinatura `(onNewOrder?) => { orders, setOrders, connected }`.

- [ ] **Step 1: `api.ts`** — substituir o bloco do single-flight (a declaração `let refreshPromise`, a função `refreshSession` e a linha do interceptor que as usa) por:

```ts
let refreshPromise: Promise<string | null> | null = null;

/**
 * Renova a sessão (single-flight): usável pelo interceptor HTTP e pelo socket.
 * Devolve o access token novo, ou null se a renovação falhar.
 */
export function ensureFreshSession(): Promise<string | null> {
  refreshPromise =
    refreshPromise ??
    refreshSession().finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}
```

e no interceptor de resposta, o troço do retry passa a:

```ts
    if (status === 401 && original && !original._retry && !isAuthCall) {
      original._retry = true;
      const newToken = await ensureFreshSession();
      if (newToken) {
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      }
    }
```

(a função privada `refreshSession` mantém-se tal e qual; só deixa de ser chamada diretamente pelo interceptor.)

- [ ] **Step 2: `orders-hooks.ts`** — substituir o `useLiveOrders` completo por (nota: o efeito depende de `activeTenantId`, não do token — a ROTAÇÃO do token não deve reabrir o socket, mas a TROCA DE UNIDADE no TenantSwitcher tem de reabrir para entrar na sala nova):

```ts
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

/** Carrega encomendas e mantém-nas atualizadas em tempo real via WebSocket. */
export function useLiveOrders(onNewOrder?: (order: Order) => void) {
  const activeTenantId = useAuthStore((s) => tokenTenantId(s.token));
  const [orders, setOrders] = useState<Order[]>([]);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  // manter o callback fresco sem reabrir o socket
  const onNewOrderRef = useRef(onNewOrder);
  onNewOrderRef.current = onNewOrder;

  useEffect(() => {
    if (!activeTenantId) return;
    let alive = true;

    // o socket NÃO repõe eventos perdidos num gap de ligação — cada connect
    // (inclui reconexões) re-sincroniza a lista completa
    const sync = () => {
      api
        .get<Order[]>('/orders')
        .then((res) => {
          if (alive) setOrders(res.data);
        })
        .catch(() => {
          /* sem rede: o próximo connect volta a tentar */
        });
    };
    sync();

    const socket = io(WS_URL, {
      // token FRESCO em cada (re)tentativa — um quadro parado para lá do TTL
      // religa com o token renovado em vez de cair num loop de disconnect
      auth: (cb) => cb({ token: useAuthStore.getState().token }),
      transports: ['websocket'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      sync();
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => {
      // handshake recusado (token expirado): renova; o retry automático do
      // socket.io volta a chamar o auth-callback já com o token novo
      void ensureFreshSession();
    });

    socket.on('order.created', (order: Order) => {
      setOrders((prev) => [order, ...prev.filter((o) => o.id !== order.id)]);
      playAlarm();
      onNewOrderRef.current?.(order);
    });

    socket.on('order.updated', (order: Order) => {
      setOrders((prev) => prev.map((o) => (o.id === order.id ? order : o)));
    });

    // tablet volta a foreground: reconexão agressiva com token fresco
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !socket.connected) {
        void ensureFreshSession().finally(() => socket.connect());
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
      socket.disconnect();
      socketRef.current = null;
    };
    // rotação do token NÃO reabre o socket (auth é callback); trocar de unidade SIM
  }, [activeTenantId]);

  return { orders, setOrders, connected };
}
```

e juntar o import: `import { api, ensureFreshSession } from './api';` (substitui o import atual de `api`).

- [ ] **Step 3: Verificação de comportamento** (painel local aberto em /orders com sessão):
  - Parar a API (`Ctrl+C` no terminal 2) → chip "A ligar…"; criar nada; rearrancar a API → chip "Ao vivo" e a lista recarrega (ver pedido `GET /orders` na aba Network após o reconnect).

- [ ] **Step 4: Typecheck e commit**

```bash
cd /Users/matheus.moraes/dev/comanda && PATH="$HOME/.local/node/bin:$PATH" pnpm --filter @comanda/dashboard typecheck
git add apps/dashboard/src/lib/api.ts apps/dashboard/src/lib/orders-hooks.ts
git commit -m "fix(dashboard): socket re-sincroniza no connect, token fresco no handshake e reconexão em foreground"
```

---

### Task 4: Caminho de impressão nativo — wrapper, campos novos, 3.º ramo

**Files:**
- Create: `apps/dashboard/src/lib/kitchen-printer.ts`
- Modify: `apps/dashboard/src/lib/print-store.ts` (reescrita completa)
- Modify: `apps/dashboard/src/lib/print.ts` (função `printOrder` + tipo de retorno)

**Interfaces:**
- Produces: `isNativeApp(): boolean`, `getKitchenPrinter(): KitchenPrinterPlugin | null`; `usePrintStore` ganha `printerIp: string | null`, `printerPort: number` (default 9100), `pendingPrints: string[]`, `setPrinterIp`, `setPrinterPort`, `addPendingPrint(id)`, `removePendingPrint(id)`; `printOrder` devolve `PrintVia = 'qz' | 'browser' | 'native' | 'unconfigured'`.
- Consumes: `buildReceiptBytes`/`toBase64` de `escpos.ts` (existentes).

- [ ] **Step 1: Criar `kitchen-printer.ts`**

```ts
'use client';

// Ponte para o plugin nativo KitchenPrinter (app Capacitor da cozinha, Fase 3).
// Acede via window.Capacitor de propósito — NÃO adicionar @capacitor/core ao
// bundle web (spec §12). No browser normal nada disto existe: isNativeApp()
// devolve false e o resto do painel nem nota.
export interface KitchenPrinterPlugin {
  print(opts: { ip: string; port: number; dataBase64: string }): Promise<void>;
}

export function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as unknown as { Capacitor?: any }).Capacitor;
  return !!cap?.isNativePlatform?.();
}

/** Plugin nativo, ou null se este APK ainda não o tiver (skew web↔APK). */
export function getKitchenPrinter(): KitchenPrinterPlugin | null {
  if (!isNativeApp()) return null;
  const cap = (window as unknown as { Capacitor?: any }).Capacitor;
  const available = cap?.isPluginAvailable?.('KitchenPrinter');
  const plugin = cap?.Plugins?.KitchenPrinter;
  return available && plugin ? (plugin as KitchenPrinterPlugin) : null;
}
```

- [ ] **Step 2: Reescrever `print-store.ts`**

```ts
'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface PrintState {
  printerName: string | null; // impressora QZ selecionada (desktop)
  printerIp: string | null; // impressora de rede (app de cozinha, TCP 9100)
  printerPort: number; // porta TCP da impressora de rede
  autoPrint: boolean; // imprimir automaticamente cada nova encomenda
  width: number; // largura do talão: 42 (80mm) ou 32 (58mm)
  pendingPrints: string[]; // ids de encomendas cuja (auto)impressão falhou
  setPrinter: (name: string | null) => void;
  setPrinterIp: (ip: string | null) => void;
  setPrinterPort: (port: number) => void;
  setAutoPrint: (v: boolean) => void;
  setWidth: (w: number) => void;
  addPendingPrint: (id: string) => void;
  removePendingPrint: (id: string) => void;
}

export const usePrintStore = create<PrintState>()(
  persist(
    (set) => ({
      printerName: null,
      printerIp: null,
      printerPort: 9100,
      autoPrint: false,
      width: 42,
      pendingPrints: [],
      setPrinter: (printerName) => set({ printerName }),
      setPrinterIp: (printerIp) => set({ printerIp }),
      setPrinterPort: (printerPort) => set({ printerPort }),
      setAutoPrint: (autoPrint) => set({ autoPrint }),
      setWidth: (width) => set({ width }),
      addPendingPrint: (id) =>
        set((s) => (s.pendingPrints.includes(id) ? s : { pendingPrints: [...s.pendingPrints, id] })),
      removePendingPrint: (id) =>
        set((s) => ({ pendingPrints: s.pendingPrints.filter((x) => x !== id) })),
    }),
    { name: 'menoo-print' },
  ),
);
```

- [ ] **Step 3: `print.ts`** — juntar imports e substituir `printOrder`:

```ts
import { toBase64 } from './escpos';
import { isNativeApp, getKitchenPrinter } from './kitchen-printer';
```

```ts
export type PrintVia = 'qz' | 'browser' | 'native' | 'unconfigured';

/**
 * Imprime a encomenda pelo melhor caminho disponível:
 * app de cozinha → TCP nativo; desktop com QZ → térmica; senão → browser.
 * 'unconfigured' = app nativa sem IP configurado (estado explícito, não erro).
 */
export async function printOrder(order: Order, storeName: string): Promise<PrintVia> {
  const { printerName, printerIp, printerPort, width } = usePrintStore.getState();
  if (isNativeApp()) {
    if (!printerIp) return 'unconfigured';
    const plugin = getKitchenPrinter();
    if (!plugin) {
      // APK antigo sem o plugin (skew web↔APK) — mensagem acionável, não crash
      throw new Error('Atualiza a app de cozinha para imprimir por rede.');
    }
    const bytes = buildReceiptBytes(order, { storeName, width });
    await plugin.print({ ip: printerIp, port: printerPort, dataBase64: toBase64(bytes) });
    return 'native';
  }
  if (printerName) {
    const bytes = buildReceiptBytes(order, { storeName, width });
    await printRawBytes(printerName, bytes);
    return 'qz';
  }
  browserPrint(order, storeName);
  return 'browser';
}
```

- [ ] **Step 4: Typecheck** (o consumidor em `PrinterConfig.tsx` compara `via === 'qz'` — continua válido com a união alargada; a atualização das mensagens é a Task 7):

```bash
cd /Users/matheus.moraes/dev/comanda && PATH="$HOME/.local/node/bin:$PATH" pnpm --filter @comanda/dashboard typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/lib/kitchen-printer.ts apps/dashboard/src/lib/print-store.ts apps/dashboard/src/lib/print.ts
git commit -m "feat(dashboard): caminho de impressão nativo (feature-detect) + campos IP/porta e fila por-imprimir"
```

---

### Task 5: Ecrã `/pair` + marca de dispositivo de cozinha

**Files:**
- Modify: `apps/dashboard/src/lib/auth-store.ts` (campo `kitchenDevice`)
- Create: `apps/dashboard/src/app/pair/page.tsx`

**Interfaces:**
- Produces: `useAuthStore` ganha `kitchenDevice: boolean` + `setKitchenDevice(v)` — persistido e **preservado pelo `logout()`** (permite ao guard mandar um tablet desemparelhado para `/pair` e não `/login`). Página `/pair` que chama `POST /auth/kitchen/pair { code }`, guarda a sessão, marca o dispositivo, liga o auto-imprimir e navega para `/orders`.
- Consumes: `POST /auth/kitchen/pair` (Fase 1); `setAuth(token, refreshToken, user)` (existente); `usePrintStore.setAutoPrint` (Task 4).

- [ ] **Step 1: `auth-store.ts`** — acrescentar ao interface e ao store (o resto mantém-se):

```ts
  kitchenDevice: boolean;
  setKitchenDevice: (v: boolean) => void;
```

```ts
      kitchenDevice: false,
      setKitchenDevice: (kitchenDevice) => set({ kitchenDevice }),
      // logout NÃO limpa kitchenDevice: um tablet de cozinha desemparelhado
      // volta ao ecrã /pair, não ao /login de email+password
      logout: () => set({ token: null, refreshToken: null, user: null }),
```

- [ ] **Step 2: Criar `app/pair/page.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Flame, KeyRound } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { usePrintStore } from '@/lib/print-store';

/** Emparelhamento do tablet de cozinha por código (gerado pelo dono no painel). */
export default function PairPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const setKitchenDevice = useAuthStore((s) => s.setKitchenDevice);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post('/auth/kitchen/pair', { code });
      setAuth(data.accessToken, data.refreshToken, data.user);
      setKitchenDevice(true);
      // tablet de cozinha acabado de emparelhar: auto-imprimir ligado por omissão
      usePrintStore.getState().setAutoPrint(true);
      toast.success(`Tablet emparelhado com ${data.tenant.name}`);
      router.replace('/orders');
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Código inválido ou expirado.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-espresso px-4">
      <form
        onSubmit={onSubmit}
        className="animate-fade-up w-full max-w-sm rounded-3xl border border-line bg-paper p-8 shadow-lift"
      >
        <div className="mb-7 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-espresso text-cream">
            <Flame size={20} className="text-brand" />
          </span>
          <div>
            <p className="font-display text-xl font-semibold leading-none">Menooo</p>
            <p className="mt-1 flex items-center gap-1 text-[11px] uppercase tracking-[0.16em] text-ink-mute">
              <KeyRound size={12} /> tablet de cozinha
            </p>
          </div>
        </div>

        <h1 className="font-display text-[22px] font-semibold tracking-tight">
          Emparelhar este tablet
        </h1>
        <p className="mb-6 mt-1 text-[13px] leading-relaxed text-ink-soft">
          No painel do dono, abre as definições de impressão e gera um código de
          emparelhamento. Escreve-o aqui.
        </p>

        <label className="mb-1.5 block text-[13px] font-medium">Código</label>
        <input
          autoFocus
          required
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="XXXX-XXXX-XXXX"
          autoComplete="off"
          className="mb-6 w-full rounded-xl border border-line bg-white px-3.5 py-3 text-center font-mono text-[17px] tracking-[0.2em] outline-none transition-colors focus:border-brand"
        />

        <button
          type="submit"
          disabled={loading || code.length < 12}
          className="w-full rounded-xl bg-brand py-3 text-[14.5px] font-semibold text-white shadow-card transition-colors hover:bg-brand-dark disabled:opacity-60"
        >
          {loading ? 'A emparelhar…' : 'Emparelhar'}
        </button>

        <p className="mt-5 text-center text-[12px] text-ink-mute">
          O código é de uso único e expira em 10 minutos.
        </p>
      </form>
    </main>
  );
}
```

- [ ] **Step 3: Typecheck e commit**

```bash
cd /Users/matheus.moraes/dev/comanda && PATH="$HOME/.local/node/bin:$PATH" pnpm --filter @comanda/dashboard typecheck
git add apps/dashboard/src/lib/auth-store.ts apps/dashboard/src/app/pair
git commit -m "feat(dashboard): ecrã /pair de emparelhamento + marca de dispositivo de cozinha"
```

---

### Task 6: AppShell — modo cozinha

**Files:**
- Modify: `apps/dashboard/src/components/AppShell.tsx`

**Interfaces:**
- Consumes: `useAuthStore` (`user.role`, `kitchenDevice` da Task 5), `unlockAudio` (Task 2).
- Produces: com `role==='KITCHEN'`: nav só "Receção", sem `TenantSwitcher` (nome da loja estático no lugar), sem banners de estado/subscrição, "Sair" vira "Desemparelhar" (revoga no servidor + `/pair`), qualquer rota ≠ `/orders` redireciona para `/orders`. Guard não-autenticado: `kitchenDevice ? '/pair' : '/login'`. Logout (todos os papéis) passa a revogar o refresh token no servidor.

- [ ] **Step 1: Imports e estado** — juntar aos imports: `import { unlockAudio } from '@/lib/alarm';` e `import { api } from '@/lib/api';` (o `api` já está importado — confirmar). Dentro do componente, substituir a linha `const { token, logout } = useAuthStore();` por:

```ts
  const { token, logout, user, kitchenDevice } = useAuthStore();
  const kitchen = user?.role === 'KITCHEN';
```

- [ ] **Step 2: Guard** — substituir o `useEffect` do guard por:

```ts
  useEffect(() => {
    if (!hydrated) return; // espera o persist restaurar o token antes de decidir
    if (!token) {
      // tablet de cozinha desemparelhado volta ao /pair, não ao login de email
      router.replace(kitchenDevice ? '/pair' : '/login');
      return;
    }
    // cozinha só tem a Receção — qualquer outra rota volta para lá
    if (kitchen && pathname !== '/orders') {
      router.replace('/orders');
      return;
    }
    setReady(true);
  }, [hydrated, token, kitchen, kitchenDevice, pathname, router]);
```

- [ ] **Step 3: Desbloqueio de áudio no 1.º gesto** — novo efeito no componente:

```ts
  // 1.º toque desbloqueia o AudioContext (senão o beep de nova encomenda não toca)
  useEffect(() => {
    const h = () => unlockAudio();
    window.addEventListener('pointerdown', h, { once: true });
    return () => window.removeEventListener('pointerdown', h);
  }, []);
```

- [ ] **Step 4: Sair/Desemparelhar (função partilhada)** — antes do `return`, adicionar:

```ts
  function signOut() {
    // revoga o refresh token no servidor (best-effort) antes de limpar localmente
    const rt = useAuthStore.getState().refreshToken;
    if (rt) void api.post('/auth/logout', { refreshToken: rt }).catch(() => {});
    logout();
    router.replace(kitchen || kitchenDevice ? '/pair' : '/login');
  }
```

e nos DOIS botões "Sair" (desktop e mobile), substituir o `onClick={() => { logout(); router.replace('/login'); }}` por `onClick={signOut}` e o `title="Sair"` por `title={kitchen ? 'Desemparelhar' : 'Sair'}`.

- [ ] **Step 5: Nav reduzida** — substituir a linha `const navLinks = NAV.map(...)` por:

```ts
  // cozinha: só a Receção (o resto é do dono e daria 403)
  const navItems = kitchen ? NAV.filter((i) => i.href === '/orders') : NAV;
  const navLinks = navItems.map(({ href, label, icon: Icon }) => {
```

(o corpo do map mantém-se.)

- [ ] **Step 6: TenantSwitcher e banners** — nos dois sítios onde `<TenantSwitcher ... />` é renderizado (desktop e mobile), envolver:

```tsx
            {kitchen ? (
              <span className="min-w-0 flex-1 truncate text-[13px] text-cream/70">
                {tenant.data?.name ?? '—'}
              </span>
            ) : (
              <TenantSwitcher activeId={tenant.data?.id} />
            )}
```

(na versão mobile, manter o prop `dropUp={false}` no ramo não-cozinha.) E envolver os QUATRO banners de estado (PENDING / SUSPENDED / TRIAL / EXPIRED) num único bloco `{!kitchen && (<> ...os quatro blocos atuais... </>)}` — com o payload mínimo da Task 1 eles já não disparam, isto é cinto-e-suspensórios.

- [ ] **Step 7: Verificação manual rápida** — com o painel local: login normal (owner) continua igual (nav completa, switcher, sair → /login). Verificação do modo cozinha completo fica para a Task 8.

- [ ] **Step 8: Typecheck e commit**

```bash
cd /Users/matheus.moraes/dev/comanda && PATH="$HOME/.local/node/bin:$PATH" pnpm --filter @comanda/dashboard typecheck
git add apps/dashboard/src/components/AppShell.tsx
git commit -m "feat(dashboard): modo cozinha no AppShell (nav, switcher, banners, desemparelhar, guard /pair)"
```

---

### Task 7: Receção e PrinterConfig — agendadas, fila "por imprimir", campos de rede

**Files:**
- Modify: `apps/dashboard/src/app/orders/page.tsx`
- Modify: `apps/dashboard/src/components/PrinterConfig.tsx`

**Interfaces:**
- Consumes: `PrintVia`/`printOrder` (Task 4), `usePrintStore` campos novos (Task 4), `isNativeApp` (Task 4).
- Produces: auto-print suprimido para agendadas futuras (>15 min); falha de (auto)impressão → `pendingPrints` + banner persistente com "Tentar de novo"; badge "POR IMPRIMIR" no card; reimpressão no histórico; toasts corretos por via; PrinterConfig com secção de rede (IP/porta) quando nativo e aviso "um só dispositivo com auto-impressão".

- [ ] **Step 1: `orders/page.tsx` — imports e helpers.** Juntar `AlertTriangle` e `RotateCw` ao import do `lucide-react`. Adicionar helper ao nível do módulo:

```ts
// agendada para daqui a mais de 15 min: não auto-imprimir já (imprimia-se um
// talão que se perdia no balcão horas antes da hora)
function isFutureScheduled(order: Order): boolean {
  return !!order.scheduledFor && new Date(order.scheduledFor).getTime() > Date.now() + 15 * 60_000;
}
```

- [ ] **Step 2: `print` e `onNewOrder`** — substituir os dois callbacks por:

```ts
  const print = useCallback(
    async (order: Order) => {
      try {
        const via = await printOrder(order, storeName);
        if (via === 'unconfigured') {
          toast.error('Configura o IP da impressora nas definições de impressão.');
          return;
        }
        usePrintStore.getState().removePendingPrint(order.id);
      } catch (e: any) {
        usePrintStore.getState().addPendingPrint(order.id);
        toast.error(e?.message ?? 'Erro ao imprimir');
      }
    },
    [storeName],
  );

  const onNewOrder = useCallback(
    (order: Order) => {
      if (!usePrintStore.getState().autoPrint) return;
      if (isFutureScheduled(order)) return; // agendada: imprime-se perto da hora, à mão
      printOrder(order, storeName)
        .then((via) => {
          if (via === 'unconfigured') usePrintStore.getState().addPendingPrint(order.id);
        })
        .catch(() => {
          usePrintStore.getState().addPendingPrint(order.id);
          toast.error(`Falha a imprimir #${order.number}`);
        });
    },
    [storeName],
  );
```

- [ ] **Step 3: Banner persistente + retry.** Dentro do componente, depois de `const finished = ...`:

```ts
  const pendingPrints = usePrintStore((s) => s.pendingPrints);
  const pendingOrders = orders.filter((o) => pendingPrints.includes(o.id));
  const [retrying, setRetrying] = useState(false);

  async function retryPending() {
    setRetrying(true);
    for (const o of pendingOrders) {
      // sequencial de propósito: a térmica só aceita uma ligação de cada vez
      // eslint-disable-next-line no-await-in-loop
      await print(o);
    }
    setRetrying(false);
  }
```

e como PRIMEIRO elemento dentro do `<AppShell ...>` (antes do grid de colunas):

```tsx
      {pendingOrders.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="flex items-center gap-2 text-[13px] text-red-800">
            <AlertTriangle size={15} />
            <strong>
              {pendingOrders.length}{' '}
              {pendingOrders.length === 1 ? 'talão por imprimir' : 'talões por imprimir'}
            </strong>
            — verifica a impressora (ligação, IP) e tenta de novo.
          </p>
          <button
            onClick={retryPending}
            disabled={retrying}
            className="flex items-center gap-1.5 rounded-xl bg-red-600 px-3.5 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-60"
          >
            <RotateCw size={13} className={retrying ? 'animate-spin' : ''} />
            {retrying ? 'A imprimir…' : 'Tentar de novo'}
          </button>
        </div>
      )}
```

- [ ] **Step 4: Badge no card + visual das agendadas.** No `OrderCard`, adicionar prop `pending: boolean` e no `<article className={clsx(...)}>` acrescentar a condição `pending && 'border-red-300'`. Junto ao chip "Agendado" existente, nada muda (o chip já existe). Adicionar por baixo do cabeçalho do card, quando `pending`:

```tsx
      {pending && (
        <p className="mb-2 inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-red-700">
          por imprimir
        </p>
      )}
```

No call site: `<OrderCard key={o.id} order={o} pending={pendingPrints.includes(o.id)} onAdvance={advance} onPrint={print} />`.

- [ ] **Step 5: Reimpressão no histórico.** No `<li>` do histórico, juntar um botão antes do chip de estado:

```tsx
                <span className="flex items-center gap-2">
                  <button
                    onClick={() => print(o)}
                    title="Reimprimir talão"
                    className="rounded-lg border border-line p-1.5 text-ink-mute transition-colors hover:border-brand/40 hover:text-brand-dark"
                  >
                    <Printer size={13} />
                  </button>
                  <span className={clsx(/* ...chip existente inalterado... */)}>
                    {/* ...texto existente... */}
                  </span>
                </span>
```

(mantendo o conteúdo atual do chip; só ganha o irmão botão.)

- [ ] **Step 6: `PrinterConfig.tsx` — secção de rede + toasts + aviso.** Juntar imports: `import { isNativeApp } from '@/lib/kitchen-printer';`. No componente: `const native = isNativeApp();` e `const { printerIp, printerPort, setPrinterIp, setPrinterPort } = usePrintStore();` (juntar ao destructuring existente). Envolver o bloco "estado/deteção QZ" e o bloco "impressora (select)" em `{!native && (...)}`, e adicionar no lugar deles, quando `native`:

```tsx
      {native && (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-[12.5px] font-medium text-ink-soft">
              IP da impressora de rede
            </label>
            <div className="flex gap-2">
              <input
                value={printerIp ?? ''}
                onChange={(e) => setPrinterIp(e.target.value.trim() || null)}
                placeholder="192.168.1.50"
                inputMode="decimal"
                className="min-w-0 flex-1 rounded-xl border border-line bg-white px-3.5 py-2.5 font-mono text-[14px] outline-none focus:border-brand"
              />
              <input
                value={printerPort}
                onChange={(e) => setPrinterPort(Number(e.target.value) || 9100)}
                inputMode="numeric"
                className="w-24 rounded-xl border border-line bg-white px-3.5 py-2.5 text-center font-mono text-[14px] outline-none focus:border-brand"
              />
            </div>
            <p className="text-[11.5px] leading-snug text-ink-mute">
              O tablet e a impressora têm de estar na mesma rede Wi-Fi (sem rede de
              convidados). Recomenda-se fixar o IP da impressora no router (reserva DHCP),
              senão pode mudar quando o router reinicia.
            </p>
          </div>
        </div>
      )}
```

`testPrint` passa a:

```ts
  async function testPrint() {
    try {
      const via = await printOrder({ ...SAMPLE }, storeName);
      if (via === 'unconfigured') {
        toast.error('Preenche o IP da impressora primeiro.');
        return;
      }
      toast.success(
        via === 'native'
          ? 'Talão de teste enviado para a impressora de rede'
          : via === 'qz'
            ? 'Talão de teste enviado para a térmica'
            : 'Talão aberto no browser',
      );
    } catch (e: any) {
      toast.error(e?.message ?? 'Erro ao imprimir');
    }
  }
```

E por baixo do toggle de auto-impressão (dentro do mesmo bloco), acrescentar:

```tsx
        <p className="mt-2 text-[11.5px] leading-snug text-amber-700">
          Liga a impressão automática só num dispositivo — com dois ligados saem dois
          talões por encomenda.
        </p>
```

(colocar o `<p>` imediatamente a seguir ao `<div>` do texto do toggle, dentro do cartão do toggle.)

- [ ] **Step 7: Typecheck e commit**

```bash
cd /Users/matheus.moraes/dev/comanda && PATH="$HOME/.local/node/bin:$PATH" pnpm --filter @comanda/dashboard typecheck
git add apps/dashboard/src/app/orders/page.tsx apps/dashboard/src/components/PrinterConfig.tsx
git commit -m "feat(dashboard): agendadas sem auto-print, fila por-imprimir com banner/retry, reimpressao no historico, config de impressora de rede"
```

---

### Task 8: Verificação integrada (CONTROLLER — browser real, stack local)

> Esta task é executada pelo controlador (tem o browser pane), não por um subagente.

- [ ] Stack local completa (db + api + dashboard). Login owner → gerar código de emparelhamento por API (`POST /tenants/me/kitchen/pair-code`).
- [ ] Abrir `/pair` no browser → introduzir o código → deve aterrar em `/orders` com: nav só "Receção", nome da loja estático (sem switcher), sem banners, chip "Ao vivo", auto-print ligado.
- [ ] Refresh da página → mantém-se em `/orders` (guard + hidratação + kitchenDevice).
- [ ] Navegar à mão para `/settings` → redireciona para `/orders`.
- [ ] Criar encomenda pública (loja demo) → aparece no quadro + toast de falha de impressão? (browser: via 'browser' abre janela — verificar comportamento e que NÃO entra na fila por-imprimir em caso de sucesso).
- [ ] Criar encomenda pública **agendada** (scheduledFor amanhã) → aparece com chip "Agendado", SEM auto-print.
- [ ] Parar a API → chip "A ligar…"; criar… rearrancar → "Ao vivo" + re-sync (a lista atualiza).
- [ ] "Desemparelhar" → aterra em `/pair`; refresh → continua em `/pair` (não `/login`); re-emparelhar com código novo funciona.
- [ ] Owner num separador normal: nav completa, switcher, banners como antes, "Sair" → `/login`.
- [ ] E2e da API continua verde: `node scripts/e2e-kitchen.mjs` → 42/42.

---

## Notas de execução

- Fim da fase: ramo `matheus-app-cozinha-fase2` completo + revisão final de ramo → merge ao main + push (fluxo do grupo). Deploy junta-se ao da Fase 1 (pendente de o utilizador nomear o host).
- Fase 3 (app Capacitor + plugin `KitchenPrinter` nativo) tem plano próprio a seguir; o contrato do plugin está fixado em `kitchen-printer.ts` (Task 4) e no spec §5.2.
