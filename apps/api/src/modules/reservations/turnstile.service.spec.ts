import { ForbiddenException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { TurnstileService } from './turnstile.service';

/**
 * Dois tipos de teste, de propósito:
 *
 * - Contra a Cloudflare A SÉRIO (secrets de teste públicos): provam que o 403 e o replay
 *   funcionam contra a resposta real. A 1.ª versão do spec dizia que isto era "não testável em
 *   e2e" e por isso só cobria o no-op — ou seja, o único caminho coberto era aquele em que a
 *   proteção não existe.
 * - Com `fetch` mockado: para o que os secrets de teste NÃO conseguem exercitar. Verificado
 *   contra a API real (2026-07-17): o secret `1x...` devolve
 *   `{success:true, hostname:'example.com'}` — SEM `action`. Logo o caminho feliz completo e o
 *   binding só se testam com mock. O mock é também o único sítio onde se distingue um
 *   `success:true` genuíno de um fail-open: sem ele, ambos resolvem e o teste não prova nada.
 */
const PASSA = '1x0000000000000000000000000000000AA';
const FALHA = '2x0000000000000000000000000000000AA';
const GASTO = '3x0000000000000000000000000000000AA';

const mockFetch = (body: unknown, ok = true) =>
  jest.spyOn(global, 'fetch').mockResolvedValue({ ok, json: async () => body } as Response);

describe('TurnstileService', () => {
  let svc: TurnstileService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    svc = new TurnstileService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.TURNSTILE_SECRET_KEY;
    delete process.env.TURNSTILE_OPTIONAL;
    delete process.env.TURNSTILE_HOSTNAMES;
    delete process.env.NODE_ENV;
  });

  describe('configuração', () => {
    it('sem secret é no-op (dev/e2e correm sem chaves)', async () => {
      await expect(svc.verify('seja-o-que-for')).resolves.toBeUndefined();
    });

    it('em produção sem secret responde 503 — fail-closed, não no-op silencioso', async () => {
      process.env.NODE_ENV = 'production';
      await expect(svc.verify('x')).rejects.toThrow(ServiceUnavailableException);
    });

    it('em produção sem secret mas com TURNSTILE_OPTIONAL=1 deixa passar (escape explícito)', async () => {
      process.env.NODE_ENV = 'production';
      process.env.TURNSTILE_OPTIONAL = '1';
      await expect(svc.verify('x')).resolves.toBeUndefined();
    });

    it('com secret, pedido SEM token é 403 e nem contacta a Cloudflare', async () => {
      process.env.TURNSTILE_SECRET_KEY = PASSA;
      const f = jest.spyOn(global, 'fetch');
      await expect(svc.verify(undefined)).rejects.toThrow(ForbiddenException);
      expect(f).not.toHaveBeenCalled();
    });
  });

  // Estes chamam a Cloudflare. Sem rede FALHAM, em vez de passarem em silêncio — é o ponto:
  // um it.skip escondido devolvia-nos ao mundo em que só o no-op está coberto.
  describe('contra a Cloudflare real (secrets de teste públicos)', () => {
    it('secret que FALHA SEMPRE → 403 (caminho de rejeição real)', async () => {
      process.env.TURNSTILE_SECRET_KEY = FALHA;
      await expect(svc.verify('token-qualquer')).rejects.toThrow(ForbiddenException);
    }, 15_000);

    it('token JÁ GASTO (replay) → 403, e NÃO fail-open', async () => {
      // `timeout-or-duplicate` é como a Cloudflare sinaliza reutilização: é ela que garante o
      // uso único do token, logo não precisamos de store de idempotência nossa — mas só se este
      // ramo der 403 em vez de cair no fail-open.
      process.env.TURNSTILE_SECRET_KEY = GASTO;
      await expect(svc.verify('token-qualquer')).rejects.toThrow(ForbiddenException);
    }, 15_000);

    it('secret que PASSA SEMPRE → 403 na mesma, porque a resposta não traz `action`', async () => {
      // Não é falha do teste: o token do secret de teste não foi cunhado por um widget nosso,
      // logo não tem action — e o servidor exige-a. Este teste documenta esse facto.
      process.env.TURNSTILE_SECRET_KEY = PASSA;
      await expect(svc.verify('token-qualquer')).rejects.toThrow(ForbiddenException);
    }, 15_000);
  });

  describe('fronteira do fail-open (a peça que decide se a proteção existe)', () => {
    beforeEach(() => {
      process.env.TURNSTILE_SECRET_KEY = PASSA;
    });

    it('rede em baixo (fetch rejeita) → DEIXA PASSAR (um restaurante não perde reservas)', async () => {
      jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(svc.verify('t')).resolves.toBeUndefined();
    });

    it('timeout → DEIXA PASSAR', async () => {
      jest
        .spyOn(global, 'fetch')
        .mockRejectedValue(Object.assign(new Error('timeout'), { name: 'TimeoutError' }));
      await expect(svc.verify('t')).resolves.toBeUndefined();
    });

    it('resposta 5xx → 403, NUNCA fail-open', async () => {
      mockFetch('<html>oops</html>', false);
      await expect(svc.verify('t')).rejects.toThrow(ForbiddenException);
    });

    it('corpo não-JSON → 403, NUNCA fail-open', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => {
          throw new SyntaxError('Unexpected token <');
        },
      } as unknown as Response);
      await expect(svc.verify('t')).rejects.toThrow(ForbiddenException);
    });

    it('success:false → 403 (não cai no ramo aberto)', async () => {
      mockFetch({ success: false, 'error-codes': ['invalid-input-response'] });
      await expect(svc.verify('t')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('binding (só testável com mock — ver o cabeçalho)', () => {
    beforeEach(() => {
      process.env.TURNSTILE_SECRET_KEY = PASSA;
    });

    it('success:true + action correta → resolve (o caminho feliz completo)', async () => {
      mockFetch({ success: true, action: 'reserva', hostname: 'menooo.com' });
      await expect(svc.verify('t')).resolves.toBeUndefined();
    });

    it('token de OUTRO fluxo (action diferente) → 403', async () => {
      // O furo que isto fecha: no dia em que a mesma sitekey servir o registo ou o contacto,
      // um token cunhado lá autorizaria um POST de reserva.
      mockFetch({ success: true, action: 'registo', hostname: 'menooo.com' });
      await expect(svc.verify('t')).rejects.toThrow(ForbiddenException);
    });

    it('action AUSENTE → 403 (o binding não pode ser opcional)', async () => {
      mockFetch({ success: true, hostname: 'menooo.com' });
      await expect(svc.verify('t')).rejects.toThrow(ForbiddenException);
    });

    it('hostname fora da lista → 403 quando TURNSTILE_HOSTNAMES está definida', async () => {
      process.env.TURNSTILE_HOSTNAMES = 'menooo.com, www.menooo.com';
      mockFetch({ success: true, action: 'reserva', hostname: 'evil.pages.dev' });
      await expect(svc.verify('t')).rejects.toThrow(ForbiddenException);
    });

    it('hostname na lista → resolve', async () => {
      process.env.TURNSTILE_HOSTNAMES = 'menooo.com, www.menooo.com';
      mockFetch({ success: true, action: 'reserva', hostname: 'www.menooo.com' });
      await expect(svc.verify('t')).resolves.toBeUndefined();
    });

    it('sem TURNSTILE_HOSTNAMES o hostname não é exigido (nada com que comparar)', async () => {
      mockFetch({ success: true, action: 'reserva', hostname: 'o-que-for.com' });
      await expect(svc.verify('t')).resolves.toBeUndefined();
    });
  });

  describe('teto de concorrência', () => {
    it('acima do teto responde 403 em vez de abrir a porta', async () => {
      process.env.TURNSTILE_SECRET_KEY = PASSA;
      // A nossa própria saturação não pode virar fail-open: sob flood os siteverify começariam a
      // expirar e cada timeout deixava passar — a proteção enfraquecia sob a carga que existe
      // para travar.
      (svc as unknown as { inFlight: number }).inFlight = 20;
      await expect(svc.verify('t')).rejects.toThrow(ForbiddenException);
    });
  });
});
