/** Catalogo dei prodotti in vendita, letto una volta e riusato in tutte le schermate. */
import * as api from './api';
import type { Disponibilita } from './types';

let cache: Disponibilita[] | null = null;
let quando = 0;

/** Nome breve di un prodotto: "Miele di Acacia" + "500g" → "Acacia 500g". */
export function nomeBreve(prodotto: string, formato: string | null): string {
  const p = prodotto.replace(/^Miele (di |d')?/i, '');
  return formato ? `${p} ${formato}` : p;
}

/** Varianti attive con giacenza e prezzo (ricaricate se più vecchie di 30 secondi o su richiesta). */
export async function catalogo(forza = false): Promise<Disponibilita[]> {
  if (!cache || forza || Date.now() - quando > 30_000) { cache = (await api.disponibilita()).sort(ordina); quando = Date.now(); }
  return cache;
}
export function invalidaCatalogo() { cache = null; }
export const variante = (id: number) => cache?.find((v) => v.variante_id === id);
export const nomeVariante = (id: number) => { const v = variante(id); return v ? nomeBreve(v.prodotto, v.formato) : `Prodotto ${id}`; };

/** grammi di un formato scritto ("125g", "1kg") per ordinare dal più piccolo */
export const grammi = (f: string | null) => !f ? 0 : /kg$/i.test(f) ? parseFloat(f) * 1000 : parseFloat(f) || 0;
const eMiele = (p: string) => /^miele/i.test(p);
/** prima i mieli (per nome, formati dal più piccolo), poi gli altri prodotti */
export function ordina(a: Disponibilita, b: Disponibilita) {
  return Number(eMiele(b.prodotto)) - Number(eMiele(a.prodotto)) || a.prodotto.localeCompare(b.prodotto, 'it') || grammi(a.formato) - grammi(b.formato);
}
export const gruppo = (p: string) => (eMiele(p) ? p : 'Altri prodotti');
