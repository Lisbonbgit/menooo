import { BadRequestException } from '@nestjs/common';
import { MenuType } from '@prisma/client';

/** Converte o parâmetro público (`delivery`|`dine_in`) para o enum; omisso = DELIVERY. */
export function parseMenuType(raw?: string): MenuType {
  if (!raw || raw === 'delivery') return MenuType.DELIVERY;
  if (raw === 'dine_in') return MenuType.DINE_IN;
  throw new BadRequestException('Menu inválido (usa "delivery" ou "dine_in").');
}
