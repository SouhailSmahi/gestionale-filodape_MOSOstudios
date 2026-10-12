// font ospitati con l'app (niente richieste a Google: più veloce e senza dati a terzi)
import '@fontsource/lato/latin-400.css';
import '@fontsource/lato/latin-700.css';
import '@fontsource/lato/latin-900.css';
import '@fontsource/playfair-display/latin-700.css';
import './styles/tokens.css';
import './styles/app.css';
import { avvia, apri, stato, aggiorna } from './app';
import { rotte } from './rotte';
import { cornice } from './ui/layout';
import { mostraLogin } from './screens/login';
import * as api from './lib/api';
import { sb } from './lib/supabase';

const root = document.getElementById('app')!;
root.textContent = '';   // toglie il "Caricamento…" iniziale

/** Contatori del menu (notifiche da leggere, ordini da confermare): aggiornati a ogni cambio pagina. */
async function contatori() {
  if (stato.me?.ruolo !== 'admin') return;
  try {
    const [n, c] = await Promise.all([api.notificheDaLeggere(), api.comande({ stati: ['in_attesa_conferma'] })]);
    stato.contatori = { notifiche: n.reduce((a, x) => a + x.da_leggere, 0), daConfermare: c.length };
    aggiorna();
  } catch { /* i contatori non sono essenziali */ }
}

avvia({ root, rotte, shell: (c) => (stato.me ? cornice(c) : c), dopoNavigazione: contatori });

async function entra() {
  const p = await api.mioProfilo().catch(() => null);
  if (!p || !p.attivo) {
    await api.logout();
    mostraLogin(entra, p && !p.attivo ? 'Il tuo accesso è stato disattivato: chiedi a Filippo.' : '');
    return;
  }
  stato.me = p;
  if (location.pathname === '/login') history.replaceState(history.state, '', '/');
  apri();
}

sb.auth.onAuthStateChange((ev) => {
  if (ev === 'SIGNED_OUT' && stato.me) { stato.me = null; mostraLogin(entra, 'Sei uscito: accedi di nuovo.'); }
});

(async () => {
  const s = await api.sessione().catch(() => null);
  if (s) await entra(); else mostraLogin(entra);
})();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
