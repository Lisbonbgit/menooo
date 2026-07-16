import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
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
import {
  CreateBlockDto,
  CreateManualReservationDto,
  CreateTableDto,
  SetWindowsDto,
  UpdateReservationDto,
  UpdateReservationStatusDto,
  UpdateTableDto,
} from './dto/panel.dto';

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

/** Valida que "YYYY-MM-DD" é uma data de calendário real (rejeita p.ex. 2026-02-30). */
function isRealDateISO(dateISO: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(Date.UTC(y, mo - 1, day, 12));
  return d.getUTCFullYear() === y && d.getUTCMonth() === mo - 1 && d.getUTCDate() === day;
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
  private readonly logger = new Logger(ReservationsService.name);

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
    if (!isRealDateISO(dateISO)) throw new BadRequestException('Data inválida.');
    const tenant = await this.gatedTenant(slug);
    const result = await this.slotsForDay(tenant, dateISO, party, 'ONLINE');
    return { ...result, slots: result.slots.map((s) => s.label) };
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
  ): Promise<{ slots: { label: string; start: Date }[]; reason?: string; contactPhone?: string | null }> {
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
    return { slots };
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
    excludeReservationId?: string,
  ): Promise<string[]> {
    const bufMs = tenant.reservationBufferMin * 60_000;
    const tables = await tx.table.findMany({ where: { tenantId: tenant.id, active: true } });
    const overlapping = await tx.reservation.findMany({
      where: {
        tenantId: tenant.id,
        status: 'CONFIRMED',
        ...(excludeReservationId ? { id: { not: excludeReservationId } } : {}),
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

  /**
   * Mesas forçadas (MANUAL/edição): valida só posse (do tenant), ativas e
   * não-sobreposição — máx. 2. `joinable`/`area`/`seats` são ignorados de propósito
   * (o dono sabe melhor; o aviso de capacidade insuficiente é da UI).
   */
  private async forcedTables(
    tx: Prisma.TransactionClient,
    tenant: TenantWithHours,
    tableIds: string[],
    start: Date,
    end: Date,
    excludeReservationId?: string,
  ): Promise<string[]> {
    if (tableIds.length > 2) throw new BadRequestException('Só é possível forçar até 2 mesas.');
    const tables = await tx.table.findMany({ where: { id: { in: tableIds }, tenantId: tenant.id } });
    if (tables.length !== tableIds.length) {
      throw new BadRequestException('Uma ou mais mesas não pertencem a este restaurante.');
    }
    if (tables.some((t) => !t.active)) {
      throw new BadRequestException('Uma ou mais mesas estão inativas.');
    }
    const bufMs = tenant.reservationBufferMin * 60_000;
    const overlapping = await tx.reservation.findMany({
      where: {
        tenantId: tenant.id,
        status: 'CONFIRMED',
        ...(excludeReservationId ? { id: { not: excludeReservationId } } : {}),
        startsAt: { lt: new Date(end.getTime() + bufMs) },
        endsAt: { gt: new Date(start.getTime() - bufMs) },
      },
      include: { tables: true },
    });
    const occupied = new Set<string>();
    for (const r of overlapping) for (const rt of r.tables) occupied.add(rt.tableId);
    if (tableIds.some((id) => occupied.has(id))) {
      throw new ConflictException('Uma das mesas escolhidas já está ocupada nesse horário.');
    }
    return tableIds;
  }

  /** Tenant completo (painel) — 404 se a unidade não existir; sem gating de subscrição/reservas. */
  private async requireTenant(tenantId: string): Promise<TenantWithHours> {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { account: true, openingHours: true, reservationWindows: true },
    });
    if (!t) throw new NotFoundException('Restaurante não encontrado.');
    return t;
  }

  /** Row de reserva para o painel/socket — sem o hash do token de cancelamento. */
  private publicRow<T extends { cancelTokenHash?: string | null }>(row: T) {
    const { cancelTokenHash: _drop, ...rest } = row;
    return rest;
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
    if (!isRealDateISO(dto.date)) throw new BadRequestException('Data inválida.');
    const tenant = await this.gatedTenant(slug);
    const tz = tenant.timezone || 'Europe/Lisbon';
    const minutes = this.timeToMinutes(dto.time); // "HH:MM" → int; 422 se NaN
    if (Number.isNaN(minutes)) throw new UnprocessableEntityException('Hora inválida.');

    // mensagem verdadeira para grupos grandes — nunca o 409 de "ocupado"
    if (dto.partySize > tenant.reservationMaxPartySize) {
      throw new UnprocessableEntityException(
        `Para grupos de mais de ${tenant.reservationMaxPartySize} pessoas, contacta o restaurante diretamente.`,
      );
    }

    // 422 se a hora não cair na grelha das janelas do dia (sem filtro de ocupação/notice)
    const grid = slotMinutes(this.windowsFor(tenant, weekdayOf(dto.date)));
    if (minutes % 30 !== 0 || !grid.includes(minutes)) {
      throw new UnprocessableEntityException('Hora inválida para reservas neste dia.');
    }
    const wanted = localDateTimeToUtc(dto.date, minutes, tz);

    const created = await this.prisma.$transaction(
      async (tx) => {
        // $queryRaw falha a desserializar a coluna `void` de pg_advisory_xact_lock
        // (limitação conhecida do driver do Prisma) — $executeRaw não lê colunas.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenant.id}))`;

        // cap anti-spam: máx. 2 reservas futuras confirmadas por contacto (dentro do lock)
        const activeByContact = await tx.reservation.count({
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

        // revalida o pipeline COMPLETO dentro do lock — comparação pelo INSTANTE, não pelo label
        const { slots } = await this.slotsForDayTx(tx, tenant, dto.date, dto.partySize, 'ONLINE');
        if (!slots.some((s) => s.start.getTime() === wanted.getTime())) {
          throw new ConflictException({
            message: 'Esse horário acabou de ficar ocupado.',
            alternatives: slots.slice(0, 4).map((s) => s.label),
          });
        }
        const start = wanted;
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
      },
      { timeout: 15_000 },
    );
    // pós-commit: emails + socket (nunca dentro da transação) — falha nunca derruba um 201 já commitado
    this.afterCreate(tenant, created.row, created.token).catch((e) =>
      this.logger.error(`pós-criação de reserva falhou: ${e?.message ?? e}`),
    );
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

    // pós-update (fora de qualquer transação): socket primeiro; email nunca derruba um cancelamento já commitado
    const updated: ReservationWithTables = { ...row, status: ReservationStatus.CANCELLED, cancelledBy: 'CUSTOMER' };
    this.gateway.emitReservationUpdated(row.tenantId, this.publicRow(updated));
    this.afterCancel(row.tenant, row, updated).catch((e) =>
      this.logger.error(`pós-cancelamento de reserva falhou: ${e?.message ?? e}`),
    );
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
    this.gateway.emitReservationCreated(tenant.id, this.publicRow(row));
  }

  /** Pós-cancelamento: email ao cliente + alerta ao restaurante (socket já emitido antes desta chamada). */
  private async afterCancel(tenant: TenantForMail, row: ReservationWithTables, updated: ReservationWithTables) {
    const info = this.mailInfo(tenant, updated);
    if (row.customerEmail) {
      await this.mail.sendReservationCancelled(row.customerEmail, row.customerName, info, false);
    }
    const notifyTo = await this.restaurantNotifyEmail(tenant);
    if (notifyTo) {
      await this.mail.sendReservationCancelledAlert(notifyTo, { ...info, customerName: row.customerName });
    }
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

  // ==========================================================================
  // Painel — Mesas
  // ==========================================================================

  listTables(tenantId: string) {
    return this.prisma.table.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  createTable(tenantId: string, dto: CreateTableDto) {
    return this.prisma.table.create({
      data: {
        tenantId,
        name: dto.name,
        seats: dto.seats,
        area: dto.area ?? null,
        joinable: dto.joinable ?? false,
        bookableOnline: dto.bookableOnline ?? true,
        active: dto.active ?? true,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async updateTable(tenantId: string, id: string, dto: UpdateTableDto) {
    const result = await this.prisma.table.updateMany({ where: { id, tenantId }, data: dto });
    if (result.count === 0) throw new NotFoundException('Mesa não encontrada.');
    return this.prisma.table.findUniqueOrThrow({ where: { id } });
  }

  /** Apaga a mesa; recusa (409) se tiver reservas no histórico — desativa-a em vez disso. */
  async deleteTable(tenantId: string, id: string) {
    return this.prisma.$transaction(
      async (tx) => {
        // mesmo lock por tenant das criações/edições de reservas — serializa contra uma
        // atribuição concorrente que ligue esta mesa a uma reserva nova entre o check e o delete
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}))`;
        const owned = await tx.table.count({ where: { id, tenantId } });
        if (owned === 0) throw new NotFoundException('Mesa não encontrada.');
        const history = await tx.reservationTable.count({ where: { tableId: id } });
        if (history > 0) {
          throw new ConflictException(
            'Esta mesa tem reservas no histórico — desativa-a em vez de apagar.',
          );
        }
        await tx.table.deleteMany({ where: { id, tenantId } });
        return { deleted: true };
      },
      { timeout: 15_000 },
    );
  }

  // ==========================================================================
  // Painel — Reservas
  // ==========================================================================

  /** Reservas de um dia LOCAL do tenant, ordenadas, com nomes das mesas. */
  async listReservations(tenantId: string, dateISO: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO ?? '')) throw new BadRequestException('Data inválida.');
    const tenant = await this.requireTenant(tenantId);
    const tz = tenant.timezone || 'Europe/Lisbon';
    const dayStart = localDateTimeToUtc(dateISO, 0, tz);
    const dayEnd = new Date(dayStart.getTime() + 36 * 3_600_000);
    const rows = await this.prisma.reservation.findMany({
      where: { tenantId, startsAt: { gte: dayStart, lt: dayEnd } },
      include: { tables: { include: { table: { select: { name: true } } } } },
      orderBy: { startsAt: 'asc' },
    });
    return rows.filter((r) => localDateISO(r.startsAt, tz) === dateISO).map((r) => this.publicRow(r));
  }

  /**
   * Reserva manual (painel): ignora grelha/minNotice/maxAdvance/maxPartySize; hora
   * arredondada a 15 min; sem email ao restaurante (foi ele que criou) — só socket.
   */
  async createManual(tenantId: string, dto: CreateManualReservationDto) {
    if (!isRealDateISO(dto.date)) throw new BadRequestException('Data inválida.');
    const tenant = await this.requireTenant(tenantId);
    const tz = tenant.timezone || 'Europe/Lisbon';
    const minutes = this.timeToMinutes(dto.time);
    if (Number.isNaN(minutes)) throw new UnprocessableEntityException('Hora inválida.');
    const start = localDateTimeToUtc(dto.date, minutes - (minutes % 15), tz);
    const durationMin = dto.durationMin ?? tenant.reservationDurationMin;
    const end = new Date(start.getTime() + durationMin * 60_000);

    const row = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}))`;

        const tableIds =
          dto.tableIds && dto.tableIds.length > 0
            ? await this.forcedTables(tx, tenant, dto.tableIds, start, end)
            : await this.assignForWindowTx(tx, tenant, start, end, dto.partySize, 'MANUAL');

        return this.createRowWithCode(tx, {
          tenantId,
          cancelTokenHash: null,
          source: 'MANUAL',
          partySize: dto.partySize,
          startsAt: start,
          endsAt: end,
          customerName: dto.customerName,
          customerPhone: dto.customerPhone ?? '',
          customerEmail: dto.customerEmail ?? null,
          notes: dto.notes ?? null,
          tables: { create: tableIds.map((tableId) => ({ tableId })) },
        });
      },
      { timeout: 15_000 },
    );

    this.gateway.emitReservationCreated(tenantId, this.publicRow(row));
    return this.publicRow(row);
  }

  /**
   * Edição (painel): só CONFIRMED. Só re-atribui mesas quando a COLOCAÇÃO muda
   * (data/hora/duração/pax, ou mesas forçadas novas) — edições de contactos/notas
   * nunca tocam nas mesas nem re-verificam sobreposição (a janela não mudou). Quando a
   * colocação muda sem mesas forçadas novas, tenta primeiro manter as mesas ATUAIS se
   * continuarem livres na janela nova; só re-atribui automaticamente se não estiverem
   * (mudar a hora não salta silenciosamente de mesa se ela continuar livre). Sem email
   * automático ao cliente. Socket updated.
   */
  async updateReservation(tenantId: string, id: string, dto: UpdateReservationDto) {
    if (dto.date !== undefined && !isRealDateISO(dto.date)) {
      throw new BadRequestException('Data inválida.');
    }
    const tenant = await this.requireTenant(tenantId);
    const tz = tenant.timezone || 'Europe/Lisbon';

    const placementChanged =
      dto.date !== undefined ||
      dto.time !== undefined ||
      dto.durationMin !== undefined ||
      dto.partySize !== undefined ||
      (dto.tableIds !== undefined && dto.tableIds.length > 0);

    const updated = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}))`;

        const existing = await tx.reservation.findFirst({ where: { id, tenantId }, include: { tables: true } });
        if (!existing) throw new NotFoundException('Reserva não encontrada.');
        if (existing.status !== ReservationStatus.CONFIRMED) {
          throw new BadRequestException('Só é possível editar reservas confirmadas.');
        }

        if (!placementChanged) {
          // sem impacto na colocação (só contactos/notas): nunca mexe nas mesas
          const result = await tx.reservation.updateMany({
            where: { id, tenantId, status: ReservationStatus.CONFIRMED },
            data: {
              customerName: dto.customerName ?? existing.customerName,
              // `?? ''` porque customerPhone é String não-nula no schema: enviar null
              // LIMPA o telefone (o `??` sozinho tratava null como "manter o antigo")
              customerPhone:
                dto.customerPhone !== undefined ? (dto.customerPhone ?? '') : existing.customerPhone,
              customerEmail: dto.customerEmail !== undefined ? dto.customerEmail : existing.customerEmail,
              notes: dto.notes !== undefined ? dto.notes : existing.notes,
            },
          });
          if (result.count === 0) throw new NotFoundException('Reserva não encontrada.');
          return tx.reservation.findUniqueOrThrow({
            where: { id },
            include: { tables: { include: { table: true } } },
          });
        }

        let start = existing.startsAt;
        if (dto.date !== undefined || dto.time !== undefined) {
          const dateISO = dto.date ?? localDateISO(existing.startsAt, tz);
          const rawMinutes =
            dto.time !== undefined ? this.timeToMinutes(dto.time) : minutesOfDayInTz(existing.startsAt, tz);
          if (Number.isNaN(rawMinutes)) throw new UnprocessableEntityException('Hora inválida.');
          start = localDateTimeToUtc(dateISO, rawMinutes - (rawMinutes % 15), tz);
        }
        const durationMin =
          dto.durationMin ?? Math.round((existing.endsAt.getTime() - existing.startsAt.getTime()) / 60_000);
        const end = new Date(start.getTime() + durationMin * 60_000);
        const partySize = dto.partySize ?? existing.partySize;

        let tableIds: string[];
        if (dto.tableIds && dto.tableIds.length > 0) {
          tableIds = await this.forcedTables(tx, tenant, dto.tableIds, start, end, existing.id);
        } else {
          const currentTableIds = existing.tables.map((t) => t.tableId);
          if (currentTableIds.length > 0) {
            try {
              // revalida as mesas ATUAIS na janela nova (mesma verificação de sobreposição
              // das mesas forçadas); só cai na re-atribuição automática se não estiverem livres
              tableIds = await this.forcedTables(tx, tenant, currentTableIds, start, end, existing.id);
            } catch (e) {
              if (e instanceof HttpException) {
                tableIds = await this.assignForWindowTx(tx, tenant, start, end, partySize, 'MANUAL', existing.id);
              } else {
                throw e;
              }
            }
          } else {
            tableIds = await this.assignForWindowTx(tx, tenant, start, end, partySize, 'MANUAL', existing.id);
          }
        }

        const result = await tx.reservation.updateMany({
          where: { id, tenantId },
          data: {
            startsAt: start,
            endsAt: end,
            partySize,
            customerName: dto.customerName ?? existing.customerName,
            // `?? ''` porque customerPhone é String não-nula no schema: enviar null
            // LIMPA o telefone (o `??` sozinho tratava null como "manter o antigo")
            customerPhone:
              dto.customerPhone !== undefined ? (dto.customerPhone ?? '') : existing.customerPhone,
            customerEmail: dto.customerEmail !== undefined ? dto.customerEmail : existing.customerEmail,
            notes: dto.notes !== undefined ? dto.notes : existing.notes,
          },
        });
        if (result.count === 0) throw new NotFoundException('Reserva não encontrada.');

        await tx.reservationTable.deleteMany({ where: { reservationId: id } });
        await tx.reservationTable.createMany({
          data: tableIds.map((tableId) => ({ reservationId: id, tableId })),
        });

        return tx.reservation.findUniqueOrThrow({
          where: { id },
          include: { tables: { include: { table: true } } },
        });
      },
      { timeout: 15_000 },
    );

    this.gateway.emitReservationUpdated(tenantId, this.publicRow(updated));
    return this.publicRow(updated);
  }

  /**
   * Muda o estado (só a partir de CONFIRMED). CANCELLED → cancelledBy 'RESTAURANT' +
   * email ao cliente se tiver email (socket primeiro, email com catch — nunca deita
   * abaixo a resposta). NO_SHOW/COMPLETED → só socket.
   */
  async updateStatus(tenantId: string, id: string, dto: UpdateReservationStatusDto) {
    const existing = await this.prisma.reservation.findFirst({
      where: { id, tenantId },
      include: { tenant: true },
    });
    if (!existing) throw new NotFoundException('Reserva não encontrada.');
    if (existing.status !== ReservationStatus.CONFIRMED) {
      throw new BadRequestException('Só é possível alterar o estado de reservas confirmadas.');
    }

    // guarda atómica: só transita se ainda estiver CONFIRMED (evita corrida entre painéis)
    const result = await this.prisma.reservation.updateMany({
      where: { id, tenantId, status: ReservationStatus.CONFIRMED },
      data: {
        status: dto.status as ReservationStatus,
        ...(dto.status === 'CANCELLED' ? { cancelledBy: 'RESTAURANT' } : {}),
      },
    });
    if (result.count === 0) {
      throw new BadRequestException('Só é possível alterar o estado de reservas confirmadas.');
    }

    const updated = await this.prisma.reservation.findUniqueOrThrow({
      where: { id },
      include: { tables: { include: { table: true } } },
    });
    this.gateway.emitReservationUpdated(tenantId, this.publicRow(updated));

    if (dto.status === 'CANCELLED' && existing.customerEmail) {
      const info = this.mailInfo(existing.tenant, updated);
      void this.mail
        .sendReservationCancelled(existing.customerEmail, existing.customerName, info, true)
        .catch((e) => this.logger.error(`email de cancelamento (painel) falhou: ${e?.message ?? e}`));
    }
    return this.publicRow(updated);
  }

  // ==========================================================================
  // Painel — Janelas de reserva
  // ==========================================================================

  listWindows(tenantId: string) {
    return this.prisma.reservationWindow.findMany({
      where: { tenantId },
      orderBy: [{ weekday: 'asc' }, { openMinute: 'asc' }],
    });
  }

  /** Substitui a lista completa de janelas (máx. 2/weekday; fecho > abertura). */
  async setWindows(tenantId: string, dto: SetWindowsDto) {
    const perWeekday = new Map<number, number>();
    for (const w of dto.windows) {
      if (w.closeMinute <= w.openMinute) {
        throw new BadRequestException(
          `Janela inválida no dia ${w.weekday}: o fecho tem de ser depois da abertura.`,
        );
      }
      const count = (perWeekday.get(w.weekday) ?? 0) + 1;
      if (count > 2) throw new BadRequestException(`Máximo de 2 janelas por dia (dia ${w.weekday}).`);
      perWeekday.set(w.weekday, count);
    }
    await this.prisma.$transaction(
      async (tx) => {
        // mesmo lock por tenant das reservas — mas aqui só serializa PUTs concorrentes de
        // janelas entre si (evita duas escritas em corrida a pisarem-se uma à outra). NÃO
        // serializa contra um createPublic em voo: esse lê o tenant (com as janelas) fora
        // desta tx, antes do lock; na pior das hipóteses vê a config do snapshot pré-lock —
        // janela de milissegundos, efeito inócuo (o pipeline público revalida tudo dentro
        // do seu próprio lock, incl. a grelha de horas).
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}))`;
        await tx.reservationWindow.deleteMany({ where: { tenantId } });
        await tx.reservationWindow.createMany({
          data: dto.windows.map((w) => ({
            tenantId,
            weekday: w.weekday,
            openMinute: w.openMinute,
            closeMinute: w.closeMinute,
          })),
        });
      },
      { timeout: 15_000 },
    );
    return this.listWindows(tenantId);
  }

  // ==========================================================================
  // Painel — Bloqueios de dia
  // ==========================================================================

  listBlocks(tenantId: string) {
    return this.prisma.reservationBlock.findMany({ where: { tenantId }, orderBy: { date: 'asc' } });
  }

  async createBlock(tenantId: string, dto: CreateBlockDto) {
    if (!isRealDateISO(dto.date)) throw new BadRequestException('Data inválida.');
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // mesmo lock por tenant do createPublic — fecha a corrida "Pausar hoje" (bloqueio
          // de dia) vs um POST público em voo para a mesma data
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}))`;
          return await tx.reservationBlock.create({
            data: { tenantId, date: dto.date, reason: dto.reason ?? null },
          });
        },
        { timeout: 15_000 },
      );
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Esse dia já está bloqueado.');
      }
      throw e;
    }
  }

  async deleteBlock(tenantId: string, id: string) {
    const result = await this.prisma.reservationBlock.deleteMany({ where: { id, tenantId } });
    if (result.count === 0) throw new NotFoundException('Bloqueio não encontrado.');
    return { deleted: true };
  }
}
