import test from 'node:test';
import assert from 'node:assert/strict';
import {localDateKey,selectedMonth,matchesMonth,monthLabel,lastDayOfMonth} from '../period-filter.mjs';

test('Este mes usa el mes de la fecha local',()=>{
  const now=new Date(2026,10,22,23,45);
  assert.equal(localDateKey(now),'2026-11-22');
  const month=selectedMonth('this','',now);
  assert.equal(month,'2026-11');
  assert.deepEqual(['2026-10-31','2026-11-01','2026-11-30','2026-12-01'].filter(d=>matchesMonth(d,month)),['2026-11-01','2026-11-30']);
});
test('Mes anterior cambia de año al consultar desde enero',()=>{
  assert.equal(selectedMonth('last','',new Date(2027,0,31)),'2026-12');
  assert.equal(selectedMonth('last','',new Date(2024,2,31)),'2024-02');
});
test('otros meses incluyen su año y filtran por fecha de miniatura',()=>{
  const month=selectedMonth('custom','2025-11');
  const records=[{fecha:'2025-11-30',fecha_pago:'2026-01-01'},{fecha:'2026-11-22',fecha_pago:'2025-11-01'}];
  assert.deepEqual(records.filter(r=>matchesMonth(r.fecha,month)),[records[0]]);
  assert.equal(monthLabel(month),'noviembre de 2025');
});
test('Todos los meses incluye todo y un mes vacío no muestra registros de otros periodos',()=>{
  assert.equal(matchesMonth('2026-01-01',selectedMonth('all')),true);
  assert.equal(matchesMonth('2026-11-22',selectedMonth('custom','')),false);
  assert.equal(matchesMonth('2026-11-22',selectedMonth('custom','2026-13')),false);
});

test('fecha de pago sugerida es el último día del mes, incluidos febrero y diciembre',()=>{
 assert.equal(lastDayOfMonth(new Date(2026,10,22)),'2026-11-30');
 assert.equal(lastDayOfMonth(new Date(2024,1,2)),'2024-02-29');
 assert.equal(lastDayOfMonth(new Date(2025,1,28)),'2025-02-28');
 assert.equal(lastDayOfMonth(new Date(2026,11,31)),'2026-12-31');
});
