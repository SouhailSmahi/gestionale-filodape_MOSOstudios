import { html } from 'lit-html';
import * as api from '../lib/api';
import { Modulo, campo, erroreModulo, chiedi } from '../ui/kit';
import { aggiorna, stato } from '../app';
import { logo } from '../ui/layout';

/** Schermata di accesso: nome.cognome + password. Al successo chiama `entra`. */
export function mostraLogin(entra: () => void, avviso = '') {
  const m = new Modulo({ username: '', password: '' });
  if (avviso) m.err._ = avviso;
  const invia = async () => {
    m.err = {};
    if (!m.v.username.trim()) m.errore('username', 'Scrivi il tuo nome utente, es. mario.rossi');
    if (!m.v.password) m.errore('password', 'Scrivi la password');
    if (await m.invia(() => api.login(m.v.username, m.v.password))) entra();
  };
  const vista = () => html`<div class="login"><form class="box" @submit=${(e: Event) => { e.preventDefault(); invia(); }} novalidate>
    ${logo('logo')}
    <h1>Accedi</h1>
    <p class="sub" style="margin-bottom:var(--space-6)">Usa il nome utente che ti ha dato Filippo.</p>
    ${erroreModulo(m)}
    ${campo(m, 'username', 'Nome utente', { placeholder: 'nome.cognome', autocomplete: 'username', hint: 'Tutto minuscolo, con il punto: es. anna.menossi' })}
    ${campo(m, 'password', 'Password', { type: 'password', autocomplete: 'current-password' })}
    <button class="btn primary full" type="submit" ?disabled=${m.busy}>${m.busy ? 'Accesso…' : 'Entra'}</button>
    <p class="small" style="margin-top:var(--space-5)">Password dimenticata? Chiedi a Filippo di impostarne una nuova.</p>
  </form></div>`;
  stato.me = null; stato.errore = ''; stato.caricamento = false;
  stato.pagina = { titolo: 'Accedi', vista };
  document.title = 'Accedi · Filodape';
  aggiorna();
}

export async function esci() {
  if (!(await chiedi('Esci dall\'app?', 'Per rientrare servono di nuovo nome utente e password.', 'Esci'))) return;
  await api.logout();
  sessionStorage.removeItem('filodape-pila');
  location.href = '/';
}
