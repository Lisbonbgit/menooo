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
}

export interface ReservationWindow {
  weekday: number;
  openMinute: number;
  closeMinute: number;
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
}
