import { ForbiddenException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const REJECT = 'Não foi possível validar o pedido. Tenta de novo.';

interface SiteverifyResponse {
  success?: boolean;
  action?: string;
  hostname?: string;
  'error-codes'?: string[];
}

@Injectable()
export class TurnstileService {
  private readonly logger = new Logger(TurnstileService.name);
  private consecutiveFailures = 0;
  private inFlight = 0;

  private get secret(): string {
    return process.env.TURNSTILE_SECRET_KEY ?? '';
  }

  /** Em produção sem secret o endpoint público NÃO abre (a menos de escape explícito). */
  isEnforced(): boolean {
    return this.secret !== '';
  }

  isMisconfigured(): boolean {
    return (
      process.env.NODE_ENV === 'production' && !this.isEnforced() && process.env.TURNSTILE_OPTIONAL !== '1'
    );
  }

  stats() {
    return { enforced: this.isEnforced(), consecutiveFailures: this.consecutiveFailures };
  }

  async verify(token: string | undefined, remoteIp?: string): Promise<void> {
    // Fail-closed: prod sem chaves não serve reservas em silêncio (spec §5).
    if (this.isMisconfigured()) {
      throw new ServiceUnavailableException('Reservas online temporariamente indisponíveis.');
    }
    if (!this.isEnforced()) return; // local/dev/e2e

    if (!token) throw new ForbiddenException(REJECT);

    // Teto de concorrência: a nossa própria saturação não pode disparar o fail-open.
    if (this.inFlight >= 20) throw new ForbiddenException(REJECT);

    let data: SiteverifyResponse;
    this.inFlight++;
    try {
      const body = new URLSearchParams({ secret: this.secret, response: token });
      if (remoteIp) body.set('remoteip', remoteIp);
      const res = await fetch(VERIFY_URL, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(5_000),
      });
      // A partir daqui HÁ resposta: qualquer falha é 403, nunca fail-open (spec §5).
      // Resposta não-2xx => 403.
      if (!res.ok) throw new ForbiddenException(REJECT);
      try {
        data = (await res.json()) as SiteverifyResponse;
      } catch {
        // Corpo não-JSON ou truncado (5xx com HTML, corte a meio) => 403, NUNCA open (spec §5).
        this.logger.warn('turnstile_rejected: resposta não-JSON');
        throw new ForbiddenException(REJECT);
      }
    } catch (e) {
      if (e instanceof ForbiddenException) throw e;
      // SÓ rede/timeout chega aqui (nunca chegámos a ter resposta) => fail-open deliberado.
      this.consecutiveFailures++;
      this.logger.error(
        `turnstile_unreachable (${this.consecutiveFailures}x consecutivas): ${(e as Error)?.message}`,
      );
      return;
    } finally {
      this.inFlight--;
    }

    this.consecutiveFailures = 0;

    // `timeout-or-duplicate` (replay) e `invalid-input-response` caem aqui — 403, nunca open.
    // É a Cloudflare que garante uso único do token; não precisamos de store de idempotência.
    if (data.success !== true) {
      this.logger.warn(`turnstile_rejected: ${(data['error-codes'] ?? []).join(',')}`);
      throw new ForbiddenException(REJECT);
    }
    const expectedAction = 'reserva';
    if (data.action && data.action !== expectedAction) {
      this.logger.warn(`turnstile_rejected: action=${data.action}`);
      throw new ForbiddenException(REJECT);
    }
    const allowed = (process.env.TURNSTILE_HOSTNAMES ?? '').split(',').map((h) => h.trim()).filter(Boolean);
    if (allowed.length > 0 && data.hostname && !allowed.includes(data.hostname)) {
      this.logger.warn(`turnstile_rejected: hostname=${data.hostname}`);
      throw new ForbiddenException(REJECT);
    }
  }
}
