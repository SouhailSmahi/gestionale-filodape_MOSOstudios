/** Anagrafiche di Filippo usate nei menu a tendina (postazioni, mezzi, articoli…), lette al bisogno. */
import * as api from './api';
import type * as T from './types';

export const rif = {
  postazioni: [] as T.Postazione[], mezzi: [] as T.Mezzo[], articoli: [] as T.Articolo[], categorie: [] as T.CategoriaArticolo[],
  tipi: [] as T.TipoMiele[], prodotti: [] as T.Prodotto[], fornitori: [] as T.Fornitore[], categorieCespite: [] as T.CategoriaCespite[],
};
type Chiave = keyof typeof rif;
const caricatori: Record<Chiave, () => Promise<unknown[]>> = {
  postazioni: () => api.lista<T.Postazione>('postazioni'), mezzi: () => api.lista<T.Mezzo>('mezzi'),
  articoli: api.articoli, categorie: api.categorieArticolo, tipi: api.tipiMiele, prodotti: api.prodotti,
  fornitori: () => api.lista<T.Fornitore>('fornitori'), categorieCespite: api.categorieCespite,
};
const letto = new Map<Chiave, number>();

/** Carica le anagrafiche richieste (riusa quelle lette da meno di un minuto). */
export async function carica(...k: Chiave[]) {
  await Promise.all(k.map(async (c) => {
    if (Date.now() - (letto.get(c) ?? 0) < 60_000) return;
    (rif[c] as unknown[]) = await caricatori[c]();
    letto.set(c, Date.now());
  }));
}
/** Da chiamare dopo una modifica, così il prossimo `carica` rilegge. */
export function invalida(...k: Chiave[]) { (k.length ? k : (Object.keys(rif) as Chiave[])).forEach((c) => letto.delete(c)); }

/** Vasetti di un tipo di miele, dal più piccolo. */
export function formatiDi(tipo: number) {
  return rif.prodotti.filter((p) => p.tipo_miele_id === tipo).flatMap((p) => p.varianti)
    .filter((v) => v.attivo && (v.peso_kg ?? 0) > 0).sort((a, b) => Number(a.peso_kg) - Number(b.peso_kg));
}
export const nomePostazione = (id: number | null) => rif.postazioni.find((p) => p.id === id)?.nome ?? '';
export const mezzo = (id: number | null) => rif.mezzi.find((m) => m.id === id);
export const articolo = (id: number) => rif.articoli.find((a) => a.id === id);
export const categoria = (id: number) => rif.categorie.find((c) => c.id === id);
