'use client';

import type { Reservation } from '@/lib/reservation-types';

export function ReservationFormModal({
  mode,
  reservation,
  onClose,
}: {
  mode: 'create' | 'edit';
  reservation?: Reservation;
  onClose: () => void;
}): JSX.Element {
  return <p className="text-[13px] text-ink-mute">Em construção.</p>;
}
