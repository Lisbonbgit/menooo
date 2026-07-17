'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock,
  Loader2,
  MapPin,
  Phone,
  UtensilsCrossed,
  Users,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store-hooks';
import { useReservationDays, useReservationSlots } from '@/lib/reservation-public-hooks';
import { AddressMap } from '@/components/AddressMap';
import { StoreTheme } from '@/components/StoreTheme';

const inputCls =
  'w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-[14px] shadow-card outline-none transition-colors focus:border-brand';

/** A sitekey é BUILD-TIME (inlinada no bundle). Sem ela o formulário funciona — é o dev. */
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';
const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  execute: (id: string) => void;
  reset: (id?: string) => void;
  remove: (id: string) => void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let turnstileScript: Promise<void> | null = null;

/** Carrega o api.js da Cloudflare uma só vez por página. */
function loadTurnstile(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('ssr'));
  if (window.turnstile) return Promise.resolve();
  if (turnstileScript) return turnstileScript;
  turnstileScript = new Promise<void>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = TURNSTILE_SRC;
    el.async = true;
    el.defer = true;
    el.onload = () => resolve();
    el.onerror = () => {
      turnstileScript = null; // deixa tentar outra vez numa navegação seguinte
      reject(new Error('turnstile_script_error'));
    };
    document.head.appendChild(el);
  });
  return turnstileScript;
}

// ---------------------------------------------------------------------------
// Datas: a grelha é montada na hora LOCAL do browser; o servidor revalida sempre
// na timezone da loja (é ele que manda). Um desencontro de fuso só faz um dia
// aparecer esbatido, nunca cria uma reserva errada.
// ---------------------------------------------------------------------------

function todayISO(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/** Soma dias a "yyyy-mm-dd" ao meio-dia — imune às mudanças de hora. */
function addDaysISO(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

const weekdayFmt = new Intl.DateTimeFormat('pt-PT', { weekday: 'short' });
const longFmt = new Intl.DateTimeFormat('pt-PT', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

function dayChipLabel(iso: string, index: number): { top: string; bottom: string } {
  const d = new Date(`${iso}T12:00:00`);
  if (index === 0) return { top: 'Hoje', bottom: String(d.getDate()) };
  if (index === 1) return { top: 'Amanhã', bottom: String(d.getDate()) };
  const wd = weekdayFmt.format(d).replace('.', '');
  return { top: wd.charAt(0).toUpperCase() + wd.slice(1), bottom: String(d.getDate()) };
}

function longDate(iso: string): string {
  return longFmt.format(new Date(`${iso}T12:00:00`));
}

/** A mensagem do servidor pode vir como array (class-validator). */
function serverMessage(data: unknown): string | null {
  const m = (data as { message?: unknown } | undefined)?.message;
  if (typeof m === 'string') return m;
  if (Array.isArray(m) && typeof m[0] === 'string') return m[0];
  return null;
}

interface Placed {
  code: string;
  partySize: number;
  manageUrl: string;
}

interface FormError {
  message: string;
  /** Chips clicáveis de um 409 de horário ocupado. */
  alternatives?: string[];
  /** Telefone para `tel:` — 409 CONTACT_CAP e becos sem saída. */
  contactPhone?: string | null;
}

export function ReservarClient({ slug }: { slug: string }) {
  const store = useStore(slug);
  const qc = useQueryClient();

  const [party, setParty] = useState(2);
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [marketing, setMarketing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<FormError | null>(null);
  const [placed, setPlaced] = useState<Placed | null>(null);

  const s = store.data;
  const enabled = !!s && s.reservationsEnabled;

  const from = todayISO();
  // min(30, maxAdvance) chips — numa loja com 7 dias de antecedência, 23 chips a dizer
  // sempre «sem horários» seriam uma montra a mentir.
  const dayCount = s ? Math.max(1, Math.min(30, s.reservationMaxAdvanceDays)) : 1;
  const to = addDaysISO(from, dayCount - 1);
  const maxParty = s ? Math.max(1, Math.min(50, s.reservationMaxPartySize)) : 1;

  const days = useReservationDays(slug, from, to, party, enabled && !placed);
  const slots = useReservationSlots(slug, placed ? null : date, party);

  // ---- Turnstile ----------------------------------------------------------
  const widgetBox = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const pending = useRef<{ resolve: (t: string) => void; reject: (e: Error) => void } | null>(null);
  const [turnstileFailed, setTurnstileFailed] = useState(false);

  const formVisible = enabled && !placed;

  useEffect(() => {
    if (!SITE_KEY || !formVisible) return;
    let cancelled = false;
    // ~8 s a carregar (bloqueadores, redes corporativas) → fallback de telefone, em vez de
    // submeter para um 403 garantido.
    const timer = setTimeout(() => {
      if (!cancelled && !widgetId.current) setTurnstileFailed(true);
    }, 8_000);

    (async () => {
      try {
        await loadTurnstile();
        // o onload do script pode chegar antes de o objeto estar exposto
        for (let i = 0; i < 40 && !window.turnstile; i++) {
          await new Promise((r) => setTimeout(r, 100));
        }
        if (cancelled) return;
        if (!widgetBox.current || !window.turnstile) throw new Error('turnstile_unavailable');
        widgetId.current = window.turnstile.render(widgetBox.current, {
          sitekey: SITE_KEY,
          action: 'reserva', // o servidor exige esta action — sitekey exclusiva das reservas
          execution: 'execute', // token obtido no SUBMIT: à carga da página expirava (~5 min)
          appearance: 'interaction-only',
          callback: (token: string) => {
            pending.current?.resolve(token);
            pending.current = null;
          },
          'error-callback': () => {
            pending.current?.reject(new Error('turnstile_error'));
            pending.current = null;
          },
          'timeout-callback': () => {
            pending.current?.reject(new Error('turnstile_timeout'));
            pending.current = null;
          },
        });
        if (!cancelled) setTurnstileFailed(false);
      } catch {
        if (!cancelled) setTurnstileFailed(true);
      } finally {
        clearTimeout(timer);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      const id = widgetId.current;
      widgetId.current = null;
      if (id && window.turnstile) window.turnstile.remove(id);
    };
  }, [formVisible]);

  /** Token novo a cada submissão (expira ~5 min). Sem sitekey resolve `undefined` (dev). */
  function turnstileToken(): Promise<string | undefined> {
    if (!SITE_KEY) return Promise.resolve(undefined);
    const id = widgetId.current;
    if (!id || !window.turnstile) return Promise.reject(new Error('turnstile_unavailable'));
    return new Promise<string>((resolve, reject) => {
      const t = setTimeout(() => {
        pending.current = null;
        reject(new Error('turnstile_timeout'));
      }, 20_000);
      pending.current = {
        resolve: (tok) => {
          clearTimeout(t);
          resolve(tok);
        },
        reject: (e) => {
          clearTimeout(t);
          reject(e);
        },
      };
      window.turnstile!.reset(id);
      window.turnstile!.execute(id);
    });
  }

  // ---- Ramos de estado ----------------------------------------------------
  // O StoreTheme mete as CSS vars num useEffect e remove-as no unmount: tem de vir em TODOS
  // os returns, senão a loja pinta-se de laranja Menooo consoante o ramo.

  if (placed && s) {
    return (
      <main className="mx-auto max-w-md px-4 pb-12 pt-6">
        <StoreTheme brandColor={s.brandColor} heroColor={s.heroColor} />
        <div className="animate-fade-up rounded-3xl border border-line bg-white p-7 text-center shadow-lift">
          <span className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
            <CheckCircle2 className="text-green-600" size={34} />
          </span>
          <h1 className="font-display text-[26px] font-semibold">Mesa reservada!</h1>
          <p className="mt-1.5 text-[13px] text-ink-mute">
            Está confirmada — não é preciso fazer mais nada.
          </p>

          <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-mute">
            Código da reserva
          </p>
          <p className="font-display text-[34px] font-semibold tracking-[0.14em] text-brand-dark">
            {placed.code}
          </p>

          <div className="mt-4 space-y-1.5 rounded-xl bg-cream/70 px-4 py-3.5 text-[13.5px]">
            <p className="font-semibold">{date && longDate(date)}</p>
            <p className="text-ink-soft">
              {time} · {placed.partySize} {placed.partySize === 1 ? 'pessoa' : 'pessoas'}
            </p>
            {(s.address || s.city) && (
              <p className="text-[12.5px] text-ink-mute">
                {[s.address, s.zipCode, s.city].filter(Boolean).join(', ')}
              </p>
            )}
          </div>

          <p className="mt-4 text-[12.5px] leading-relaxed text-ink-soft">
            Chega à hora marcada; se te atrasares, liga ao restaurante para não perderes a mesa.
          </p>

          {/* BOTÃO, nunca o URL como texto: o link de gestão É a credencial e um token em
              texto literal entra em todos os screenshots («olha, reservei!»). */}
          <a
            href={placed.manageUrl}
            className="mt-6 block rounded-xl bg-brand py-3 text-[14px] font-semibold text-white shadow-card transition-colors hover:bg-brand-dark"
          >
            Gerir a minha reserva
          </a>
          {s.phone && (
            <a
              href={`tel:${s.phone}`}
              className="mt-2.5 flex items-center justify-center gap-1.5 rounded-xl border border-line py-3 text-[13.5px] font-medium text-ink-soft transition-colors hover:bg-cream"
            >
              <Phone size={14} /> Ligar ao restaurante
            </a>
          )}
          <Link
            href={`/${slug}`}
            className="mt-4 block text-[13px] font-medium text-ink-mute hover:text-ink"
          >
            Ver o menu da loja
          </Link>
        </div>
      </main>
    );
  }

  if (store.isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        {s && <StoreTheme brandColor={s.brandColor} heroColor={s.heroColor} />}
        <div className="flex flex-col items-center gap-3 text-ink-mute">
          <UtensilsCrossed size={28} strokeWidth={1.5} className="animate-pulse" />
          <p className="text-sm">A preparar a mesa…</p>
        </div>
      </main>
    );
  }

  // `isError` com dados em cache é possível (refetch falhado, retry: false) — daí o guarda
  // do StoreTheme também aqui: sem ele o ramo desmontava as CSS vars e a loja piscava laranja.
  if (store.isError || !s) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-2 p-8 text-center">
        {s && <StoreTheme brandColor={s.brandColor} heroColor={s.heroColor} />}
        <UtensilsCrossed size={30} strokeWidth={1.5} className="text-ink-mute" />
        <p className="font-display text-xl font-semibold">Loja não encontrada</p>
        <p className="text-sm text-ink-mute">Confirma o endereço que te enviaram.</p>
      </main>
    );
  }

  // Reservas desligadas ≠ loja inexistente: o link é permanente e espalha-se pela internet;
  // o dono desliga uma semana (obras) e isto não pode dizer que o restaurante não existe.
  // Também apanha o 404 de gating a meio do fluxo (o dono desliga com a página aberta).
  const gated =
    !s.reservationsEnabled ||
    (days.error as { response?: { status?: number } } | null)?.response?.status === 404 ||
    (slots.error as { response?: { status?: number } } | null)?.response?.status === 404;

  if (gated) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <StoreTheme brandColor={s.brandColor} heroColor={s.heroColor} />
        <div className="w-full max-w-sm rounded-3xl border border-line bg-white p-8 text-center shadow-card">
          <CalendarDays size={28} strokeWidth={1.5} className="mx-auto text-ink-mute" />
          <h1 className="mt-3 font-display text-[21px] font-semibold">
            Reservas online indisponíveis
          </h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-ink-soft">
            As reservas online d{'’'}
            {s.name} estão temporariamente indisponíveis.
            {s.phone ? ' Liga-nos para marcares a tua mesa.' : ''}
          </p>
          {s.phone && (
            <a
              href={`tel:${s.phone}`}
              className="mt-5 flex items-center justify-center gap-2 rounded-xl bg-brand py-3 text-[14px] font-semibold text-white shadow-card transition-colors hover:bg-brand-dark"
            >
              <Phone size={15} /> {s.phone}
            </a>
          )}
          <Link
            href={`/${slug}`}
            className="mt-2.5 block rounded-xl border border-line py-3 text-[13.5px] font-medium text-ink-soft transition-colors hover:bg-cream"
          >
            Ver o menu da loja
          </Link>
        </div>
      </main>
    );
  }

  // ---- Ações --------------------------------------------------------------

  function pickParty(n: number) {
    setParty(n);
    setTime(null); // a grelha de horas depende do nº de pessoas
    setError(null);
  }

  function pickDay(iso: string) {
    setDate(iso);
    setTime(null);
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!date || !time) {
      setError({ message: 'Escolhe o dia e a hora da reserva.' });
      return;
    }
    if (!name.trim()) return setError({ message: 'Indica o teu nome.' });
    if (!phone.trim()) return setError({ message: 'Indica o teu número de telefone.' });
    if (!email.trim()) return setError({ message: 'Indica o teu email — é para lá que vai a confirmação.' });

    setError(null);
    setLoading(true);
    try {
      await send(false);
    } finally {
      setLoading(false);
    }
  }

  async function send(isRetry: boolean): Promise<void> {
    let token: string | undefined;
    try {
      token = await turnstileToken();
    } catch {
      setTurnstileFailed(true);
      setError({
        message: 'Não conseguimos validar o pedido neste dispositivo.',
        contactPhone: s?.phone ?? null,
      });
      return;
    }

    try {
      const { data } = await api.post(`/public/stores/${slug}/reservations`, {
        date,
        time,
        partySize: party,
        customerName: name.trim(),
        customerPhone: phone.trim(),
        customerEmail: email.trim(),
        notes: notes.trim() || undefined,
        marketingConsent: marketing,
        turnstileToken: token,
      });
      qc.invalidateQueries({ queryKey: ['res-slots'] });
      qc.invalidateQueries({ queryKey: ['res-days'] });
      setPlaced({ code: data.code, partySize: data.partySize, manageUrl: data.manageUrl });
    } catch (e) {
      const err = e as { response?: { status?: number; data?: any } };
      const status = err.response?.status;
      const data = err.response?.data;

      // 403 do Turnstile: o token expira sozinho (~5 min), logo isto acontece sobretudo a
      // gente legítima que hesitou. reset() em SILÊNCIO e uma segunda tentativa — nunca
      // mandar recarregar, que deitaria fora tudo o que o cliente escolheu e escreveu.
      if (status === 403 && SITE_KEY && !isRetry) {
        if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
        return send(true);
      }

      if (status === 409) {
        qc.invalidateQueries({ queryKey: ['res-slots'] });
        if (data?.code === 'CONTACT_CAP') {
          setError({
            message: serverMessage(data) ?? 'Já tens reservas ativas neste restaurante.',
            contactPhone: data?.contactPhone ?? s?.phone ?? null,
          });
          return;
        }
        setError({
          message: serverMessage(data) ?? 'Esse horário acabou de ficar ocupado.',
          alternatives: Array.isArray(data?.alternatives) ? data.alternatives : undefined,
        });
        return;
      }

      if (status === 429) {
        // NUNCA ecoar data.message: o ThrottlerException sai «Too Many Requests», em inglês.
        setError({ message: 'Demasiados pedidos deste dispositivo. Espera um minuto e tenta de novo.' });
        return;
      }

      if (status === 403) {
        setError({
          message: 'Não foi possível validar o pedido. Tenta de novo.',
          contactPhone: s?.phone ?? null,
        });
        return;
      }

      setError({
        message: serverMessage(data) ?? 'Não foi possível concluir a reserva. Tenta de novo.',
      });
    }
  }

  // ---- Conteúdo -----------------------------------------------------------

  const morada = [s.address, s.zipCode, s.city].filter(Boolean).join(', ');
  const dayList = days.data?.days ?? [];
  const slotList = slots.data?.slots ?? [];
  const partyTooBig = days.data?.reason === 'party' || slots.data?.reason === 'party';

  return (
    <main className="mx-auto max-w-md px-4 pb-12 pt-6">
      <StoreTheme brandColor={s.brandColor} heroColor={s.heroColor} />
      <Link
        href={`/${slug}`}
        className="mb-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-soft transition-colors hover:text-ink"
      >
        <ArrowLeft size={15} /> Ver o menu
      </Link>

      {/* 1. topo — quem és e onde ficas: uma reserva é o cliente a deslocar-se */}
      <header className="mb-6">
        <h1 className="font-display text-[28px] font-semibold leading-tight tracking-tight">
          Reservar mesa
        </h1>
        <p className="mt-1 font-display text-[17px] text-brand-dark">{s.name}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {morada && (
            <span className="flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-[12px] text-ink-soft shadow-card">
              <MapPin size={13} className="text-brand" /> {morada}
            </span>
          )}
          {s.phone && (
            <a
              href={`tel:${s.phone}`}
              className="flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-[12px] font-medium text-ink-soft shadow-card transition-colors hover:border-brand/40"
            >
              <Phone size={13} className="text-brand" /> {s.phone}
            </a>
          )}
        </div>
        {morada && (
          <div className="mt-3">
            <AddressMap query={morada} />
          </div>
        )}
      </header>

      <form onSubmit={submit} className="space-y-6">
        {/* 2. pessoas */}
        <Section title="Quantas pessoas" icon={<Users size={13} />}>
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: maxParty }, (_, i) => i + 1).map((n) => (
              <Chip key={n} active={party === n} onClick={() => pickParty(n)}>
                {n}
              </Chip>
            ))}
          </div>
          {s.phone ? (
            <a
              href={`tel:${s.phone}`}
              className="mt-1 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-brand-dark hover:underline"
            >
              <Phone size={13} /> Mais de {maxParty} pessoas · liga-nos
            </a>
          ) : (
            <Link
              href={`/${slug}`}
              className="mt-1 inline-block text-[12.5px] font-medium text-brand-dark hover:underline"
            >
              Mais de {maxParty} pessoas · contacta-nos pela loja
            </Link>
          )}
        </Section>

        {/* 3. dia — UM pedido para toda a grelha */}
        <Section title="Que dia" icon={<CalendarDays size={13} />}>
          {days.isLoading && (
            <p className="flex items-center gap-2 text-[13px] text-ink-mute">
              <Loader2 size={14} className="animate-spin" /> A ver a disponibilidade…
            </p>
          )}
          {partyTooBig && (
            <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-[12.5px] text-amber-900">
              Para grupos deste tamanho, fala connosco diretamente.
            </p>
          )}
          {days.isError && !partyTooBig && (
            <p className="rounded-xl bg-red-50 px-3 py-2.5 text-[12.5px] text-red-700">
              Não foi possível carregar os dias. Verifica a ligação e tenta de novo.
            </p>
          )}
          {!days.isLoading && !partyTooBig && dayList.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {dayList.map((d, i) => {
                const lbl = dayChipLabel(d.date, i);
                return (
                  <button
                    key={d.date}
                    type="button"
                    disabled={!d.hasSlots}
                    onClick={() => pickDay(d.date)}
                    aria-label={longDate(d.date)}
                    className={
                      'flex min-w-[3.4rem] flex-col items-center rounded-xl border px-2.5 py-2 text-center transition-all ' +
                      (date === d.date
                        ? 'border-brand bg-brand text-white shadow-card'
                        : d.hasSlots
                          ? 'border-line bg-white text-ink-soft hover:border-brand/40'
                          : 'cursor-not-allowed border-line bg-cream/50 text-ink-mute/50')
                    }
                  >
                    <span className="text-[10.5px] font-medium uppercase tracking-wide">
                      {lbl.top}
                    </span>
                    <span className="text-[15px] font-semibold leading-tight">{lbl.bottom}</span>
                  </button>
                );
              })}
            </div>
          )}
        </Section>

        {/* 4. hora */}
        {date && !partyTooBig && (
          <Section title="A que horas" icon={<Clock size={13} />}>
            {slots.isLoading && (
              <p className="flex items-center gap-2 text-[13px] text-ink-mute">
                <Loader2 size={14} className="animate-spin" /> A carregar horários…
              </p>
            )}
            {!slots.isLoading && slotList.length === 0 && (
              <p className="text-[13px] text-ink-mute">
                Sem horários neste dia. Escolhe outro dia.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {slotList.map((h) => (
                <Chip key={h} active={time === h} onClick={() => setTime(h)}>
                  {h}
                </Chip>
              ))}
            </div>
          </Section>
        )}

        {/* 5. dados */}
        <Section title="Os teus dados">
          <Field label="Nome">
            <input
              value={name}
              required
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Número de telefone">
            <input
              type="tel"
              value={phone}
              required
              maxLength={30}
              onChange={(e) => setPhone(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              value={email}
              required
              maxLength={200}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="para receberes a confirmação"
              className={inputCls}
            />
          </Field>
          <Field label="Notas (opcional)">
            <input
              value={notes}
              maxLength={500}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex.: aniversário, cadeira de bebé, mesa na esplanada, acesso com carrinho"
              className={inputCls}
            />
          </Field>
          <label className="flex cursor-pointer items-start gap-2.5 pt-0.5 text-[12.5px] text-ink-soft">
            <input
              type="checkbox"
              checked={marketing}
              onChange={(e) => setMarketing(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
            />
            Aceito receber promoções e novidades desta loja por email/telefone.
          </label>

          {/* Turnstile: invisível até haver desafio a fazer. */}
          {SITE_KEY && <div ref={widgetBox} className="pt-1" />}
          {turnstileFailed && (
            <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-[12.5px] text-amber-900">
              A verificação de segurança não carregou (pode ser um bloqueador ou a rede).
              {s.phone ? (
                <>
                  {' '}
                  Liga-nos para{' '}
                  <a href={`tel:${s.phone}`} className="font-semibold underline">
                    {s.phone}
                  </a>{' '}
                  e marcamos a tua mesa.
                </>
              ) : (
                ' Tenta noutro browser ou noutra rede.'
              )}
            </p>
          )}
        </Section>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
            <p>{error.message}</p>
            {error.alternatives && error.alternatives.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-2">
                {error.alternatives.map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => {
                      setTime(h);
                      setError(null);
                    }}
                    className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-[13px] font-semibold text-red-700 transition-colors hover:bg-red-100"
                  >
                    {h}
                  </button>
                ))}
              </div>
            )}
            {error.contactPhone && (
              <a
                href={`tel:${error.contactPhone}`}
                className="mt-2.5 inline-flex items-center gap-1.5 font-semibold underline"
              >
                <Phone size={13} /> {error.contactPhone}
              </a>
            )}
          </div>
        )}

        <div>
          <p className="mb-2.5 text-center text-[12px] leading-relaxed text-ink-mute">
            Reserva grátis e sem compromisso — podes cancelar a qualquer momento no link que te
            damos a seguir.
          </p>
          <button
            type="submit"
            disabled={loading || !date || !time || turnstileFailed}
            className="w-full rounded-xl bg-brand py-4 text-[15px] font-semibold text-white shadow-lift transition-all hover:bg-brand-dark active:scale-[0.99] disabled:opacity-50"
          >
            {loading
              ? 'A reservar…'
              : date && time
                ? `Reservar · ${time} · ${party} ${party === 1 ? 'pessoa' : 'pessoas'}`
                : 'Escolhe o dia e a hora'}
          </button>
        </div>
      </form>
    </main>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3.5 rounded-xl border border-line bg-white p-5 shadow-card">
      <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-mute">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'min-w-[2.75rem] rounded-xl border px-3 py-2 text-center text-[13.5px] font-semibold transition-all ' +
        (active
          ? 'border-brand bg-brand text-white shadow-card'
          : 'border-line bg-white text-ink-soft hover:border-brand/40')
      }
    >
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[12.5px] font-medium text-ink-soft">{label}</label>
      {children}
    </div>
  );
}
