import { listaVencimientos, porAtender, textoDias, diasHasta } from '../js/vencimientos.js';
const W = (n, fin, extra = {}) => ({ nombre: n, curp: 'X', puesto: 'P', fin, ...extra });
const lotes = [
  { id: 'a', status: 'aprobado', tipo: 'DETERMINADO', cliente: 'C', empresa: { nombre: 'E' }, trabajadores: [W('A', '2026-10-08'), W('B', '2026-10-16'), W('C', '2026-10-23'), W('D', '2026-11-20'), W('E', '2026-10-10', { seguimiento: { estado: 'renovado' } }), W('F', '')] },
  { id: 'b', status: 'revision', tipo: 'DETERMINADO', trabajadores: [W('G', '2026-10-12')] },
  { id: 'c', status: 'aprobado', tipo: 'INDETERMINADO', trabajadores: [W('H', '2026-10-12')] },
];
const l = listaVencimientos(lotes, { hoy: '2026-10-11', anticipacion: 15 });
const ok = (c, m) => console.log(c ? 'OK  ' : 'FAIL', m);
ok(l.map((v) => v.nombre).join() === 'A,E,B,C,D', 'orden y filtros: ' + l.map((v) => v.nombre));
ok(l.map((v) => v.nivel).join() === 'vencido,vencido,urgente,proximo,vigente', 'niveles: ' + l.map((v) => v.nivel));
ok(porAtender(l).map((v) => v.nombre).join() === 'A,B,C', 'por atender');
ok(diasHasta('2027-03-14', '2026-11-01') === 133 && diasHasta('2026-11-02', '2026-10-31') === 2, 'diferencia de días con cambio de horario');
ok([0, 1, 5, -1, -3].map(textoDias).join('|') === 'Vence hoy|Vence mañana|En 5 días|Venció ayer|Venció hace 3 días', 'textos');
