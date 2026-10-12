/** Formattazione italiana di importi, quantità e date. */

const eurFmt = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
const eur0Fmt = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

/** Importo in euro; null = prezzo non ancora deciso ("prezzo X"). */
export const eur = (v: number | null | undefined): string =>
  v == null || Number.isNaN(v) ? 'prezzo X' : eurFmt.format(v);
export const eur0 = (v: number): string => eur0Fmt.format(v);
/** Costi unitari piccoli: 4 decimali se sotto 1 €. */
export const eurCost = (v: number | null | undefined): string =>
  v == null ? '—' : new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: Math.abs(v) < 1 ? 3 : 2 }).format(v);

export const num = (v: number | null | undefined, d = 1): string =>
  v == null ? '—' : new Intl.NumberFormat('it-IT', { maximumFractionDigits: d }).format(Math.round(v * 10 ** d) / 10 ** d);

export const kg = (v: number | null | undefined, d = 1): string => `${num(v ?? 0, d)} kg`;

/** Quantità di un articolo nella sua unità, con le confezioni se utili: "22 kg (1,5 × cartone da 15 kg)". */
export function qtyArticolo(q: number, unita: string, confezioni?: { nome: string; quantita: number }[] | null): string {
  const base = `${num(q, unita === 'pz' ? 0 : 2)} ${unita}`;
  const c = (confezioni || []).filter((x) => x.quantita > 1 && q >= x.quantita).sort((a, b) => b.quantita - a.quantita)[0];
  return c ? `${base} (${num(q / c.quantita, 1)} × ${c.nome} da ${num(c.quantita, 2)} ${unita})` : base;
}

const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
export const meseBreve = (m: number) => MESI[m];

const toDate = (d: string | Date) => (d instanceof Date ? d : new Date(d.length === 10 ? d + 'T12:00:00' : d));

/** 26/06/26 */
export const fd = (d: string | Date | null | undefined): string =>
  d ? toDate(d).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—';
/** lunedì 12 ottobre */
export const fdl = (d: string | Date): string =>
  toDate(d).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
/** 26/06/26 alle 14:30 */
export const fdt = (d: string | Date): string =>
  `${fd(d)} alle ${toDate(d).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;

/** 6 h 30 min */
export function durata(min: number | null | undefined): string {
  const m = Math.round(min || 0);
  if (!m) return '0 min';
  const h = Math.floor(m / 60), r = m % 60;
  return h ? (r ? `${h} h ${r} min` : `${h} h`) : `${r} min`;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** Data locale in formato yyyy-mm-dd (per <input type=date>). */
export const isoDate = (d: Date = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** Data e ora locali per <input type=datetime-local>. */
export const isoLocal = (d: Date = new Date()) => `${isoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
/** Da <input type=datetime-local> a ISO con fuso dell'utente. */
export const fromLocal = (s: string) => new Date(s).toISOString();

/** Numero scritto dall'utente: accetta la virgola. null se vuoto o non valido. */
export function parseNum(v: unknown): number | null {
  const s = String(v ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (!s) return null;
  const x = Number(s);
  return Number.isFinite(x) ? x : null;
}

export const plural = (n: number, uno: string, molti: string) => `${num(n, 0)} ${n === 1 ? uno : molti}`;

/** Prima lettera maiuscola di ogni parola (nomi di clienti scritti in fretta). */
export const capitalizza = (s: string) =>
  s.trim().replace(/\s+/g, ' ').split(' ').map((p) => (p ? p[0].toLocaleUpperCase('it-IT') + p.slice(1) : p)).join(' ');
