import { createParamDecorator, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AuthenticatedUser } from '../types/authenticated-user';

/** Devolve o accountId (conta do dono) do utilizador autenticado; 403 se não tiver. */
export const AccountId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const user = ctx.switchToHttp().getRequest().user as AuthenticatedUser | undefined;
  if (!user?.accountId) {
    throw new ForbiddenException('Esta ação requer uma conta associada.');
  }
  return user.accountId;
});
