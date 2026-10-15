/** Traduce gli errori di database e rete in frasi comprensibili per chi usa l'app. */

export class AppError extends Error {}

const VINCOLI: Record<string, string> = {
  consegna_oltre_ordinato: 'Non puoi consegnare più pezzi di quelli ordinati.',
  conferma_senza_data: 'Inserisci la data di consegna indicativa.',
  resa_oltre_prelevato: 'Il residuo non può superare quanto portato al mercato.',
  rettifica_senza_motivo: 'Indica il motivo della correzione.',
  rettifica_articolo_senza_motivo: 'Indica il motivo della correzione.',
  rettifica_miele_senza_motivo: 'Indica il motivo della correzione.',
  personale_senza_tariffa: 'Indica la tariffa al km per il mezzo a uso misto.',
  spostamento_senza_postazione: 'Scegli la postazione e il mezzo dello spostamento.',
  cespiti_check: 'Il contributo non può superare il prezzo pagato.',
  cespiti_check1: 'Indica la data di dismissione.',
  tipi_miele_sigla_check: 'La sigla deve avere 3 lettere (es. TIG).',
  profili_username_check: 'Il nome utente va scritto come nome.cognome, minuscolo e senza spazi.',
  prezzi_storico_prezzo_check: 'Il prezzo non può essere negativo.',
  fatturato_storico_anno: 'Il fatturato si scrive a mano solo per gli anni fino al 2025.',
  fatturato_storico_importo: 'Il fatturato non può essere negativo.',
};

const DUPLICATI: Record<string, string> = {
  ux_fornitori_nome: 'Esiste già un fornitore con questo nome.',
  ux_postazioni_nome: 'Esiste già una postazione con questo nome.',
  ux_mezzi_nome: 'Esiste già un mezzo con questo nome.',
  ux_articoli_nome: 'Esiste già un articolo con questo nome.',
  ux_confezioni: 'Questa confezione esiste già per l\'articolo.',
  ux_tipi_miele_nome: 'Esiste già un tipo di miele con questo nome.',
  tipi_miele_sigla_key: 'Questa sigla è già usata da un altro miele.',
  ux_prodotti_nome: 'Esiste già un prodotto con questo nome.',
  varianti_prodotto_codice_articolo_key: 'Questo codice prodotto è già usato.',
  articoli_codice_key: 'Questo codice articolo è già usato.',
  ux_motivi: 'Questo motivo esiste già.',
  profili_username_key: 'Esiste già un utente con questo nome utente.',
};

interface PgLike { code?: string; message?: string; details?: string | null; hint?: string | null }

export function messaggioErrore(e: unknown): string {
  if (e instanceof AppError) return e.message;
  if (e instanceof TypeError && /fetch|network/i.test(e.message)) {
    return 'Connessione assente o instabile: quello che hai scritto resta qui, riprova tra poco.';
  }
  const err = e as PgLike;
  const msg = err?.message || String(e);
  switch (err?.code) {
    case 'P0001': return msg;                                      // raise exception: già in italiano
    case '23505': {
      const k = Object.keys(DUPLICATI).find((n) => msg.includes(n));
      return k ? DUPLICATI[k] : 'Esiste già un elemento uguale.';
    }
    case '23503':
      return /update or delete|delete on table/i.test(msg)
        ? 'È già usato in altre registrazioni, quindi non si può cancellare: puoi archiviarlo.'
        : 'Uno degli elementi scelti non esiste più: ricarica la pagina.';
    case '23514': case '23502': {
      const k = Object.keys(VINCOLI).find((n) => msg.includes(`"${n}"`));
      return k ? VINCOLI[k] : 'Controlla i valori inseriti: qualcuno non è valido.';
    }
    case '42501': return 'Non hai i permessi per questa operazione.';
    case 'PGRST301': case 'PGRST302': return 'La sessione è scaduta: accedi di nuovo.';
    case '22P02': return 'Un valore inserito non è nel formato giusto.';
  }
  if (/Invalid login credentials/i.test(msg)) return 'Nome utente o password non corretti.';
  if (/JWT|token/i.test(msg)) return 'La sessione è scaduta: accedi di nuovo.';
  console.error(e);
  return 'Qualcosa non ha funzionato. Riprova; se succede ancora, avvisa MOSO.';
}
