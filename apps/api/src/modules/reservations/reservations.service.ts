import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, Reservation, ReservationStatus, Tenant, UserRole } from '@prisma/client';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { OrdersGateway } from '../orders/orders.gateway';
import { MailService, ReservationMailInfo } from '../mail/mail.service';
import { isSubscriptionUsable } from '../tenants/subscription.util';
import { localDateISO, localDateTimeToUtc, minutesOfDayInTz, weekdayOf } from './time.util';
import { slotMinutes } from './slots.util';
import { assignTables } from './assign.util';
import { CreatePublicReservationDto } from './dto/public-reservation.dto';

const SLOT_STEP_MIN = 30;
const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function genCode(): string {
  let out = '';
  for (let i = 0; i < 6; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}
function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
/** "HH:MM" a partir dos minutos do dia (mesmo formato usado nos slots). */
function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

type TenantWithHours = Prisma.TenantGetPayload<{
  include: { account: true; openingHours: true; reservationWindows: true };
}>;

type ReservationWithTables = Prisma.ReservationGetPayload<{
  include: { tables: { include: { table: true } } };
}>;

/** Subconjunto do Tenant necessário para emails/manageUrl (aceita tenant "cheio" ou só relação). */
type TenantForMail = Pick<Tenant, 'id' | 'name' | 'slug' | 'timezone' | 'email' | 'accountId'>;

@Injectable()
export class ReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: OrdersGateway,
    private readonly mail: MailService,
  ) {}

  // ==========================================================================
  // Gating + janelas
  // ==========================================================================

  /** Loja gated para reservas (404 neutro, padrão das encomendas). */
  private async gatedTenant(slug: string): Promise<TenantWithHours> {
    const t = await this.prisma.tenant.findUnique({
      where: { slug },
      include: { account: true, openingHours: true, reservationWindows: true },
    });
    if (!t || t.status !== 'ACTIVE' || !isSubscriptionUsable(t.account) || !t.reservationsEnabled) {
      throw new NotFoundException('Loja não encontrada.');
    }
    return t;
  }

  /** Janelas de SEATING de um weekday: ReservationWindow ou fallback OpeningHour−60. */
  private windowsFor(tenant: TenantWithHours, weekday: number) {
    const own = tenant.reservationWindows.filter((w) => w.weekday === weekday);
    if (own.length > 0) return own.map((w) => ({ openMinute: w.openMinute, closeMinute: w.closeMinute }));
    const oh = tenant.openingHours.find((h) => h.weekday === weekday);
    return oh ? [{ openMinute: oh.openMinute, closeMinute: oh.closeMinute - 60 }] : [];
  }

  // ==========================================================================
  // Slots
  // ==========================================================================

  /** Slots disponíveis de um dia (loja pública). */
  async publicSlots(slug: string, dateISO: string, party: number) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO ?? '') || !Number.isInteger(party) || party < 1 || party > 50) {
      throw new BadRequestException('Parâmetros inválidos.');
    }
    const tenant = await this.gatedTenant(slug);
    return this.slotsForDay(tenant, dateISO, party, 'ONLINE');
  }

  /** Variante fora de transação — delega em slotsForDayTx com this.prisma. */
  private async slotsForDay(
    tenant: TenantWithHours,
    dateISO: string,
    party: number,
    channel: 'ONLINE' | 'MANUAL',
  ) {
    return this.slotsForDayTx(this.prisma, tenant, dateISO, party, channel);
  }

  /** Slots disponíveis de um dia (uma query de reservas; ocupação por slot em memória). */
  private async slotsForDayTx(
    tx: Prisma.TransactionClient,
    tenant: TenantWithHours,
    dateISO: string,
    party: number,
    channel: 'ONLINE' | 'MANUAL',
  ): Promise<{ slots: string[]; reason?: string; contactPhone?: string | null }> {
    if (party > tenant.reservationMaxPartySize && channel === 'ONLINE')
      return { slots: [], reason: 'party', contactPhone: tenant.phone };
    const tz = tenant.timezone || 'Europe/Lisbon';
    // dia bloqueado
    const blocked = await tx.reservationBlock.findUnique({
      where: { tenantId_date: { tenantId: tenant.id, date: dateISO } },
    });
    if (blocked) return { slots: [] };
    // antecedência máxima (dias de calendário na tz do tenant)
    const todayISO = localDateISO(new Date(), tz);
    const diffDays = Math.round((Date.parse(dateISO) - Date.parse(todayISO)) / 86_400_000);
    if (diffDays < 0 || diffDays > tenant.reservationMaxAdvanceDays) return { slots: [] };

    const minutesList = slotMinutes(this.windowsFor(tenant, weekdayOf(dateISO)));
    if (minutesList.length === 0) return { slots: [] };

    const durMs = tenant.reservationDurationMin * 60_000;
    const bufMs = tenant.reservationBufferMin * 60_000;
    const notBefore = Date.now() + tenant.reservationMinNoticeMin * 60_000;

    // todas as reservas confirmadas que podem intersetar o dia (uma query)
    const dayStart = localDateTimeToUtc(dateISO, 0, tz);
    const dayEnd = new Date(dayStart.getTime() + 36 * 3_600_000);
    const busy = await tx.reservation.findMany({
      where: {
        tenantId: tenant.id,
        status: 'CONFIRMED',
        startsAt: { lt: new Date(dayEnd.getTime() + bufMs) },
        endsAt: { gt: new Date(dayStart.getTime() - bufMs) },
      },
      include: { tables: true },
    });
    const tables = await tx.table.findMany({ where: { tenantId: tenant.id, active: true } });

    const seen = new Set<number>(); // dedup por instante UTC (DST)
    const slots: { label: string; start: Date }[] = [];
    for (const m of minutesList) {
      const start = localDateTimeToUtc(dateISO, m, tz);
      if (seen.has(start.getTime())) continue;
      seen.add(start.getTime());
      if (start.getTime() < notBefore) continue;
      const end = new Date(start.getTime() + durMs);
      const occupied = new Set<string>();
      for (const r of busy) {
        if (r.startsAt.getTime() < end.getTime() + bufMs && r.endsAt.getTime() + bufMs > start.getTime()) {
          for (const rt of r.tables) occupied.add(rt.tableId);
        }
      }
      if (assignTables(tables, occupied, party, channel)) {
        slots.push({ label: hhmm(m), start });
      }
    }
    return { slots: slots.map((s) => s.label) };
  }

  // ==========================================================================
  // Atribuição de mesas (janela → mesas livres via assignTables)
  // ==========================================================================

  private async assignForWindowTx(
    tx: Prisma.TransactionClient,
    tenant: TenantWithHours,
    start: Date,
    end: Date,
    party: number,
    channel: 'ONLINE' | 'MANUAL',
  ): Promise<string[]> {
    const bufMs = tenant.reservationBufferMin * 60_000;
    const tables = await tx.table.findMany({ where: { tenantId: tenant.id, active: true } });
    const overlapping = await tx.reservation.findMany({
      where: {
        tenantId: tenant.id,
        status: 'CONFIRMED',
        startsAt: { lt: new Date(end.getTime() + bufMs) },
        endsAt: { gt: new Date(start.getTime() - bufMs) },
      },
      include: { tables: true },
    });
    const occupied = new Set<string>();
    for (const r of overlapping) for (const rt of r.tables) occupied.add(rt.tableId);
    const ids = assignTables(tables, occupied, party, channel);
    if (!ids) throw new ConflictException('Não há mesas disponíveis para esse horário.');
    return ids;
  }

  // ==========================================================================
  // Criação pública (advisory lock; revalidação completa; emails pós-commit)
  // ==========================================================================

  /** "HH:MM" → minutos do dia; NaN se hora/minuto fora de gama (formato já vem garantido pelo DTO). */
  private timeToMinutes(time: string): number {
    const m = /^(\d{2}):(\d{2})$/.exec(time);
    if (!m) return NaN;
    const h = Number(m[1]);
    const mi = Number(m[2]);
    if (h > 23 || mi > 59) return NaN;
    return h * 60 + mi;
  }

  async createPublic(slug: string, dto: CreatePublicReservationDto) {
    const tenant = await this.gatedTenant(slug);
    const tz = tenant.timezone || 'Europe/Lisbon';
    const minutes = this.timeToMinutes(dto.time); // "HH:MM" → int; 422 se NaN
    if (Number.isNaN(minutes)) throw new UnprocessableEntityException('Hora inválida.');

    // cap anti-spam: máx. 2 reservas futuras confirmadas por contacto
    const activeByContact = await this.prisma.reservation.count({
      where: {
        tenantId: tenant.id,
        status: 'CONFIRMED',
        startsAt: { gt: new Date() },
        OR: [{ customerEmail: dto.customerEmail }, { customerPhone: dto.customerPhone }],
      },
    });
    if (activeByContact >= 2) {
      throw new HttpException('Já tens reservas ativas neste restaurante. Contacta-o diretamente.', 429);
    }

    const created = await this.prisma.$transaction(async (tx) => {
      // $queryRaw falha a desserializar a coluna `void` de pg_advisory_xact_lock
      // (limitação conhecida do driver do Prisma) — $executeRaw não lê colunas.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenant.id}))`;
      // revalida o pipeline COMPLETO dentro do lock
      const { slots } = await this.slotsForDayTx(tx, tenant, dto.date, dto.partySize, 'ONLINE');
      if (!slots.includes(dto.time)) {
        throw new ConflictException({
          message: 'Esse horário acabou de ficar ocupado.',
          alternatives: slots.slice(0, 4),
        });
      }
      const start = localDateTimeToUtc(dto.date, minutes, tz);
      const end = new Date(start.getTime() + tenant.reservationDurationMin * 60_000);
      const tableIds = await this.assignForWindowTx(tx, tenant, start, end, dto.partySize, 'ONLINE');
      const token = randomBytes(32).toString('hex');
      const row = await this.createRowWithCode(tx, {
        tenantId: tenant.id,
        cancelTokenHash: sha256(token),
        source: 'ONLINE',
        partySize: dto.partySize,
        startsAt: start,
        endsAt: end,
        customerName: dto.customerName,
        customerPhone: dto.customerPhone,
        customerEmail: dto.customerEmail,
        notes: dto.notes ?? null,
        marketingConsent: dto.marketingConsent ?? false,
        tables: { create: tableIds.map((id) => ({ tableId: id })) },
      });
      return { row, token };
    });
    // pós-commit: emails + socket (nunca dentro da transação)
    void this.afterCreate(tenant, created.row, created.token);
    return this.publicView(tenant, created.row, created.token);
  }

  /** Cria a linha com código único (base32 6 chars); em P2002 (código repetido), re-gera (até 3×). */
  private async createRowWithCode(
    tx: Prisma.TransactionClient,
    data: Omit<Prisma.ReservationUncheckedCreateInput, 'code'>,
  ): Promise<ReservationWithTables> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await tx.reservation.create({
          data: { ...data, code: genCode() },
          include: { tables: { include: { table: true } } },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
        throw e;
      }
    }
    throw new Error('Não foi possível gerar o código da reserva.');
  }

  // ==========================================================================
  // View / cancelamento públicos (token neutro — MANUAL nunca acessível)
  // ==========================================================================

  private verifyToken(row: Pick<Reservation, 'cancelTokenHash'>, token: string | undefined): boolean {
    if (!row.cancelTokenHash || !token) return false; // MANUAL (hash null) = sempre 404 neutro
    const a = Buffer.from(sha256(token));
    const b = Buffer.from(row.cancelTokenHash);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async publicByCode(code: string, token: string | undefined) {
    const row = await this.prisma.reservation.findUnique({
      where: { code },
      include: { tables: { include: { table: true } }, tenant: true },
    });
    if (!row || !this.verifyToken(row, token)) throw new NotFoundException('Reserva não encontrada.');
    const tz = row.tenant.timezone || 'Europe/Lisbon';
    return {
      code: row.code,
      status: row.status,
      date: localDateISO(row.startsAt, tz),
      time: hhmm(minutesOfDayInTz(row.startsAt, tz)),
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      partySize: row.partySize,
      tableNames: row.tables.map((rt) => rt.table.name),
      restaurantName: row.tenant.name,
    };
  }

  async cancelByToken(code: string, token: string) {
    const row = await this.prisma.reservation.findUnique({
      where: { code },
      include: { tables: { include: { table: true } }, tenant: true },
    });
    if (!row || !this.verifyToken(row, token)) throw new NotFoundException('Reserva não encontrada.');
    if (row.status !== ReservationStatus.CONFIRMED || row.startsAt.getTime() <= Date.now()) {
      throw new BadRequestException('Esta reserva já não pode ser cancelada.');
    }
    // guarda atómica: só cancela se ainda estiver CONFIRMED (evita corrida com o painel)
    const result = await this.prisma.reservation.updateMany({
      where: { id: row.id, status: ReservationStatus.CONFIRMED },
      data: { status: ReservationStatus.CANCELLED, cancelledBy: 'CUSTOMER' },
    });
    if (result.count === 0) throw new BadRequestException('Esta reserva já não pode ser cancelada.');

    // pós-update: email ao cliente + alerta ao restaurante + socket updated (fora de qualquer transação)
    const updated: ReservationWithTables = { ...row, status: ReservationStatus.CANCELLED, cancelledBy: 'CUSTOMER' };
    const info = this.mailInfo(row.tenant, updated);
    if (row.customerEmail) {
      void this.mail.sendReservationCancelled(row.customerEmail, row.customerName, info, false);
    }
    const notifyTo = await this.restaurantNotifyEmail(row.tenant);
    if (notifyTo) {
      void this.mail.sendReservationCancelledAlert(notifyTo, { ...info, customerName: row.customerName });
    }
    this.gateway.emitReservationUpdated(row.tenantId, updated);
    return { ok: true };
  }

  // ==========================================================================
  // Pós-commit: emails + socket (nunca dentro de transação)
  // ==========================================================================

  private async afterCreate(tenant: TenantWithHours, row: ReservationWithTables, token: string) {
    const info = this.mailInfo(tenant, row, token);
    if (row.customerEmail) {
      void this.mail.sendReservationConfirmed(row.customerEmail, row.customerName, info);
    }
    const notifyTo = await this.restaurantNotifyEmail(tenant);
    if (notifyTo) {
      void this.mail.sendNewReservationAlert(notifyTo, {
        ...info,
        customerName: row.customerName,
        customerPhone: row.customerPhone,
        notes: row.notes,
      });
    }
    this.gateway.emitReservationCreated(tenant.id, row);
  }

  /** `${STORE_URL}/${slug}/reserva/${code}#t=${token}` — fragmento `#` nunca chega a logs de servidor. */
  private manageUrl(slug: string, code: string, token: string): string {
    return `${process.env.STORE_URL ?? 'http://localhost:3000'}/${slug}/reserva/${code}#t=${token}`;
  }

  private publicView(tenant: TenantForMail, row: ReservationWithTables, token: string) {
    return {
      code: row.code,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      partySize: row.partySize,
      tableNames: row.tables.map((rt) => rt.table.name),
      manageUrl: this.manageUrl(tenant.slug, row.code, token),
    };
  }

  private mailInfo(tenant: TenantForMail, row: ReservationWithTables, token?: string): ReservationMailInfo {
    const tz = tenant.timezone || 'Europe/Lisbon';
    const dateText = new Intl.DateTimeFormat('pt-PT', {
      timeZone: tz,
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(row.startsAt);
    const timeText = new Intl.DateTimeFormat('pt-PT', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(row.startsAt);
    return {
      restaurantName: tenant.name,
      code: row.code,
      dateText,
      timeText,
      partySize: row.partySize,
      tableNames: row.tables.map((rt) => rt.table.name),
      manageUrl: token ? this.manageUrl(tenant.slug, row.code, token) : undefined,
    };
  }

  /** Email de contacto do restaurante para alertas: tenant.email, senão o dono da conta. */
  private async restaurantNotifyEmail(tenant: TenantForMail): Promise<string | null> {
    if (tenant.email) return tenant.email;
    const owner = await this.prisma.user.findFirst({
      where: { accountId: tenant.accountId, role: UserRole.OWNER },
      orderBy: { createdAt: 'asc' },
      select: { email: true },
    });
    return owner?.email ?? null;
  }
}
