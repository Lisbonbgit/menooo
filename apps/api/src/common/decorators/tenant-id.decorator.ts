import { createParamDecorator, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AuthenticatedUser } from '../types/authenticated-user';

/** Devolve o tenantId do utilizador autenticado; lança 403 se não tiver. */
export const TenantId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const user = ctx.switchToHttp().getRequest().user as AuthenticatedUser | undefined;
  if (!user?.tenantId) {
    throw new ForbiddenException('Esta ação requer um restaurante associado.');
  }
  return user.tenantId;
});
