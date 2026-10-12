/**
 * Unico punto di contatto con il database.
 * Le regole (permessi, blocchi, calcoli) stanno in Postgres: qui ci sono solo letture e chiamate.
 * Ogni funzione lancia un errore già tradotto (vedi errors.ts) se qualcosa va storto.
 */
import { sb, LOGIN_DOMAIN, FUNCTIONS_URL } from './supabase';
import { AppError, messaggioErrore } from './errors';
import type * as T from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Res<D> = { data: D | null; error: unknown } | { data: any; error: any };

async function q<D>(p: PromiseLike<Res<D>>): Promise<D> {
  let r: Res<D>;
  try { r = await p; } catch (e) { throw new AppError(messaggioErrore(e)); }
  if (r.error) throw new AppError(messaggioErrore(r.error));
  return r.data as D;
}
const rpc = <D = unknown>(fn: string, args: Record<string, unknown> = {}) => q<D>(sb.rpc(fn, args) as unknown as PromiseLike<Res<D>>);

// ---------------------------------------------------------------- accesso
export const emailDa = (username: string) => `${username.trim().toLowerCase()}@${LOGIN_DOMAIN}`;

export async function login(username: string, password: string): Promise<void> {
  const u = username.trim().toLowerCase();
  if (!u || !password) throw new AppError('Scrivi nome utente e password.');
  if (!u.includes('.')) throw new AppError('Il nome utente è nella forma nome.cognome (es. mario.rossi).');
  await q(sb.auth.signInWithPassword({ email: emailDa(u), password }));
}
export async function logout() { await sb.auth.signOut(); }
export async function sessione() { return (await sb.auth.getSession()).data.session; }

export async function mioProfilo(): Promise<T.Profilo | null> {
  const s = await sessione();
  if (!s) return null;
  return q(sb.from('profili').select('*').eq('id', s.user.id).maybeSingle());
}
export async function cambiaPassword(nuova: string) {
  if (nuova.length < 8) throw new AppError('La password deve avere almeno 8 caratteri.');
  await q(sb.auth.updateUser({ password: nuova }));
}

// ---------------------------------------------------------------- utenti (Edge Function, solo admin)
async function gestioneUtenti(body: Record<string, unknown>) {
  const s = await sessione();
  let r: Response;
  try {
    r = await fetch(`${FUNCTIONS_URL}/gestione-utenti`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${s?.access_token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
      body: JSON.stringify(body),
    });
  } catch (e) { throw new AppError(messaggioErrore(e)); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new AppError(j.error || 'Operazione sugli utenti non riuscita.');
  return j;
}
export const utenti = () => q<T.Profilo[]>(sb.from('profili').select('*').order('ruolo').order('nome'));
export const creaUtente = (u: { username: string; nome: string; cognome: string; password: string }) =>
  gestioneUtenti({ azione: 'crea_utente', ...u });
export const resetPassword = (user_id: string, password: string) => gestioneUtenti({ azione: 'reset_password', user_id, password });
export const impostaAttivo = (user_id: string, attivo: boolean) => gestioneUtenti({ azione: 'imposta_attivo', user_id, attivo });

// ---------------------------------------------------------------- catalogo e disponibilità (staff e admin)
export const disponibilita = () =>
  q<T.Disponibilita[]>(sb.from('v_disponibilita_staff').select('*').order('prodotto').order('formato'));
export const clientiStaff = () => q<T.ClienteBreve[]>(sb.from('v_clienti_staff').select('*').order('nome'));

export const creaComanda = (cliente: number | null, nuovo: { nome: string; cognome: string; telefono?: string } | null,
  righe: { variante_id: number; quantita: number }[], note?: string) =>
  rpc<number>('crea_comanda', { p_cliente: cliente, p_nuovo_cliente: nuovo, p_righe: righe, p_note: note || null });

export const mieComande = () => q<T.MiaComanda[]>(sb.from('v_mie_comande').select('*').order('creata_il', { ascending: false }).limit(60));
export const righeComande = (ids: number[]) => ids.length
  ? q<{ comanda_id: number; variante_id: number; quantita_ordinata: number; quantita_evasa: number }[]>(
      sb.from('comanda_righe').select('comanda_id,variante_id,quantita_ordinata,quantita_evasa').in('comanda_id', ids))
  : Promise.resolve([]);
export const annullaComanda = (id: number) => q(sb.from('comande').update({ stato: 'annullata' }).eq('id', id));

// ---------------------------------------------------------------- ordini (admin)
const COMANDA_SEL = `*, cliente:clienti(id,nome,cognome,telefono,tipo),
  creatore:profili!comande_creata_da_fkey(nome,username),
  righe:comanda_righe(id,variante_id,quantita_ordinata,quantita_evasa,prezzo_unitario_applicato),
  pagamenti:movimenti_pagamento(id,importo,data_movimento,note),
  consegne(id,data_consegna,note,righe:consegna_righe(comanda_riga_id,quantita))`;
export function comande(f: { stati?: string[]; daGiorni?: number } = {}) {
  let r = sb.from('comande').select(COMANDA_SEL).order('creata_il', { ascending: false });
  if (f.stati) r = r.in('stato', f.stati);
  if (f.daGiorni) r = r.gte('creata_il', new Date(Date.now() - f.daGiorni * 864e5).toISOString());
  return q<T.Comanda[]>(r.limit(200));
}
export const comanda = (id: number) => q<T.Comanda>(sb.from('comande').select(COMANDA_SEL).eq('id', id).single());
export const confermaComanda = (id: number, stato: 'confermata' | 'in_produzione', data: string) =>
  rpc('conferma_comanda', { p_comanda: id, p_stato: stato, p_data: data });
export const registraConsegna = (id: number, righe: { comanda_riga_id: number; quantita: number }[], note?: string) =>
  rpc<number>('registra_consegna', { p_comanda: id, p_righe: righe, p_note: note || null });
export const registraPagamento = (comanda_id: number, importo: number, note?: string) =>
  q(sb.from('movimenti_pagamento').insert({ comanda_id, importo, note: note || null }));
export const aggiornaRiga = (id: number, quantita_ordinata: number) => q(sb.from('comanda_righe').update({ quantita_ordinata }).eq('id', id));
export const eliminaRiga = (id: number) => q(sb.from('comanda_righe').delete().eq('id', id));
export const aggiungiRiga = (comanda_id: number, variante_id: number, quantita_ordinata: number) =>
  q(sb.from('comanda_righe').insert({ comanda_id, variante_id, quantita_ordinata }));
export const aggiornaNoteComanda = (id: number, note: string) => q(sb.from('comande').update({ note: note || null }).eq('id', id));
export const saldiAperti = () => q<T.Saldo[]>(sb.from('v_saldi_aperti').select('*'));
export const scadenze = () => q<T.Scadenza[]>(sb.from('v_scadenze_consegna').select('*').order('data_consegna_indicativa'));

// ---------------------------------------------------------------- home
export const daFare = () => q<T.DaFare[]>(sb.from('v_da_fare').select('*'));
export const notificheDaLeggere = () => q<{ categoria: string; da_leggere: number }[]>(sb.from('v_notifiche_da_leggere').select('*'));
export async function preferenzeHome(): Promise<string[] | null> {
  const r = await q<{ riquadri: string[] } | null>(sb.from('preferenze_home').select('riquadri').maybeSingle());
  return r?.riquadri ?? null;
}
export const salvaPreferenzeHome = (riquadri: string[]) =>
  q(sb.from('preferenze_home').upsert({ riquadri }, { onConflict: 'utente_id' }));

// ---------------------------------------------------------------- notifiche
export const notifiche = (lette: boolean) => {
  const r = sb.from('notifiche').select('*').order('creata_il', { ascending: false }).limit(lette ? 100 : 300);
  return q<T.Notifica[]>(lette ? r.not('letta_il', 'is', null) : r.is('letta_il', null));
};
export const segnaLetta = (id: number) => rpc('segna_letta', { p_notifica: id });
export const segnaTutteLette = (categoria: string | null) => rpc<number>('segna_tutte_lette', { p_categoria: categoria });

// ---------------------------------------------------------------- produzione
export const lotti = () => q<T.Lotto[]>(sb.from('v_lotti').select('*').order('anno', { ascending: false }).order('id', { ascending: false }));
export const lotto = (id: number) => q<T.Lotto>(sb.from('v_lotti').select('*').eq('id', id).single());
export const eventiLotto = (id: number) => q<T.EventoLotto[]>(sb.from('lotto_eventi')
  .select('*, postazione:postazioni(nome), mezzo:mezzi(nome,tipo), bariloni:smielatura_bariloni(id,kg), righe:confezionamento_righe(variante_id,pezzi,uso_personale)')
  .eq('lotto_id', id).order('data').order('id'));
export const costoVasettiLotto = (id: number) => q<T.CostoVasettoLotto[]>(sb.from('lotti_costo_vasetti').select('*').eq('lotto_id', id));
export const nuovoLotto = (tipo: number, anno: number, note?: string) => rpc<number>('nuovo_lotto', { p_tipo_miele: tipo, p_anno: anno, p_note: note || null });
export const registraEvento = (a: { lotto: number; tipo: 'spostamento' | 'smielatura'; data: string; postazione?: number | null; mezzo?: number | null;
  km?: number | null; minuti?: number | null; arnie?: number | null; costo_terzi?: number | null; note?: string; bariloni?: number[] }) =>
  rpc<number>('registra_evento_lotto', { p_lotto: a.lotto, p_tipo: a.tipo, p_data: a.data, p_postazione: a.postazione ?? null, p_mezzo: a.mezzo ?? null,
    p_km: a.km ?? null, p_minuti: a.minuti ?? null, p_arnie: a.arnie ?? null, p_costo_terzi: a.costo_terzi ?? null, p_note: a.note || null, p_bariloni: a.bariloni ?? null });
export const confeziona = (a: { lotto: number; righe: { variante_id: number; pezzi: number }[]; data: string; minuti?: number | null;
  mezzo?: number | null; km?: number | null; costo_terzi?: number | null; note?: string }) =>
  rpc<number>('confeziona', { p_lotto: a.lotto, p_righe: a.righe, p_data: a.data, p_minuti: a.minuti ?? null, p_mezzo: a.mezzo ?? null,
    p_km: a.km ?? null, p_costo_terzi: a.costo_terzi ?? null, p_note: a.note || null });
export const chiudiLotto = (a: { lotto: number; kg_rimasto: number; uso_personale: { variante_id: number; pezzi: number }[]; data: string; minuti?: number | null; note?: string }) =>
  rpc<{ kg_calo: number; costo_kg: number }>('chiudi_lotto', { p_lotto: a.lotto, p_kg_rimasto: a.kg_rimasto, p_uso_personale: a.uso_personale,
    p_data: a.data, p_minuti: a.minuti ?? null, p_note: a.note || null });
export const ricordamiChiusura = (id: number, si = true) => q(sb.from('lotti').update({ ricordami_chiusura: si }).eq('id', id));
export const ricalcolaLotto = (id: number) => rpc<number>('ricalcola_lotto', { p_lotto: id });
export const ricalcolaTutti = () => rpc<number>('ricalcola_tutti_lotti');
export const aggiornaEvento = (id: number, v: Partial<Pick<T.EventoLotto, 'data' | 'km' | 'minuti' | 'arnie' | 'costo_terzi' | 'note' | 'postazione_id' | 'mezzo_id'>>) =>
  q(sb.from('lotto_eventi').update(v).eq('id', id));
export const aggiornaBarilone = (id: number, kg: number) => q(sb.from('smielatura_bariloni').update({ kg }).eq('id', id));
export const quotaStagione = (anno: number) => q<T.QuotaStagione[]>(sb.rpc('quota_stagione', { p_anno: anno }) as unknown as PromiseLike<Res<T.QuotaStagione[]>>).then((r) => r[0]);

export const attivita = (anno: number) => q<T.Attivita[]>(sb.from('attivita_stagione')
  .select('*, articolo:articoli(nome,unita), postazioni:attivita_postazioni(postazione_id)')
  .gte('data', `${anno}-01-01`).lte('data', `${anno}-12-31`).order('data', { ascending: false }));
export const registraAttivita = (a: { tipo: 'nutrizione' | 'trattamento'; data: string; articolo: number; quantita: number; minuti?: number | null;
  note?: string; postazioni?: number[] | null; confezione?: number | null }) =>
  rpc<number>('registra_attivita', { p_tipo: a.tipo, p_data: a.data, p_articolo: a.articolo, p_quantita: a.quantita, p_minuti: a.minuti ?? null,
    p_note: a.note || null, p_postazioni: a.postazioni?.length ? a.postazioni : null, p_confezione: a.confezione ?? null });

// ---------------------------------------------------------------- magazzino e costi
export const quadroDisponibilita = () => q<T.Quadro[]>(sb.from('v_quadro_disponibilita').select('*').order('prodotto').order('formato'));
export const mieleSfuso = () => q<T.MieleSfuso[]>(sb.from('v_miele_sfuso').select('*').order('anno', { ascending: false }).order('codice'));
export const giacenzeArticoli = () => q<T.GiacenzaArticolo[]>(sb.from('v_giacenza_articoli').select('*').order('nome'));
export const costoVasetti = () => q<T.CostoVasetto[]>(sb.from('v_costo_vasetti').select('*').order('prodotto').order('peso_kg'));
export const prezziStorico = (variante: number) =>
  q<{ prezzo: number; valido_dal: string; valido_al: string | null }[]>(sb.from('prezzi_storico').select('prezzo,valido_dal,valido_al').eq('variante_id', variante).order('valido_dal', { ascending: false }));
export const impostaPrezzo = (variante: number, prezzo: number | null) => rpc('imposta_prezzo', { p_variante: variante, p_prezzo: prezzo });
export const motivi = () => q<T.Motivo[]>(sb.from('motivi_rettifica').select('*').eq('archiviato', false).order('nome'));
export const rettificaProdotto = (variante: number, quantita: number, motivo: string, note?: string) =>
  rpc('rettifica_prodotto', { p_variante: variante, p_quantita: quantita, p_motivo: motivo, p_note: note || null });
export const rettificaArticolo = (articolo: number, quantita: number, motivo: string, note?: string) =>
  rpc('rettifica_articolo', { p_articolo: articolo, p_quantita: quantita, p_motivo: motivo, p_note: note || null });
export const rettificaMiele = (lotto: number, kg: number, motivo: string, note?: string) =>
  rpc('rettifica_miele', { p_lotto: lotto, p_kg: kg, p_motivo: motivo, p_note: note || null });
export const caricoIniziale = (variante: number, quantita: number) => rpc('carico_iniziale_prodotto', { p_variante: variante, p_quantita: quantita });
export const impostazioni = () => q<T.Impostazioni>(sb.from('impostazioni').select('*').single());
export const salvaImpostazioni = (v: Partial<T.Impostazioni>) => q(sb.from('impostazioni').update(v).eq('id', true));

// ---------------------------------------------------------------- acquisti
export const acquisti = (anno: number) => q<T.Acquisto[]>(sb.from('acquisti')
  .select('*, fornitore:fornitori(id,nome), righe:acquisto_righe(*, articolo:articoli(id,nome,unita,categoria_id), mezzo:mezzi(nome))')
  .gte('data', `${anno}-01-01`).lte('data', `${anno}-12-31`).order('data', { ascending: false }).order('id', { ascending: false }));
export const acquisto = (id: number) => q<T.Acquisto>(sb.from('acquisti')
  .select('*, fornitore:fornitori(id,nome), righe:acquisto_righe(*, articolo:articoli(id,nome,unita,categoria_id), mezzo:mezzi(nome))').eq('id', id).single());
export const registraAcquisto = (data: string, fornitore: number | null, nuovoFornitore: string | null, righe: T.RigaAcquistoIn[], note?: string) =>
  rpc<number>('registra_acquisto', { p_data: data, p_fornitore: fornitore, p_nuovo_fornitore: nuovoFornitore, p_righe: righe, p_note: note || null });
export const aggiornaAcquisto = (id: number, v: { data?: string; fornitore_id?: number | null; note?: string | null }) => q(sb.from('acquisti').update(v).eq('id', id));
export const aggiornaRigaAcquisto = (id: number, v: { quantita?: number; totale?: number; contachilometri?: number | null; mezzo_id?: number | null }) =>
  q(sb.from('acquisto_righe').update(v).eq('id', id));
export const eliminaRigaAcquisto = (id: number) => q(sb.from('acquisto_righe').delete().eq('id', id));
export const eliminaAcquisto = (id: number) => q(sb.from('acquisti').delete().eq('id', id));
export const prezziArticolo = (articolo: number) => q<T.Spesa[]>(sb.from('v_spese').select('*').eq('articolo_id', articolo).order('data'));

// ---------------------------------------------------------------- mercato
export const mercati = () => q<T.Mercato[]>(sb.from('sessioni_mercato')
  .select('*, righe:sessione_mercato_righe(*)').order('data', { ascending: false }).order('id', { ascending: false }).limit(60));
export async function apriMercato(luogo: string, data: string, righe: { variante_id: number; quantita_prelevata: number }[], note?: string) {
  const s = await q<{ id: number }>(sb.from('sessioni_mercato').insert({ luogo, data, note: note || null }).select('id').single());
  try {
    if (righe.length) await q(sb.from('sessione_mercato_righe').insert(righe.map((r) => ({ ...r, sessione_id: s.id }))));
  } catch (e) {
    await sb.from('sessioni_mercato').delete().eq('id', s.id);   // niente sessioni vuote se il prelievo fallisce
    throw e;
  }
  return s.id;
}
export const aggiungiAlMercato = (sessione_id: number, variante_id: number, quantita_prelevata: number) =>
  q(sb.from('sessione_mercato_righe').insert({ sessione_id, variante_id, quantita_prelevata }));
export const chiudiMercato = (id: number, rese: { variante_id: number; quantita_resa: number }[]) =>
  rpc('chiudi_sessione_mercato', { p_sessione: id, p_rese: rese });

// ---------------------------------------------------------------- attrezzatura
export const cespiti = () => q<T.Cespite[]>(sb.from('cespiti').select('*, categoria:categorie_cespite(nome)').order('stato').order('anno_acquisto', { ascending: false }));
export const categorieCespite = () => q<T.CategoriaCespite[]>(sb.from('categorie_cespite').select('*').order('nome'));
export const salvaCespite = (c: Partial<T.Cespite> & { id?: number }) => {
  const { id, categoria: _c, ...v } = c as T.Cespite;
  return id ? q(sb.from('cespiti').update(v).eq('id', id)) : q(sb.from('cespiti').insert(v));
};
export const eliminaCespite = (id: number) => q(sb.from('cespiti').delete().eq('id', id));
export const usoCespiti = (anno: number) => rpc<number>('uso_cespiti', { p_anno: anno });

// ---------------------------------------------------------------- andamento
export const vendite = (dal: string) => q<T.Vendita[]>(sb.from('v_vendite').select('*').gte('data', dal).order('data'));
export const spese = (dal: string) => q<T.Spesa[]>(sb.from('v_spese').select('*').gte('data', dal).order('data'));
export const smielature = () => q<{ data: string; lotto: { codice: string; anno: number; tipo: { nome: string } }; bariloni: { kg: number }[] }[]>(
  sb.from('lotto_eventi').select('data, lotto:lotti(codice,anno,tipo:tipi_miele(nome)), bariloni:smielatura_bariloni(kg)').eq('tipo', 'smielatura'));
export const kgSmielati = () => q<{ anno: number; tipo_miele: string; lotto: string; kg: number }[]>(sb.from('v_kg_smielati').select('*'));
export const incassiCosti = () => q<{ anno: number; incassi: number; costi: number }[]>(sb.from('v_incassi_costi_anno').select('*').order('anno'));
export const grafici = () => q<T.Grafico[]>(sb.from('grafici_utente').select('*').order('creato_il'));
export const salvaGrafico = (g: Omit<T.Grafico, 'id' | 'creato_il' | 'utente_id'>) => q(sb.from('grafici_utente').insert(g));
export const aggiornaGrafico = (id: number, v: Partial<T.Grafico>) => q(sb.from('grafici_utente').update(v).eq('id', id));
export const eliminaGrafico = (id: number) => q(sb.from('grafici_utente').delete().eq('id', id));

// ---------------------------------------------------------------- anagrafiche
export type Tabella = 'clienti' | 'fornitori' | 'postazioni' | 'mezzi';
export const lista = <R>(t: Tabella | 'articoli' | 'tipi_miele', order = 'nome') => q<R[]>(sb.from(t).select('*').order(order));
export const salva = (t: string, v: Record<string, unknown>, id?: number | null) =>
  id ? q(sb.from(t).update(v).eq('id', id)) : q<{ id: number }>(sb.from(t).insert(v).select('id').single());
export const elimina = (t: string, id: number) => q(sb.from(t).delete().eq('id', id));
export const archivia = (t: string, id: number, archiviato = true) => q(sb.from(t).update({ archiviato }).eq('id', id));

// ---------------------------------------------------------------- articoli e prodotti
export const categorieArticolo = () => q<T.CategoriaArticolo[]>(sb.from('categorie_articolo').select('*').order('id'));
export const articoli = () => q<T.Articolo[]>(sb.from('articoli').select('*, confezioni:articoli_confezioni(id,nome,quantita)').order('nome'));
export const salvaConfezione = (articolo_id: number, nome: string, quantita: number) => q(sb.from('articoli_confezioni').insert({ articolo_id, nome, quantita }));
export const eliminaConfezione = (id: number) => q(sb.from('articoli_confezioni').delete().eq('id', id));
export const tipiMiele = () => q<T.TipoMiele[]>(sb.from('tipi_miele').select('*').order('nome'));
export const categorieProdotto = () => q<{ id: number; nome: string }[]>(sb.from('categorie_prodotto').select('*').order('id'));
export const prodotti = () => q<T.Prodotto[]>(sb.from('prodotti')
  .select('*, tipo:tipi_miele(nome,sigla), varianti:varianti_prodotto(*, distinta:distinta_base(articolo_id,quantita))').order('nome'));
export const nuovoTipoMiele = (nome: string, sigla: string) => rpc<number>('nuovo_tipo_miele', { p_nome: nome, p_sigla: sigla });
export const proponiDistinta = (variante: number) => rpc<number>('proponi_distinta', { p_variante: variante });
export async function salvaDistinta(variante: number, righe: { articolo_id: number; quantita: number }[]) {
  await q(sb.from('distinta_base').delete().eq('variante_id', variante));
  if (righe.length) await q(sb.from('distinta_base').insert(righe.map((r) => ({ ...r, variante_id: variante }))));
}
export const salvaVariante = (v: Partial<T.Variante>, id?: number) =>
  id ? q(sb.from('varianti_prodotto').update(v).eq('id', id)) : q<{ id: number }>(sb.from('varianti_prodotto').insert(v).select('id').single());
export const salvaProdotto = (v: Record<string, unknown>) => q<{ id: number }>(sb.from('prodotti').insert(v).select('id').single());
