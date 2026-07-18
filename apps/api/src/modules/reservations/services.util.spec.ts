import { isSynthetic, servicesOfWeekday, windowsOf, ServiceLike } from './services.util';

let seq = 0;
const svc = (p: Partial<ServiceLike>): ServiceLike => ({
  id: `s${++seq}`,
  name: 'Serviço',
  weekdays: [1],
  openMinute: 720,
  closeMinute: 870,
  sortOrder: 0,
  ...p,
});

describe('servicesOfWeekday', () => {
  it('filtra pelo weekday e ordena por sortOrder', () => {
    const a = svc({ weekdays: [1, 2], sortOrder: 2, openMinute: 1140, closeMinute: 1320 });
    const b = svc({ weekdays: [1], sortOrder: 1 });
    expect(servicesOfWeekday([a, b], 1).map((s) => s.id)).toEqual([b.id, a.id]);
    expect(servicesOfWeekday([a, b], 2).map((s) => s.id)).toEqual([a.id]);
  });
  it('empate no sortOrder desempata pela hora de abertura', () => {
    const tarde = svc({ sortOrder: 0, openMinute: 1140, closeMinute: 1320 });
    const cedo = svc({ sortOrder: 0, openMinute: 720, closeMinute: 870 });
    expect(servicesOfWeekday([tarde, cedo], 1).map((s) => s.id)).toEqual([cedo.id, tarde.id]);
  });
});

describe('windowsOf', () => {
  it('com serviços do dia devolve-os, ordenados', () => {
    const s = [
      svc({ weekdays: [1], openMinute: 1140, closeMinute: 1320, sortOrder: 2 }),
      svc({ weekdays: [1], openMinute: 720, closeMinute: 870, sortOrder: 1 }),
    ];
    expect(windowsOf(s, [], 1)).toEqual([
      { openMinute: 720, closeMinute: 870 },
      { openMinute: 1140, closeMinute: 1320 },
    ]);
  });

  it('sem serviços cai no OpeningHour−60 — o fallback MANTÉM-SE', () => {
    expect(windowsOf([], [{ weekday: 1, openMinute: 720, closeMinute: 1380 }], 1)).toEqual([
      { openMinute: 720, closeMinute: 1320 },
    ]);
  });

  it('sem serviços e sem horário devolve vazio', () => {
    expect(windowsOf([], [], 1)).toEqual([]);
  });

  it('serviço de OUTRO weekday não conta', () => {
    expect(windowsOf([svc({ weekdays: [2], openMinute: 720, closeMinute: 870 })], [], 1)).toEqual([]);
  });

  it('havendo serviços no dia, o horário de abertura é IGNORADO (não se somam)', () => {
    // A precedência do windowsFor antigo: as janelas próprias substituem o fallback, não o completam.
    expect(
      windowsOf([svc({ weekdays: [1], openMinute: 720, closeMinute: 870 })], [{ weekday: 1, openMinute: 600, closeMinute: 1380 }], 1),
    ).toEqual([{ openMinute: 720, closeMinute: 870 }]);
  });

  it('um serviço em vários weekdays serve todos', () => {
    const s = [svc({ weekdays: [1, 3, 5], openMinute: 720, closeMinute: 870 })];
    for (const wd of [1, 3, 5]) expect(windowsOf(s, [], wd)).toEqual([{ openMinute: 720, closeMinute: 870 }]);
    expect(windowsOf(s, [], 2)).toEqual([]);
  });
});

describe('isSynthetic', () => {
  it('sem serviços no weekday → sintético (o dia corre pelo horário de abertura)', () => {
    expect(isSynthetic([], 1)).toBe(true);
    expect(isSynthetic([svc({ weekdays: [2] })], 1)).toBe(true);
  });
  it('com serviços no weekday → não sintético', () => {
    expect(isSynthetic([svc({ weekdays: [1] })], 1)).toBe(false);
  });
});
