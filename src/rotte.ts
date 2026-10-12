/** Elenco delle pagine con il loro indirizzo e chi può aprirle. */
import { html } from 'lit-html';
import type { Rotta, Pagina } from './app';
import { nuovoOrdine } from './screens/ordine-nuovo';
import { mieiOrdini, disponibilita } from './screens/staff';
import { impostazioni } from './screens/impostazioni';
import { home } from './screens/home';
import { ordini, schedaOrdine } from './screens/ordini';
import { andamento } from './screens/andamento';
import { magazzino } from './screens/magazzino';
import { produzione, schedaLotto, tappa, nuovaAttivita } from './screens/produzione';

const prossimamente = (titolo: string, tab: string) => (): Pagina => ({
  titolo, tab, vista: () => html`<h1>${titolo}</h1><p class="sub">In costruzione.</p>`,
});

export const rotte: Rotta[] = [
  // aiutanti (e Filippo)
  { path: '/nuovo', ruolo: 'staff', f: nuovoOrdine },
  { path: '/miei', ruolo: 'staff', f: mieiOrdini },
  { path: '/disponibilita', ruolo: 'staff', f: disponibilita },
  { path: '/impostazioni', ruolo: 'tutti', f: impostazioni },
  // Filippo
  { path: '/', ruolo: 'admin', f: home },
  { path: '/ordini', ruolo: 'admin', f: (_p, q) => ordini(q) },
  { path: '/ordini/nuovo', ruolo: 'admin', f: nuovoOrdine },
  { path: '/ordini/:id', ruolo: 'admin', f: schedaOrdine },
  { path: '/andamento', ruolo: 'admin', f: (_p, q) => andamento(q) },
  { path: '/produzione', ruolo: 'admin', f: produzione },
  { path: '/produzione/attivita', ruolo: 'admin', f: nuovaAttivita },
  { path: '/produzione/lotti/:id', ruolo: 'admin', f: schedaLotto },
  { path: '/produzione/lotti/:id/:tappa', ruolo: 'admin', f: tappa },
  { path: '/magazzino', ruolo: 'admin', f: (_p, q) => magazzino(q) },
  { path: '/acquisti', ruolo: 'admin', f: prossimamente('Acquisti', 'acquisti') },
  { path: '/mercato', ruolo: 'admin', f: prossimamente('Mercato', 'mercato') },
  { path: '/attrezzatura', ruolo: 'admin', f: prossimamente('Attrezzatura', 'attrezzatura') },
  { path: '/notifiche', ruolo: 'admin', f: prossimamente('Notifiche', 'notifiche') },
  { path: '/anagrafiche', ruolo: 'admin', f: prossimamente('Anagrafiche', 'anagrafiche') },
  { path: '/articoli', ruolo: 'admin', f: prossimamente('Anagrafica articoli', 'articoli') },
  { path: '/altro', ruolo: 'admin', f: prossimamente('Altro', 'altro') },
];
