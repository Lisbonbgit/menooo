export type ReservationStatus = 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW';

export interface ReservationTableRef {
  tableId: string;
  table: { name: string };
}

export interface Reservation {
  id: string;
  code: string;
  status: ReservationStatus;
  source: 'ONLINE' | 'MANUAL';
  partySize: number;
  startsAt: string;
  endsAt: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  notes: string | null;
  tables: ReservationTableRef[];
}

export interface Table {
  id: string;
  name: string;
  area: string | null;
  seats: number;
  joinable: boolean;
  bookableOnline: boolean;
  active: boolean;
  sortOrder: number;
  /** Coluna no mapa de sala (0..7). null = ainda não colocada — o auto-layout trata dela. */
  x: number | null;
  /** Linha no mapa de sala. null = ainda não colocada. */
  y: number | null;
  /** 'square' | 'round' — só leitura visual, não afeta a atribuição de mesas. */
  shape: string;
}

export interface ReservationWindow {
  weekday: number;
  openMinute: number;
  closeMinute: number;
}

/**
 * Serviço de reservas («Almoço», «Jantar») — a entidade com nome que sucedeu às janelas.
 * A ReservationWindow ainda existe no servidor (expand/contract), mas o painel já não a lê.
 */
export interface ReservationService {
  id: string;
  name: string;
  /** 0=domingo … 6=sábado (a convenção do OpeningHour). */
  weekdays: number[];
  openMinute: number;
  /** O último slot COMEÇA aqui: é uma janela de seating, não de estadia. */
  closeMinute: number;
  sortOrder: number;
}

/**
 * O serviço tal como um dia concreto o vê (GET /reservation-services/day?date=).
 *
 * `synthetic: true` = o dia não tem serviços nenhuns e corre pelo horário de abertura (−60min).
 * Não é uma linha da base de dados: não tem edição nem apagar, e o `id` é `synthetic-<weekday>`.
 */
export interface ServiceForDay {
  id: string;
  name: string;
  openMinute: number;
  closeMinute: number;
  synthetic: boolean;
}

export interface ReservationBlock {
  id: string;
  date: string;
  reason: string | null;
}

export interface ReservationConfig {
  reservationsEnabled: boolean;
  reservationDurationMin: number;
  reservationBufferMin: number;
  reservationMinNoticeMin: number;
  reservationMaxAdvanceDays: number;
  reservationMaxPartySize: number;
  /**
   * Tolerância de atraso (min). Só comunica — não liberta a mesa nem afeta a atribuição.
   *
   * ⚠️ O GET /tenants/me devolve-a (o getMine espalha a linha inteira do tenant), mas o
   * PATCH /tenants/me RECUSA-A: o UpdateTenantDto ainda não tem o campo e o ValidationPipe
   * corre com `forbidNonWhitelisted: true` — a gravação leva 400, não um silêncio.
   * Enquanto o DTO da API não a aceitar, não a mandes no useUpdateTenantConfig.
   */
  reservationGraceMin: number;
}
