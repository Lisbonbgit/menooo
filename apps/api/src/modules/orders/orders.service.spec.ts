import { Logger } from '@nestjs/common';
import { OrderStatus, OrderType } from '@prisma/client';
import { OrdersService } from './orders.service';

type AnyFn = jest.Mock;

function make() {
  const base = {
    id: 'o1',
    tenantId: 't1',
    number: 42,
    type: OrderType.PICKUP,
    status: OrderStatus.PENDING,
    customerName: 'Ana',
    customerEmail: 'ana@x.pt',
    total: 17,
    items: [{ name: 'Margherita', quantity: 2, total: 17, modifiers: [] }],
  };
  const prisma = {
    order: {
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    tenant: {
      findUnique: jest.fn().mockResolvedValue({
        name: 'Pizzaria Demo',
        slug: 'pizzaria-demo',
        phone: '912345678',
        address: 'Rua das Flores 1',
        city: 'Lisboa',
      }),
    },
  };
  const gateway = { emitOrderUpdated: jest.fn() };
  const promotions = {};
  const mail = {
    sendOrderAccepted: jest.fn().mockResolvedValue(undefined),
    sendOrderReady: jest.fn().mockResolvedValue(undefined),
    sendOrderCompleted: jest.fn().mockResolvedValue(undefined),
    sendOrderCancelled: jest.fn().mockResolvedValue(undefined),
  };
  const svc = new OrdersService(prisma as any, gateway as any, promotions as any, mail as any);
  return { svc, prisma, gateway, mail, base };
}

// Deixa correr o microtask do fire-and-forget antes de afirmar.
const flush = () => new Promise((r) => setImmediate(r));

describe('OrdersService.updateStatus — emails por transição', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('PENDING→ACCEPTED envia sendOrderAccepted com o nº e o email do cliente', async () => {
    const { svc, prisma, mail, base } = make();
    prisma.order.findFirst
      .mockResolvedValueOnce({ ...base, status: OrderStatus.PENDING }) // leitura-guarda
      .mockResolvedValue({ ...base, status: OrderStatus.ACCEPTED }); // getForTenant
    await svc.updateStatus('t1', 'o1', OrderStatus.ACCEPTED);
    await flush();
    expect(mail.sendOrderAccepted).toHaveBeenCalledTimes(1);
    expect(mail.sendOrderAccepted).toHaveBeenCalledWith(
      'ana@x.pt',
      'Ana',
      expect.objectContaining({ number: 42, type: OrderType.PICKUP }),
    );
  });

  it('ACCEPTED→PREPARING não envia email nenhum', async () => {
    const { svc, prisma, mail, base } = make();
    prisma.order.findFirst
      .mockResolvedValueOnce({ ...base, status: OrderStatus.ACCEPTED })
      .mockResolvedValue({ ...base, status: OrderStatus.PREPARING });
    await svc.updateStatus('t1', 'o1', OrderStatus.PREPARING);
    await flush();
    expect(mail.sendOrderAccepted).not.toHaveBeenCalled();
    expect(mail.sendOrderReady).not.toHaveBeenCalled();
    expect(mail.sendOrderCompleted).not.toHaveBeenCalled();
    expect(mail.sendOrderCancelled).not.toHaveBeenCalled();
  });

  it('READY→COMPLETED envia sendOrderCompleted', async () => {
    const { svc, prisma, mail, base } = make();
    prisma.order.findFirst
      .mockResolvedValueOnce({ ...base, status: OrderStatus.READY })
      .mockResolvedValue({ ...base, status: OrderStatus.COMPLETED });
    await svc.updateStatus('t1', 'o1', OrderStatus.COMPLETED);
    await flush();
    expect(mail.sendOrderCompleted).toHaveBeenCalledTimes(1);
  });

  it('PENDING→REJECTED envia sendOrderCancelled', async () => {
    const { svc, prisma, mail, base } = make();
    prisma.order.findFirst
      .mockResolvedValueOnce({ ...base, status: OrderStatus.PENDING })
      .mockResolvedValue({ ...base, status: OrderStatus.REJECTED });
    await svc.updateStatus('t1', 'o1', OrderStatus.REJECTED);
    await flush();
    expect(mail.sendOrderCancelled).toHaveBeenCalledTimes(1);
  });

  it('sem customerEmail → não envia (encomenda manual/telefone)', async () => {
    const { svc, prisma, mail, base } = make();
    const semEmail = { ...base, customerEmail: null };
    prisma.order.findFirst
      .mockResolvedValueOnce({ ...semEmail, status: OrderStatus.PENDING })
      .mockResolvedValue({ ...semEmail, status: OrderStatus.ACCEPTED });
    await svc.updateStatus('t1', 'o1', OrderStatus.ACCEPTED);
    await flush();
    expect(mail.sendOrderAccepted).not.toHaveBeenCalled();
  });

  it('fire-and-forget: um erro no email NÃO parte o updateStatus', async () => {
    const { svc, prisma, mail, base } = make();
    mail.sendOrderAccepted.mockRejectedValue(new Error('SMTP em baixo'));
    prisma.order.findFirst
      .mockResolvedValueOnce({ ...base, status: OrderStatus.PENDING })
      .mockResolvedValue({ ...base, status: OrderStatus.ACCEPTED });
    const res = await svc.updateStatus('t1', 'o1', OrderStatus.ACCEPTED);
    await flush();
    expect(res).toEqual(expect.objectContaining({ status: OrderStatus.ACCEPTED }));
  });

  it('READY leva o type no info (para o texto diferir PICKUP/DELIVERY)', async () => {
    const { svc, prisma, mail, base } = make();
    const delivery = { ...base, type: OrderType.DELIVERY };
    prisma.order.findFirst
      .mockResolvedValueOnce({ ...delivery, status: OrderStatus.PREPARING })
      .mockResolvedValue({ ...delivery, status: OrderStatus.READY });
    await svc.updateStatus('t1', 'o1', OrderStatus.READY);
    await flush();
    expect(mail.sendOrderReady).toHaveBeenCalledWith(
      'ana@x.pt',
      'Ana',
      expect.objectContaining({ type: OrderType.DELIVERY }),
    );
  });
});
