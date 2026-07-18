import proxyaddr from 'proxy-addr';

/**
 * Guarda de regressão do `app.set('trust proxy', ...)` do main.ts.
 *
 * Porquê um unit e não um caso de e2e: o e2e liga-se sempre de 127.0.0.1, que É um proxy
 * de confiança nesta configuração — logo o e2e nunca conseguiria exercitar o caso que
 * interessa (um atacante a ligar-se da internet à porta publicada). Aqui controlamos o peer.
 *
 * Histórico: `trust proxy: 1` (posto "para quando houver Caddy") tornou o req.ip falsificável
 * pela porta direta e derrubou TODOS os limites, login incluído. `false` fecharia isso mas
 * poria todo o tráfego do Caddy num só balde -> 429 em clientes reais. A lista resolve ambos.
 */
const TRUSTED = ['loopback', 'uniquelocal'];
const trust = proxyaddr.compile(TRUSTED);

const req = (peer: string, xff?: string) =>
  ({
    connection: { remoteAddress: peer },
    headers: xff ? { 'x-forwarded-for': xff } : {},
  }) as unknown as Parameters<typeof proxyaddr>[0];

describe('trust proxy', () => {
  it('confia no Caddy (loopback no host e rede docker)', () => {
    expect(trust('127.0.0.1', 0)).toBe(true);
    expect(trust('::1', 0)).toBe(true);
    expect(trust('172.18.0.5', 0)).toBe(true);
  });

  it('NÃO confia em peers públicos — é a porta 8083 publicada', () => {
    expect(trust('1.2.3.4', 0)).toBe(false);
    expect(trust('203.0.113.9', 0)).toBe(false);
    expect(trust('187.124.4.163', 0)).toBe(false);
  });

  it('atacante direto na porta a forjar XFF fica com o IP do socket', () => {
    // Se isto devolvesse 9.9.9.9, um header por pedido = um balde por pedido e o throttle cai.
    expect(proxyaddr(req('1.2.3.4', '9.9.9.9'), trust)).toBe('1.2.3.4');
  });

  it('cliente real pelo Caddy é identificado pelo SEU ip', () => {
    // Se isto devolvesse 127.0.0.1, todos os clientes partilhariam um balde -> 429 injustos.
    expect(proxyaddr(req('127.0.0.1', '88.1.2.3'), trust)).toBe('88.1.2.3');
  });

  it('XFF forjado ATRAVÉS do Caddy é ignorado (o proxy acrescenta o real à direita)', () => {
    expect(proxyaddr(req('127.0.0.1', '9.9.9.9, 203.0.113.50'), trust)).toBe('203.0.113.50');
  });

  it('sem XFF nenhum, o peer manda', () => {
    expect(proxyaddr(req('1.2.3.4'), trust)).toBe('1.2.3.4');
  });
});
