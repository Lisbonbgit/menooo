import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { TurnstileService } from './turnstile.service';

// Os 3 secrets abaixo são os secrets de TESTE PÚBLICOS da Cloudflare e estes testes chamam o
// siteverify a sério — é de propósito: sem eles o único caminho coberto seria o no-op, ou seja,
// exatamente aquele em que a proteção não existe (spec §5).
describe('TurnstileService', () => {
  const svc = new TurnstileService();
  afterEach(() => {
    delete process.env.TURNSTILE_SECRET_KEY;
    delete process.env.NODE_ENV;
  });

  it('sem secret é no-op (dev/e2e)', async () => {
    await expect(svc.verify(undefined)).resolves.toBeUndefined();
  });

  it('em produção sem secret responde 503 (fail-closed)', async () => {
    process.env.NODE_ENV = 'production';
    await expect(svc.verify('x')).rejects.toThrow(ServiceUnavailableException);
  });

  it('secret de teste que FALHA SEMPRE → 403 (prova o caminho real)', async () => {
    process.env.TURNSTILE_SECRET_KEY = '2x0000000000000000000000000000000AA';
    await expect(svc.verify('qualquer-token')).rejects.toThrow(ForbiddenException);
  }, 15_000);

  it('secret de teste que PASSA SEMPRE → resolve', async () => {
    process.env.TURNSTILE_SECRET_KEY = '1x0000000000000000000000000000000AA';
    await expect(svc.verify('qualquer-token')).resolves.toBeUndefined();
  }, 15_000);

  it('token já gasto (replay) → 403, não fail-open', async () => {
    process.env.TURNSTILE_SECRET_KEY = '3x0000000000000000000000000000000AA';
    await expect(svc.verify('qualquer-token')).rejects.toThrow(ForbiddenException);
  }, 15_000);
});
