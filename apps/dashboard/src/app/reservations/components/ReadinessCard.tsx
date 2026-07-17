'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CalendarCheck,
  Check,
  CheckCircle,
  Copy,
  ExternalLink,
  Globe,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useTables, useTenantConfig, useUpdateTenantConfig } from '@/lib/reservations-hooks';
import { serverError } from '@/components/ReservationSettings';
// A prontidão passou a ler os SERVIÇOS (não as janelas): o `effectiveHours` e o `hhmm` são os
// mesmos que o ServicesCard usa, para o cartão nunca divergir do que o dono edita.
import { effectiveHours, hhmm, useServices } from '@/components/ServicesCard';
import { useHours } from '@/lib/settings-hooks';
import type { ReservationConfig } from '@/lib/reservation-types';

/**
 * `GET /tenants/me` devolve o tenant completo, mas o tipo partilhado da R2 só declara a
 * configuração de reservas. A prontidão lê mais dois campos que já vêm na resposta: o
 * `slug` (link público) e o `email` (alertas de reserva).
 */
type TenantConfigFull = ReservationConfig & {
  id?: string;
  slug?: string;
  email?: string | null;
};

/**
 * Corpo do PATCH `/tenants/me`. O `UpdateTenantDto` aceita muito mais do que a config de
 * reservas (o `email` já lá está) — o tipo da mutação partilhada é que é mais estreito.
 */
type TenantPatch = Partial<ReservationConfig> & { email?: string | null };

const SHARED_EVENT = 'menooo:res-link-shared';
const sharedKey = (tenantId: string) => `menooo:res-link-shared:${tenantId}`;

function storeBaseUrl(): string {
  return process.env.NEXT_PUBLIC_STORE_URL ?? 'https://menooo.com';
}

/** «Link copiado» é um gesto do dono, não estado do servidor: fica guardado neste browser. */
function markResLinkShared(tenantId: string | undefined) {
  if (!tenantId || typeof window === 'undefined') return;
  localStorage.setItem(sharedKey(tenantId), '1');
  // O cartão de prontidão vive no topo da página e não desmonta quando se copia o link a
  // partir das Definições — sem este evento, o visto (4) só aparecia no refresh seguinte.
  window.dispatchEvent(new Event(SHARED_EVENT));
}

function useResLinkShared(tenantId: string | undefined): boolean {
  const [shared, setShared] = useState(false);
  useEffect(() => {
    if (!tenantId) return;
    // Lido depois da montagem: o localStorage não existe no render do servidor e a
    // diferença rebentaria a hidratação.
    const read = () => setShared(localStorage.getItem(sharedKey(tenantId)) === '1');
    read();
    window.addEventListener(SHARED_EVENT, read);
    return () => window.removeEventListener(SHARED_EVENT, read);
  }, [tenantId]);
  return shared;
}

// O `effectiveHours` e o `hhmm` mudaram-se para o ServicesCard (a mesma conta que o dono edita)
// e são importados no topo. Aqui só se lê o resultado.

// ==========================================================================
// Bloco de prontidão
// ==========================================================================

export function ReadinessCard({
  onGoTables,
  onGoSettings,
}: {
  onGoTables: () => void;
  onGoSettings: () => void;
}): JSX.Element | null {
  const config = useTenantConfig();
  const updateConfig = useUpdateTenantConfig();
  const tables = useTables();
  const services = useServices();
  const hours = useHours();
  const [toggling, setToggling] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const tenant = config.data as TenantConfigFull | undefined;
  const shared = useResLinkShared(tenant?.id);

  // Sinal do Turnstile: em produção, `enforced:false` = o POST público auto-confirma mesas
  // reais sem proteção nenhuma. É aqui que o dono decide abrir ao público — é aqui que tem
  // de ver o vermelho.
  // Autenticado de propósito: o /health é público e dizer ao mundo `enforced:false` seria um
  // oráculo a apontar a janela para atacar o endpoint que auto-confirma mesas.
  const health = useQuery({
    queryKey: ['turnstile-status'],
    queryFn: async () =>
      (await api.get<{ enforced: boolean }>('/reservations/turnstile-status')).data,
    staleTime: 60_000,
    retry: false,
  });

  if (!tenant) return null;

  const bookable = (tables.data ?? []).filter((t) => t.active && t.bookableOnline);
  const days = effectiveHours(services.data ?? [], hours.data ?? []);
  const fallbackDays = days.filter((d) => d.source === 'hours');
  const hasEmail = !!(tenant.email ?? '').trim();
  const enabled = tenant.reservationsEnabled === true;
  const canEnable = bookable.length > 0;
  const link = tenant.slug ? `${storeBaseUrl()}/${tenant.slug}/reservar` : null;

  // O painel não conhece o ambiente da API; conhece o seu. Em `next dev` isto é
  // 'development' e o aviso nunca dispara — o build de produção é que fala com a API de
  // produção. (A API expõe isto em GET /reservations/turnstile-status, autenticado.)
  const turnstileOff = process.env.NODE_ENV === 'production' && health.data?.enforced === false;

  const ready = canEnable && days.length > 0 && hasEmail && shared;
  const checklistOpen = showDetails || !ready || !enabled;

  async function toggle() {
    const next = !enabled;
    // Desligar é sempre possível: se o dono apagar as mesas com as reservas ligadas, a
    // saída de emergência não pode estar trancada. Só LIGAR é que exige mesas — e o
    // servidor recusa na mesma (400), mas ninguém deve descobrir isto por um erro.
    if (next && !canEnable) {
      toast.error('Cria pelo menos 1 mesa reservável online antes de ligar as reservas.');
      onGoTables();
      return;
    }
    setToggling(true);
    try {
      await updateConfig.mutateAsync({ reservationsEnabled: next });
      toast.success(next ? 'Reservas online ligadas' : 'Reservas online desligadas');
    } catch (err) {
      toast.error(serverError(err, 'Não foi possível mudar o interruptor.'));
    } finally {
      setToggling(false);
    }
  }

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      markResLinkShared(tenant?.id);
      toast.success('Link copiado');
    } catch {
      toast.error('Não foi possível copiar — seleciona e copia à mão.');
    }
  }

  return (
    <section className="animate-fade-up mb-6 rounded-xl border border-line bg-white p-5 shadow-card">
      {/* ---- interruptor (fonte única: mesma mutação e mesma queryKey da config) ---- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-ink-mute">
            <CalendarCheck size={17} />
          </span>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-mute">
              Reservas
            </p>
            <h2 className="font-display text-[16px] font-semibold leading-tight">
              {enabled ? 'A tua loja aceita reservas online' : 'Reservas online desligadas'}
            </h2>
            <p className="mt-0.5 text-[12px] text-ink-mute">
              {enabled
                ? 'Os clientes conseguem reservar mesa pelo link e pela tua loja.'
                : 'Liga quando estiver tudo pronto — os clientes só veem o botão depois disso.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {ready && enabled && (
            <button
              type="button"
              onClick={() => setShowDetails((v) => !v)}
              className="text-[12.5px] font-medium text-brand hover:underline"
            >
              {showDetails ? 'Esconder' : 'Ver prontidão'}
            </button>
          )}
          <button
            type="button"
            onClick={toggle}
            disabled={toggling}
            aria-label="Alternar reservas online"
            aria-pressed={enabled}
            // `aria-disabled` e não `disabled`: um botão morto não explica nada. Assim o
            // clique continua a chegar e responde com o motivo (e leva-o às Mesas).
            aria-disabled={!enabled && !canEnable}
            className={clsx(
              'relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-60',
              enabled ? 'bg-green-500' : !canEnable ? 'bg-stone-200' : 'bg-stone-300',
            )}
          >
            <span
              className={clsx(
                'absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all',
                enabled ? 'left-7' : 'left-1',
              )}
            />
          </button>
        </div>
      </div>

      {/* ---- Turnstile: o dono não pode abrir ao público sem saber que está sem rede ---- */}
      {turnstileOff && (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3">
          <span className="mt-0.5 text-red-600">
            <ShieldAlert size={15} />
          </span>
          <p className="text-[12.5px] leading-relaxed text-red-800">
            <strong>Proteção anti-spam desligada.</strong> As reservas online estão sem o
            filtro que trava robôs — cada pedido ocupa uma mesa real e confirma-se sozinho.
            Fala com a equipa Menooo antes de divulgares o link.
          </p>
        </div>
      )}

      {checklistOpen && (
        <ul className="mt-4 space-y-2.5 border-t border-dashed border-line pt-4">
          {/* (1) mesas — o único bloqueador do interruptor */}
          <Item
            state={canEnable ? 'ok' : 'todo'}
            title={
              canEnable
                ? `${bookable.length} ${bookable.length === 1 ? 'mesa reservável' : 'mesas reserváveis'} online`
                : 'Sem mesas reserváveis online'
            }
            desc={
              canEnable
                ? undefined
                : 'Sem mesas, quem abrisse o link via 30 dias sem horários — loja partida, e tu sem sinal nenhum. É por isto que o interruptor está travado.'
            }
            action={
              canEnable ? undefined : (
                <RowButton onClick={onGoTables}>Criar mesas</RowButton>
              )
            }
          />

          {/* (2) horas efetivas, com proveniência */}
          <Item
            state={days.length === 0 ? 'todo' : fallbackDays.length > 0 ? 'warn' : 'ok'}
            title={
              days.length === 0
                ? 'Sem horários para reservar'
                : `Reservas em ${days.length} ${days.length === 1 ? 'dia da semana' : 'dias da semana'}`
            }
            desc={
              days.length === 0
                ? 'Não há serviços nem horário de abertura — nenhum dia teria horas para escolher.'
                : undefined
            }
            action={
              days.length === 0 ? (
                <RowButton onClick={onGoSettings}>Criar serviços</RowButton>
              ) : undefined
            }
          >
            {days.length > 0 && (
              <>
                <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                  {days.map((d) => (
                    <li key={d.weekday} className="text-[11.5px] text-ink-soft">
                      <span className="font-medium">{d.short}</span>{' '}
                      <span className="tabular-nums">
                        {d.ranges.map((r) => `${hhmm(r.first)}–${hhmm(r.last)}`).join(' · ')}
                      </span>
                      {d.source === 'hours' && <span className="ml-1 text-ink-mute">(horário)</span>}
                    </li>
                  ))}
                </ul>
                {fallbackDays.length > 0 && (
                  <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                    <p className="text-[11.5px] leading-relaxed text-amber-900">
                      <strong>
                        {fallbackDays[0].short} {hhmm(fallbackDays[0].ranges[0].first)}–
                        {hhmm(fallbackDays[0].ranges[0].last)}
                      </strong>{' '}
                      — vem do teu horário de abertura, não de um serviço: a última reserva é 1h
                      antes de fechares. Se fechas a meio da tarde, o horário contínuo deixa
                      reservar à hora em que a cozinha já está fechada. Cria serviços (Almoço,
                      Jantar) para mandares nas horas.
                    </p>
                    <button
                      type="button"
                      onClick={onGoSettings}
                      className="mt-1.5 text-[11.5px] font-semibold text-amber-900 underline"
                    >
                      Criar serviços
                    </button>
                  </div>
                )}
              </>
            )}
          </Item>

          {/* (3) email de alertas */}
          <Item
            state={hasEmail ? 'ok' : 'warn'}
            title={hasEmail ? `Alertas para ${tenant.email}` : 'Email de alertas por confirmar'}
            desc={
              hasEmail
                ? undefined
                : 'Sem email próprio, os alertas de reserva vão para o email de quem criou a conta. Se não tens o painel aberto, o email é o único aviso que recebes.'
            }
          >
            <AlertEmailField value={tenant.email} />
          </Item>

          {/* (4) link partilhado */}
          <Item
            state={shared ? 'ok' : 'warn'}
            title={shared ? 'Link de reservas copiado' : 'Link de reservas por divulgar'}
            desc={
              shared
                ? 'Podes voltar a copiá-lo (e ao botão para o teu site) nas Definições.'
                : 'Ninguém reserva num link que não conhece: põe-no no Instagram, no Google e no teu site.'
            }
            action={
              link ? (
                <div className="flex gap-1.5">
                  <RowButton onClick={copyLink}>
                    <Copy size={12.5} /> Copiar link
                  </RowButton>
                  <a
                    href={link}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-medium text-ink-soft transition-colors hover:border-brand/40 hover:text-brand-dark"
                  >
                    <ExternalLink size={12.5} /> Abrir
                  </a>
                </div>
              ) : undefined
            }
          />
        </ul>
      )}
    </section>
  );
}

/** Email de alertas de reservas (`tenant.email`). Vazio = os alertas caem no email da conta. */
function AlertEmailField({ value }: { value: string | null | undefined }): JSX.Element {
  const updateConfig = useUpdateTenantConfig();
  const [email, setEmail] = useState(value ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => setEmail(value ?? ''), [value]);

  const current = (value ?? '').trim();
  const next = email.trim();
  const dirty = next !== current;

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      // ARMADILHA (3ª vez neste projeto): `undefined` some no JSON.stringify, o backend
      // mantém o valor antigo e a UI diz "guardado". Para LIMPAR mandamos `null` — o
      // `@IsOptional()` do UpdateTenantDto deixa passar o null (a string vazia é que levava
      // 400 no `@IsEmail`) e o Prisma grava NULL, repondo o fallback para o email da conta.
      const patch: TenantPatch = { email: next === '' ? null : next };
      await updateConfig.mutateAsync(patch as Partial<ReservationConfig>);
      toast.success(
        next === '' ? 'Alertas repostos para o email da conta' : 'Email de alertas guardado',
      );
    } catch (err) {
      toast.error(serverError(err, 'Não foi possível guardar o email de alertas.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="reservas@arestaurante.pt"
        aria-label="Email de alertas de reservas"
        className="min-w-56 flex-1 rounded-lg border border-line bg-white px-3 py-1.5 text-[12.5px] outline-none focus:border-brand"
      />
      <button
        type="button"
        onClick={save}
        disabled={!dirty || saving}
        className="rounded-lg bg-brand px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-40"
      >
        {saving ? 'A guardar…' : 'Guardar'}
      </button>
    </div>
  );
}

type ItemState = 'ok' | 'warn' | 'todo';

const ITEM_ICON: Record<ItemState, { icon: JSX.Element; cls: string }> = {
  ok: { icon: <CheckCircle size={15} />, cls: 'text-green-600' },
  warn: { icon: <AlertTriangle size={15} />, cls: 'text-amber-600' },
  todo: { icon: <XCircle size={15} />, cls: 'text-red-600' },
};

function Item({
  state,
  title,
  desc,
  action,
  children,
}: {
  state: ItemState;
  title: string;
  desc?: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
}): JSX.Element {
  const meta = ITEM_ICON[state];
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-2">
      <span className={clsx('mt-0.5 shrink-0', meta.cls)}>{meta.icon}</span>
      <div className="min-w-0 flex-1">
        <p
          className={clsx(
            'text-[13px] font-medium',
            state === 'todo' ? 'text-red-800' : state === 'warn' ? 'text-ink' : 'text-ink-soft',
          )}
        >
          {title}
        </p>
        {desc && <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-mute">{desc}</p>}
        {children}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </li>
  );
}

function RowButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12px] font-medium text-ink-soft shadow-card transition-colors hover:border-brand/40 hover:text-brand-dark"
    >
      {children}
    </button>
  );
}

// ==========================================================================
// Partilha — link direto + botão para o site (padrão do WebsiteWidget das encomendas)
// ==========================================================================

export function ShareCard(): JSX.Element | null {
  const config = useTenantConfig();
  const tenant = config.data as TenantConfigFull | undefined;
  if (!tenant?.slug) return null;

  const base = storeBaseUrl();
  const link = `${base}/${tenant.slug}/reservar`;
  const floatSnippet = `<script src="${base}/embed.js" data-slug="${tenant.slug}" data-reservas="1" defer></script>`;
  const ownSnippet = `<script src="${base}/embed.js" data-slug="${tenant.slug}" data-reservas="1" data-button="hidden" defer></script>\n<button data-menooo-reservar>Reservar mesa</button>`;

  return (
    <section className="rounded-xl border border-line bg-white p-5 shadow-card">
      <div className="mb-4 flex items-start gap-3">
        <span className="mt-0.5 text-ink-mute">
          <Globe size={17} />
        </span>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-mute">
            Reservas
          </p>
          <h2 className="font-display text-[16px] font-semibold leading-tight">
            Partilha as tuas reservas
          </h2>
          <p className="mt-0.5 text-[12px] text-ink-mute">
            As reservas só chegam se o link chegar primeiro. Escolhe a forma que te der jeito —
            em todas, a reserva cai no teu painel.
          </p>
        </div>
      </div>

      <p className="mb-2 text-[13px] font-semibold text-ink">A) Link direto — o mais simples</p>
      <p className="mb-2 text-[12px] text-ink-mute">
        Põe este endereço na bio do Instagram, no perfil do Google, no WhatsApp ou num botão do
        teu site. Abre a página de reserva em página inteira, sem código.
      </p>
      <Snippet code={link} tenantId={tenant.id} />

      <p className="mb-2 mt-5 text-[13px] font-semibold text-ink">
        B) Botão no teu site — sem sair da página
      </p>
      <p className="mb-3 text-[12px] text-ink-mute">
        Abre a reserva numa janela sobreposta. Cola o código no{' '}
        <strong>“Código personalizado”</strong> do teu site, antes de{' '}
        <code className="rounded bg-cream px-1 py-0.5 text-[11px]">&lt;/body&gt;</code> — não num
        bloco de texto.
      </p>
      <Snippet
        title="Botão flutuante (aparece sozinho no canto)"
        code={floatSnippet}
        tenantId={tenant.id}
      />
      <Snippet
        title="O teu próprio botão (ex.: “Reservar mesa”)"
        desc="Esconde o botão flutuante e liga o teu: mete data-menooo-reservar em qualquer botão ou link."
        code={ownSnippet}
        tenantId={tenant.id}
      />

      <p className="mt-1 text-[11.5px] leading-relaxed text-ink-mute">
        Já tens o botão de encomendas no site? Podes manter os dois — cola os dois scripts e cada
        botão abre o seu. Muda o texto e a cor com{' '}
        <code className="rounded bg-cream px-1 py-0.5">data-label="…"</code> e{' '}
        <code className="rounded bg-cream px-1 py-0.5">data-color="#E05A1E"</code>.
      </p>
    </section>
  );
}

function Snippet({
  title,
  desc,
  code,
  tenantId,
}: {
  title?: string;
  desc?: string;
  code: string;
  tenantId?: string;
}): JSX.Element {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      markResLinkShared(tenantId);
      setCopied(true);
      toast.success('Copiado');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Não foi possível copiar — seleciona e copia à mão.');
    }
  }

  return (
    <div className="mb-4">
      {title && <p className="text-[13px] font-semibold text-ink">{title}</p>}
      {desc && <p className="mb-2 text-[12px] text-ink-mute">{desc}</p>}
      <div className="relative">
        <pre className="overflow-x-auto whitespace-pre rounded-xl border border-line bg-espresso px-4 py-3.5 pr-24 text-[12px] leading-relaxed text-cream">
          <code>{code}</code>
        </pre>
        <button
          onClick={copy}
          className="absolute right-2 top-2 flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-brand-dark"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? 'Copiado' : 'Copiar'}
        </button>
      </div>
    </div>
  );
}
