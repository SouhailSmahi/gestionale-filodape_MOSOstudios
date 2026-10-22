/**
 * Backup in Excel: dai dati esportati dal database (esporta_dati) al file .xlsx.
 * - Fogli leggibili all'inizio: Leggimi, Ordini, Giacenze.
 * - Poi un foglio per ogni tabella del gestionale, con le colonne originali: servono per il ripristino.
 * Lo stesso codice gira nell'app e nel backup automatico settimanale.
 */
import { creaExcel, type Cella, type Foglio } from './excel';

export interface DatiEsportati {
  creato_il: string;
  tabelle: { nome: string; colonne: string[]; righe: Record<string, unknown>[] }[];
  ordini: Record<string, unknown>[];
  giacenze: Record<string, unknown>[];
}

const valore = (v: unknown): Cella => {
  if (v == null) return null;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
  return JSON.stringify(v);   // array e json: come testo
};

// il database non conserva l'ordine delle colonne nei riepiloghi: lo fissiamo qui
const COLONNE_ORDINI = ['N.', 'Data ordine', 'Cliente', 'Stato', 'Prodotti', 'Totale €', 'Consegnato €', 'Incassato €', 'Note'];
const COLONNE_GIACENZE = ['Codice', 'Prodotto', 'Formato', 'Pezzi pronti'];
const STATI: Record<string, string> = {
  in_attesa_conferma: 'Da confermare', confermata: 'Confermato', in_produzione: 'In produzione',
  parzialmente_evasa: 'Consegnato in parte', evasa: 'Consegnato', annullata: 'Annullato',
};

const leggibile = (nome: string, colonne: string[], righe: Record<string, unknown>[]): Foglio => ({
  nome, colonne,
  righe: righe.map((r) => colonne.map((c) => valore(c === 'Stato' ? STATI[String(r[c])] ?? r[c] : r[c]))),
});

/** Nome del file: filodape-backup-AAAA-MM-GG.xlsx (data italiana del momento dell'esportazione) */
export function nomeFileBackup(quando: string | Date) {
  const d = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(new Date(quando));
  return `filodape-backup-${d}.xlsx`;
}

export function creaExcelBackup(d: DatiEsportati): Uint8Array {
  const quando = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'full', timeStyle: 'short' }).format(new Date(d.creato_il));
  const totRighe = d.tabelle.reduce((a, t) => a + t.righe.length, 0);
  const leggimi: Foglio = {
    nome: 'Leggimi', colonne: ['Backup completo del gestionale Filodape'], larghezze: [110],
    righe: [
      [`Creato ${quando}.`],
      [''],
      ['Fogli da leggere:'],
      ['• Ordini: un ordine per riga, con prodotti, totale, consegnato e incassato.'],
      ['• Giacenze: i pezzi pronti di ogni prodotto in quel momento.'],
      [''],
      [`Gli altri ${d.tabelle.length} fogli (nomi in minuscolo, ${totRighe} righe in tutto) sono le tabelle complete del gestionale.`],
      ['Servono a ripristinare tutto se dovesse succedere qualcosa: non modificarli e non rinominarli.'],
      ['Per il ripristino: docs/RILASCIO.md, sezione "Ripristino dall\'Excel".'],
      [''],
      ['Conserva questo file sul telefono o sul computer (e magari una copia su una chiavetta o un cloud).'],
    ],
  };
  const tabelle: Foglio[] = d.tabelle.map((t) => ({
    nome: t.nome, colonne: t.colonne,
    righe: t.righe.map((r) => t.colonne.map((c) => valore(r[c]))),
  }));
  return creaExcel([leggimi, leggibile('Ordini', COLONNE_ORDINI, d.ordini), leggibile('Giacenze', COLONNE_GIACENZE, d.giacenze), ...tabelle]);
}
