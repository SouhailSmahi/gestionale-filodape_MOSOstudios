/** Elenco delle pagine con il loro indirizzo e chi può aprirle. */
import type { Rotta } from './app';
import { nuovoOrdine } from './screens/ordine-nuovo';
import { mieiOrdini, disponibilita } from './screens/staff';
import { impostazioni } from './screens/impostazioni';
import { home } from './screens/home';
import { ordini, schedaOrdine } from './screens/ordini';
import { andamento } from './screens/andamento';
import { magazzino } from './screens/magazzino';
import { anagrafiche, anagraficaArticoli } from './screens/anagrafiche';
import { mercato, attrezzatura, notifiche, altro } from './screens/varie';
import { acquisti, nuovoAcquisto, schedaAcquisto } from './screens/acquisti';
import { produzione, schedaLotto, tappa, nuovaAttivita } from './screens/produzione';


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
  { path: '/acquisti', ruolo: 'admin', f: (_p, q) => acquisti(q) },
  { path: '/acquisti/nuovo', ruolo: 'admin', f: nuovoAcquisto },
  { path: '/acquisti/:id', ruolo: 'admin', f: schedaAcquisto },
  { path: '/mercato', ruolo: 'admin', f: mercato },
  { path: '/attrezzatura', ruolo: 'admin', f: attrezzatura },
  { path: '/notifiche', ruolo: 'admin', f: notifiche },
  { path: '/anagrafiche', ruolo: 'admin', f: (_p, q) => anagrafiche(q) },
  { path: '/articoli', ruolo: 'admin', f: (_p, q) => anagraficaArticoli(q) },
  { path: '/altro', ruolo: 'admin', f: altro },
];
