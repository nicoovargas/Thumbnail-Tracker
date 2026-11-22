// Use the calendar date on the person's device, without converting to UTC.
export function localDateKey(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
export function selectedMonth(period, customMonth = '', now = new Date()) {
  if (period === 'this') return localDateKey(now).slice(0, 7);
  if (period === 'last') return localDateKey(new Date(now.getFullYear(), now.getMonth() - 1, 1)).slice(0, 7);
  if (period === 'custom') return /^\d{4}-(0[1-9]|1[0-2])$/.test(customMonth) ? customMonth : 'invalid';
  return null;
}
export function matchesMonth(date, month) {
  // Thumbnail dates are YYYY-MM-DD, independent of when their payments arrive.
  return month === null || (typeof date === 'string' && date.slice(0, 7) === month);
}
export function monthLabel(month) {
  if (month === null) return 'Todos los meses';
  if (month === 'invalid') return 'Elige un mes';
  const [year, number] = month.split('-').map(Number);
  return new Date(year, number - 1, 1).toLocaleDateString('es-MX', {month:'long',year:'numeric'});
}
