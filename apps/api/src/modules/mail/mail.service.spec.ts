import { Logger } from '@nestjs/common';
import { MailService, type ReservationMailInfo } from './mail.service';

const DIA_MS = 86_400_000;

const info: ReservationMailInfo = {
  restaurantName: 'Pizzaria Demo',
  code: 'ABC123',
  dateText: '20 de julho de 2026',
  timeText: '20:00',
  partySize: 2,
  tableNames: ['3'],
};

describe('MailService — teto por destinatário', () => {
  let svc: MailService;
  let sendMail: jest.SpyInstance;

  beforeEach(() => {
    // jsonTransport do nodemailer: não sai nada para a rede.
    process.env.SMTP_HOST = 'json';
    // silenciar o Logger para o output dos testes ficar legível
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    svc = new MailService();
    sendMail = jest
      .spyOn((svc as unknown as { transporter: { sendMail: () => Promise<unknown> } }).transporter, 'sendMail')
      .mockResolvedValue({});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    delete process.env.SMTP_HOST;
  });

  it('o 6.º email de reserva para o MESMO destinatário em 24h é descartado', async () => {
    for (let i = 0; i < 6; i++) {
      await svc.sendReservationConfirmed('ana@x.pt', 'Ana', info);
    }
    // 5 passam, o 6.º cai
    expect(sendMail).toHaveBeenCalledTimes(5);
  });

  // O teto existe para proteger TERCEIROS de bombing (o atacante escolhe o email do cliente).
  // Os alertas vão para o restaurante, num endereço FIXO por tenant: aplicar-lhes o teto dava
  // ao atacante um interruptor para desligar o único canal do dono — 5 reservas e ele deixava
  // de saber que tem reservas. Um restaurante com procura normal passa dos 5/dia sozinho.
  it('os alertas para o RESTAURANTE nunca são limitados (senão 5 reservas silenciam o dono)', async () => {
    const alerta = { ...info, customerName: 'Ana', customerPhone: '911111111' };
    for (let i = 0; i < 12; i++) {
      await svc.sendNewReservationAlert('reservas@restaurante.pt', alerta);
    }
    expect(sendMail).toHaveBeenCalledTimes(12);
  });

  it('os alertas de cancelamento ao RESTAURANTE também não são limitados', async () => {
    for (let i = 0; i < 12; i++) {
      await svc.sendReservationCancelledAlert('reservas@restaurante.pt', { ...info, customerName: 'Ana' });
    }
    expect(sendMail).toHaveBeenCalledTimes(12);
  });

  it('o teto do cliente NÃO é gasto pelos alertas do restaurante (baldes independentes)', async () => {
    const mesmo = 'dono@restaurante.pt'; // o dono também reservou como cliente
    for (let i = 0; i < 5; i++) {
      await svc.sendNewReservationAlert(mesmo, { ...info, customerName: 'X', customerPhone: '9' });
    }
    sendMail.mockClear();
    await svc.sendReservationConfirmed(mesmo, 'Dono', info);
    expect(sendMail).toHaveBeenCalledTimes(1); // os 5 alertas não gastaram o balde dele
  });

  it('um destinatário DIFERENTE passa mesmo com o primeiro no teto', async () => {
    for (let i = 0; i < 6; i++) {
      await svc.sendReservationConfirmed('ana@x.pt', 'Ana', info);
    }
    expect(sendMail).toHaveBeenCalledTimes(5);

    await svc.sendReservationConfirmed('bruno@x.pt', 'Bruno', info);
    expect(sendMail).toHaveBeenCalledTimes(6);
    expect(sendMail).toHaveBeenLastCalledWith(expect.objectContaining({ to: 'bruno@x.pt' }));
  });

  it('o teto é por caixa NORMALIZADA (trim + lowercase), não por string crua', async () => {
    await svc.sendReservationConfirmed('ana@x.pt', 'Ana', info);
    await svc.sendReservationConfirmed(' Ana@X.pt ', 'Ana', info);
    await svc.sendReservationConfirmed('ANA@X.PT', 'Ana', info);
    await svc.sendReservationConfirmed('ana@x.pt ', 'Ana', info);
    await svc.sendReservationConfirmed(' ana@x.pt', 'Ana', info);
    expect(sendMail).toHaveBeenCalledTimes(5);

    // 6.ª variante da MESMA caixa → descartada
    await svc.sendReservationConfirmed('Ana@x.PT', 'Ana', info);
    expect(sendMail).toHaveBeenCalledTimes(5);
  });

  // Os DOIS emails ao CLIENTE partilham o balde (o atacante escolhe o endereço e podia
  // alternar entre confirmação e cancelamento para dobrar o volume). Os alertas ao
  // restaurante estão fora — ver os testes acima.
  it('confirmação e cancelamento AO CLIENTE partilham o mesmo balde', async () => {
    await svc.sendReservationConfirmed('ana@x.pt', 'Ana', info);
    await svc.sendReservationCancelled('ana@x.pt', 'Ana', info, false);
    await svc.sendReservationConfirmed('ana@x.pt', 'Ana', info);
    await svc.sendReservationCancelled('ana@x.pt', 'Ana', info, false);
    await svc.sendReservationConfirmed('ana@x.pt', 'Ana', info);
    expect(sendMail).toHaveBeenCalledTimes(5);

    // o 6.º cai, seja qual for dos dois — o ciclo create→cancel não dá emails de graça
    await svc.sendReservationCancelled('ana@x.pt', 'Ana', info, false);
    expect(sendMail).toHaveBeenCalledTimes(5);
  });

  it('a janela DESLIZA: passadas 24h o destinatário volta a poder receber', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-17T10:00:00Z'));

    for (let i = 0; i < 6; i++) {
      await svc.sendReservationConfirmed('ana@x.pt', 'Ana', info);
    }
    expect(sendMail).toHaveBeenCalledTimes(5);

    // ainda dentro das 24h → continua a cair
    jest.setSystemTime(new Date(Date.now() + DIA_MS - 60_000));
    await svc.sendReservationConfirmed('ana@x.pt', 'Ana', info);
    expect(sendMail).toHaveBeenCalledTimes(5);

    // passadas as 24h dos primeiros → volta a passar
    jest.setSystemTime(new Date(Date.now() + 2 * 60_000));
    await svc.sendReservationConfirmed('ana@x.pt', 'Ana', info);
    expect(sendMail).toHaveBeenCalledTimes(6);
  });

  it('CRÍTICO: emails de CONTA nunca são silenciados pelo teto de reservas', async () => {
    // esgotar o balde de reservas deste destinatário
    for (let i = 0; i < 6; i++) {
      await svc.sendReservationConfirmed('ana@x.pt', 'Ana', info);
    }
    expect(sendMail).toHaveBeenCalledTimes(5);

    // verificação de email e reposição de password TÊM de sair na mesma
    await svc.sendVerificationCode('ana@x.pt', 'Ana', '123456');
    await svc.sendPasswordReset('ana@x.pt', 'Ana', '654321');
    await svc.sendVerificationCode('ana@x.pt', 'Ana', '111111');
    await svc.sendPasswordReset('ana@x.pt', 'Ana', '222222');
    expect(sendMail).toHaveBeenCalledTimes(9);
  });

  it('o send() genérico não consome o balde das reservas', async () => {
    // 10 envios genéricos não podem gastar o teto
    for (let i = 0; i < 10; i++) {
      await svc.send('ana@x.pt', 'assunto', '<p>corpo</p>');
    }
    expect(sendMail).toHaveBeenCalledTimes(10);

    // as 5 de reserva continuam disponíveis
    for (let i = 0; i < 6; i++) {
      await svc.sendReservationConfirmed('ana@x.pt', 'Ana', info);
    }
    expect(sendMail).toHaveBeenCalledTimes(15);
  });
});
