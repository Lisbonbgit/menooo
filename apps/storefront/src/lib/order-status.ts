export type TrackType = 'DELIVERY' | 'PICKUP';
export type TrackStatus =
  | 'PENDING' | 'ACCEPTED' | 'PREPARING' | 'READY'
  | 'OUT_FOR_DELIVERY' | 'COMPLETED' | 'REJECTED' | 'CANCELLED';

export interface TrackStep { key: TrackStatus; label: string; }

/** Passos visíveis por tipo de pedido. PICKUP não tem "A caminho". */
export function stepsFor(type: TrackType): TrackStep[] {
  const base: TrackStep[] = [
    { key: 'PENDING', label: 'Recebido' },
    { key: 'ACCEPTED', label: 'Aceite' },
    { key: 'PREPARING', label: 'Em preparação' },
  ];
  if (type === 'DELIVERY') {
    return [
      ...base,
      { key: 'READY', label: 'Pronto' },
      { key: 'OUT_FOR_DELIVERY', label: 'A caminho' },
      { key: 'COMPLETED', label: 'Entregue' },
    ];
  }
  return [
    ...base,
    { key: 'READY', label: 'Pronto para levantar' },
    { key: 'COMPLETED', label: 'Concluído' },
  ];
}

/** Índice do passo atual (-1 se o estado não está na lista, ex. terminal negativo). */
export function currentStepIndex(status: TrackStatus, type: TrackType): number {
  return stepsFor(type).findIndex((s) => s.key === status);
}

export function isNegative(status: TrackStatus): boolean {
  return status === 'REJECTED' || status === 'CANCELLED';
}

export function isTerminal(status: TrackStatus): boolean {
  return status === 'COMPLETED' || isNegative(status);
}
