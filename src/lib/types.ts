/** Tipi delle righe lette dal database (nomi uguali alle colonne). */

export type Ruolo = 'admin' | 'staff';
export type StatoComanda = 'in_attesa_conferma' | 'confermata' | 'in_produzione' | 'parzialmente_evasa' | 'evasa' | 'annullata';

export interface Profilo { id: string; username: string; nome: string; cognome: string; ruolo: Ruolo; attivo: boolean; creato_il: string }

export interface Disponibilita {
  variante_id: number; codice_articolo: string; prodotto: string; formato: string | null;
  disponibile: number; prelevata_mercato: number; prezzo_corrente: number | null;
}
export interface ClienteBreve { id: number; nome: string; cognome: string }
export interface Cliente extends ClienteBreve { tipo: 'privato' | 'azienda'; telefono: string | null; note: string | null; archiviato: boolean }

export interface MiaComanda {
  id: number; creata_il: string; creata_da: string; cliente: string; stato: StatoComanda;
  data_consegna_indicativa: string | null; note: string | null; articoli: string | null; cliente_id: number;
}

export interface RigaComanda { id: number; variante_id: number; quantita_ordinata: number; quantita_evasa: number; prezzo_unitario_applicato: number | null }
export interface Comanda {
  id: number; cliente_id: number; stato: StatoComanda; data_consegna_indicativa: string | null; note: string | null;
  creata_il: string; creata_da: string; confermata_il: string | null;
  cliente: { id: number; nome: string; cognome: string; telefono: string | null; tipo: string } | null;
  creatore: { nome: string; username: string } | null;
  righe: RigaComanda[];
  pagamenti: { id: number; importo: number; data_movimento: string; note: string | null; tipo: TipoMovimento; quota_acconto: number }[];
  consegne: { id: number; data_consegna: string; note: string | null; righe: { comanda_riga_id: number; quantita: number }[] }[];
}
export interface Saldo { comanda_id: number; cliente: string; totale_consegnato: number; incassato: number; saldo: number }
export interface Scadenza { id: number; cliente: string; stato: StatoComanda; data_consegna_indicativa: string; giorni_mancanti: number }
export interface DaFare { tipo: 'chiudi_lotto' | 'conferma_ordine' | 'consegna'; rif: string; testo: string; quando: string | null }
export interface Notifica { id: number; categoria: string; titolo: string; messaggio: string | null; tabella_rif: string | null; record_rif: string | null; creata_il: string; letta_il: string | null }

export interface CostoDettaglio {
  kg_smielati: number; kg_vendibili: number; minuti: number; quota_stagione: number; viaggi: number; ore: number;
  confezioni_personali: number; totale: number; costo_kg: number; stima: boolean;
  stagione: { anno: number; consumi: number; altre_spese: number; mezzi: number; attrezzatura: number; totale: number; kg_riferimento: number; per_kg: number };
}
export interface Lotto {
  id: number; codice: string; tipo_miele_id: number; tipo_miele: string; anno: number; progressivo: number; stato: 'aperto' | 'chiuso';
  ricordami_chiusura: boolean; data_chiusura: string | null; kg_smielati: number; kg_sfuso: number;
  kg_rimasto: number | null; kg_calo: number | null; kg_uso_personale: number | null; inizio: string | null; ultimo_evento: string | null;
  costo_kg_congelato: number | null; costo_kg_attuale: number | null; dati_cambiati: boolean;
  dettaglio_attuale: CostoDettaglio; dettaglio_congelato: CostoDettaglio | null;
}
export interface EventoLotto {
  id: number; lotto_id: number; tipo: 'spostamento' | 'smielatura' | 'confezionamento' | 'chiusura'; data: string;
  postazione_id: number | null; mezzo_id: number | null; km: number | null; minuti: number | null; arnie: number | null;
  costo_terzi: number | null; note: string | null;
  postazione: { nome: string } | null; mezzo: { nome: string; tipo: string } | null;
  bariloni: { id: number; kg: number }[]; righe: { variante_id: number; pezzi: number; uso_personale: boolean }[];
}
export interface CostoVasettoLotto { lotto_id: number; variante_id: number; costo_confezione: number; costo_miele: number; costo_totale: number }
export interface QuotaStagione { consumi: number; altre_spese: number; mezzi: number; attrezzatura: number; totale: number; kg_riferimento: number; per_kg: number }
export interface Attivita {
  id: number; tipo: 'nutrizione' | 'trattamento'; data: string; articolo_id: number; quantita: number; minuti: number | null; note: string | null;
  articolo: { nome: string; unita: string } | null; postazioni: { postazione_id: number }[];
}

export interface Quadro {
  variante_id: number; codice_articolo: string; prodotto: string; formato: string | null; disponibile: number; prelevata_mercato: number;
  ordinata: number; evasa: number; da_evadere: number; di_cui_da_confermare: number; da_produrre: number;
}
export interface MieleSfuso { lotto_id: number; codice: string; tipo_miele: string; anno: number; stato: string; kg: number; valore: number }
export interface GiacenzaArticolo {
  articolo_id: number; nome: string; codice: string | null; categoria: string; categoria_nome: string; magazzino: 'materiali' | 'apistiche' | null;
  unita: 'kg' | 'l' | 'pz'; scorta_minima: number | null; archiviato: boolean; giacenza: number; costo_medio: number | null; valore: number;
  sotto_scorta: boolean; confezioni: { id: number; nome: string; quantita: number }[] | null;
}
export interface CostoVasetto {
  variante_id: number; codice_articolo: string; prodotto: string; formato: string; peso_kg: number; lotto_rif: string | null; stima: boolean | null;
  costo_confezione: number; costo_miele: number; prezzo: number | null;
  componenti: { articolo: string; quantita: number; costo_medio: number | null }[] | null;
}
export interface Motivo { id: number; magazzino: 'prodotti' | 'articoli' | 'miele'; nome: string }
export interface Impostazioni { nome_azienda: string; dominio_login: string; valore_ora: number; costo_netto: boolean; tariffa_auto_km: number }

export interface RigaAcquistoIn {
  articolo_id?: number; nuovo_articolo?: { nome: string; categoria: string; unita: string; magazzino?: string | null };
  quantita: number; confezione_id?: number | null; totale: number; mezzo_id?: number | null; contachilometri?: number | null;
  cespite?: { nome?: string; categoria_id: number; vita_utile: number; contributo: number; quantita?: number } | null;
}
export interface Acquisto {
  id: number; data: string; fornitore_id: number | null; note: string | null; fornitore: { id: number; nome: string } | null;
  righe: { id: number; articolo_id: number; quantita: number; totale: number; mezzo_id: number | null; contachilometri: number | null;
    articolo: { id: number; nome: string; unita: string; categoria_id: number }; mezzo: { nome: string } | null }[];
}
export interface Mercato {
  id: number; luogo: string; data: string; stato: 'aperta' | 'chiusa'; chiusa_il: string | null; note: string | null;
  righe: { id: number; variante_id: number; quantita_prelevata: number; quantita_resa: number | null; prezzo_unitario_applicato: number | null }[];
}
export interface CategoriaCespite { id: number; nome: string; vita_utile_default: number }
export interface Cespite {
  id: number; nome: string; categoria_id: number; quantita: number; anno_acquisto: number; prezzo: number; contributo: number; vita_utile: number;
  stato: 'in_uso' | 'dismesso'; data_dismissione: string | null; acquisto_riga_id: number | null; note: string | null; categoria?: { nome: string };
}
export interface Vendita { data: string; anno: number; mese: number; canale: string; variante_id: number; prodotto: string; tipo_miele: string | null; formato: string | null; pezzi: number; kg: number; importo: number | null }
export interface Spesa {
  data: string; anno: number; mese: number; riga_id: number; articolo_id: number; articolo: string; categoria: string; categoria_nome: string;
  fornitore: string | null; quantita: number; unita: string; totale: number; prezzo_unitario: number; attrezzatura_pluriennale: boolean;
}
export interface Grafico { id: number; utente_id: string; titolo: string; misura: string; divisione: string; periodo: { anno?: number | null }; in_home: boolean; creato_il: string }

export interface Fornitore { id: number; nome: string; telefono: string | null; partita_iva: string | null; note: string | null; archiviato: boolean }
export interface Postazione { id: number; nome: string; localita: string | null; km_abituali: number | null; arnie: number | null; note: string | null; archiviato: boolean }
export interface Mezzo { id: number; nome: string; tipo: 'dedicato' | 'personale' | 'terzi'; tariffa_km: number | null; note: string | null; archiviato: boolean }
export interface CategoriaArticolo { id: number; codice: string; nome: string; magazzino_default: 'materiali' | 'apistiche' | null }
export interface Articolo {
  id: number; nome: string; categoria_id: number; magazzino: 'materiali' | 'apistiche' | null; unita: 'kg' | 'l' | 'pz';
  scorta_minima: number | null; codice: string | null; archiviato: boolean; confezioni: { id: number; nome: string; quantita: number }[];
}
export interface TipoMiele { id: number; nome: string; sigla: string; archiviato: boolean }
export interface Variante { id: number; prodotto_id: number; formato: string | null; peso_kg: number | null; codice_articolo: string; attivo: boolean; distinta: { articolo_id: number; quantita: number }[] }
export interface Prodotto { id: number; categoria_id: number; nome: string; tipo_miele_id: number | null; attivo: boolean; tipo: { nome: string; sigla: string } | null; varianti: Variante[] }

/** Fatturato (venduto) di un anno: scritto a mano fino al 2025, calcolato dall'app dal 2026. */
export interface FatturatoAnno {
  anno: number; fonte: 'manuale' | 'automatico'; venduto: number;
  venduto_ordini: number | null; venduto_mercato: number | null; incassato: number | null;
  pezzi_senza_prezzo: number; nota: string | null; aggiornato_il: string | null;
}
export interface ModificaFatturato {
  id: number; anno: number; importo_prima: number | null; importo_dopo: number | null; nota: string | null;
  modificato_il: string; autore: { nome: string } | null;
}

/** Cosa rappresenta un movimento di denaro di un ordine (lo decide il database). */
export type TipoMovimento = 'incasso' | 'acconto' | 'incasso_acconto' | 'resto';
