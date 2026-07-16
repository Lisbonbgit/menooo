import { assignTables } from './assign.util';

const T = (id: string, seats: number, o: Partial<{ area: string | null; joinable: boolean; bookableOnline: boolean; sortOrder: number }> = {}) => ({
  id,
  seats,
  area: 'area' in o ? (o.area as string | null) : 'Sala',
  joinable: o.joinable ?? false,
  bookableOnline: o.bookableOnline ?? true,
  sortOrder: o.sortOrder ?? 0,
});

describe('assignTables', () => {
  it('best-fit: escolhe a menor mesa que serve', () => {
    expect(assignTables([T('m8', 8), T('m4', 4), T('m2', 2)], new Set(), 4, 'ONLINE')).toEqual(['m4']);
  });
  it('empate de lugares → menor sortOrder', () => {
    expect(assignTables([T('b', 4, { sortOrder: 2 }), T('a', 4, { sortOrder: 1 })], new Set(), 4, 'ONLINE')).toEqual(['a']);
  });
  it('ocupadas ficam de fora', () => {
    expect(assignTables([T('m4', 4)], new Set(['m4']), 2, 'ONLINE')).toBeNull();
  });
  it('DOCUMENTADO (single-primeiro): grupo de 4 leva a mesa de 8 mesmo havendo par 2+2', () => {
    const ts = [T('m8', 8), T('a2', 2, { joinable: true }), T('b2', 2, { joinable: true })];
    expect(assignTables(ts, new Set(), 4, 'ONLINE')).toEqual(['m8']);
  });
  it('par juntável quando nenhuma única serve; desperdício mínimo', () => {
    const ts = [T('a4', 4, { joinable: true }), T('b4', 4, { joinable: true }), T('c6', 6, { joinable: true })];
    expect(assignTables(ts, new Set(), 8, 'ONLINE')!.sort()).toEqual(['a4', 'b4']);
  });
  it('não junta áreas diferentes nem area null', () => {
    const ts = [T('a', 4, { joinable: true, area: 'Sala' }), T('b', 4, { joinable: true, area: 'Esplanada' }), T('c', 4, { joinable: true, area: null })];
    expect(assignTables(ts, new Set(), 8, 'ONLINE')).toBeNull();
  });
  it('ONLINE ignora bookableOnline=false; MANUAL vê-a', () => {
    const ts = [T('vip', 6, { bookableOnline: false })];
    expect(assignTables(ts, new Set(), 4, 'ONLINE')).toBeNull();
    expect(assignTables(ts, new Set(), 4, 'MANUAL')).toEqual(['vip']);
  });
  it('grupo maior que tudo → null', () => {
    expect(assignTables([T('m4', 4, { joinable: true }), T('m6', 6, { joinable: true })], new Set(), 20, 'ONLINE')).toBeNull();
  });
});
