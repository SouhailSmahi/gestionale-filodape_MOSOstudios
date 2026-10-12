/**
 * Bozze dei moduli salvate sul dispositivo: se la rete cade o la pagina si chiude,
 * quanto scritto non va perso. Si cancellano dopo il salvataggio riuscito.
 */
const pref = 'filodape-bozza-';
export function leggiBozza<T>(k: string): T | null {
  try { const s = localStorage.getItem(pref + k); return s ? (JSON.parse(s) as T) : null; } catch { return null; }
}
export function salvaBozza(k: string, v: unknown) {
  try { localStorage.setItem(pref + k, JSON.stringify(v)); } catch { /* spazio pieno o modalità privata: pazienza */ }
}
export function cancellaBozza(k: string) {
  try { localStorage.removeItem(pref + k); } catch { /* niente */ }
}
