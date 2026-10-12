/** Profilo, password, tema; per Filippo anche utenti e valori di calcolo. */
import { html, nothing } from 'lit-html';
import type { Pagina } from '../app';
import { aggiorna, ricarica, stato } from '../app';
import * as api from '../lib/api';
import { parseNum, numCampo } from '../lib/format';
import { AppError } from '../lib/errors';
import { Modulo, campo, testa, toast, riga, lista, finestra, erroreModulo, bottoneInvio, chiedi, badge, spunta } from '../ui/kit';
import type { Impostazioni, Profilo } from '../lib/types';

type Tema = 'auto' | 'light' | 'dark';
const temaAttuale = (): Tema => (document.documentElement.dataset.theme as Tema) || 'auto';
function impostaTema(t: Tema) {
  if (t === 'auto') { delete document.documentElement.dataset.theme; try { localStorage.removeItem('filodape-tema'); } catch { /* */ } }
  else { document.documentElement.dataset.theme = t; try { localStorage.setItem('filodape-tema', t); } catch { /* */ } }
  aggiorna();
}

function modPassword(titolo: string, salva: (p: string) => Promise<unknown>, testo: string) {
  const m = new Modulo({ p1: '', p2: '' });
  const f = finestra(() => html`<h2>${titolo}</h2><p class="sub" style="margin-bottom:var(--space-4)">${testo}</p>
    ${erroreModulo(m)}
    ${campo(m, 'p1', 'Nuova password', { type: 'password', autocomplete: 'new-password', hint: 'Almeno 8 caratteri' })}
    ${campo(m, 'p2', 'Ripeti la password', { type: 'password', autocomplete: 'new-password' })}
    <div class="btns"><button class="btn quiet" @click=${() => f.chiudi()}>Annulla</button>
    ${bottoneInvio(m, 'Salva password', async () => {
      m.err = {};
      if (m.v.p1.length < 8) m.errore('p1', 'Almeno 8 caratteri');
      else if (m.v.p1 !== m.v.p2) m.errore('p2', 'Le due password non coincidono');
      if (await m.invia(() => salva(m.v.p1))) { f.chiudi(); toast('Password aggiornata'); }
    }, 'primary')}</div>`);
}

export function impostazioni(): Pagina {
  const admin = stato.me?.ruolo === 'admin';
  let utenti: Profilo[] = [];
  let imp: Impostazioni | null = null;
  const mi = new Modulo({ valore_ora: '', tariffa: '', netto: true as boolean });

  function nuovoUtente() {
    const m = new Modulo({ nome: '', cognome: '', username: '', password: '' });
    let toccato = false;
    const f = finestra(() => html`<h2>Nuovo aiutante</h2>
      ${erroreModulo(m)}
      <div class="row-fields">
        ${campo(m, 'nome', 'Nome', { autocomplete: 'off' })}
        ${campo(m, 'cognome', 'Cognome', { autocomplete: 'off' })}
      </div>
      ${campo(m, 'username', 'Nome utente', { hint: 'Proposto da nome e cognome: è quello da usare per entrare' })}
      ${campo(m, 'password', 'Password iniziale', { hint: 'Almeno 8 caratteri. Comunicala tu all\'aiutante: potrà cambiarla.' })}
      <div class="btns"><button class="btn quiet" @click=${() => f.chiudi()}>Annulla</button>
      ${bottoneInvio(m, 'Crea utente', async () => {
        m.err = {};
        const u = m.v.username.trim().toLowerCase();
        if (!m.v.nome.trim()) m.errore('nome', 'Scrivi il nome');
        if (!m.v.cognome.trim()) m.errore('cognome', 'Scrivi il cognome');
        if (!/^[a-z0-9]+(\.[a-z0-9]+)+$/.test(u)) m.errore('username', 'Nella forma nome.cognome, minuscolo, senza spazi né accenti');
        if (m.v.password.length < 8) m.errore('password', 'Almeno 8 caratteri');
        if (await m.invia(() => api.creaUtente({ username: u, nome: m.v.nome.trim(), cognome: m.v.cognome.trim(), password: m.v.password }))) {
          f.chiudi(); toast(`Utente ${u} creato`); ricarica();
        }
      }, 'primary')}</div>`);
    // propone il nome utente mentre si scrivono nome e cognome
    const origSet = m.set.bind(m);
    m.set = (k, v) => {
      if (k === 'username') toccato = true;
      origSet(k, v);
      if ((k === 'nome' || k === 'cognome') && !toccato) {
        const pulisci = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
        m.v.username = [pulisci(m.v.nome), pulisci(m.v.cognome)].filter(Boolean).join('.');
      }
      f.ridisegna();
    };
  }

  return {
    titolo: admin ? 'Impostazioni' : 'Profilo e password', tab: 'impostazioni',
    async carica() {
      if (!admin) return;
      [utenti, imp] = await Promise.all([api.utenti(), api.impostazioni()]);
      mi.v = { valore_ora: numCampo(imp.valore_ora, 2), tariffa: numCampo(imp.tariffa_auto_km, 3), netto: imp.costo_netto };
      mi.pulito();
    },
    modificata: () => admin && mi.modificato(),
    vista() {
      const me = stato.me!;
      const t = temaAttuale();
      return html`${testa(admin ? 'Impostazioni' : 'Profilo e password')}
      <div class="cols">
        <section class="card">
          <h2>Il tuo accesso</h2>
          <dl class="dl mt"><dt>Nome</dt><dd>${me.nome} ${me.cognome}</dd><dt>Nome utente</dt><dd>${me.username}</dd></dl>
          <div class="btns"><button class="btn" @click=${() => modPassword('Cambia password', (p) => api.cambiaPassword(p), 'Dal prossimo accesso userai la nuova password.')}>Cambia password</button></div>
        </section>
        <section class="card">
          <h2>Aspetto</h2>
          <p class="sub">Chiaro, scuro, oppure come il telefono.</p>
          <div class="seg mt" role="group" aria-label="Tema">
            ${([['auto', 'Come il dispositivo'], ['light', 'Chiaro'], ['dark', 'Scuro']] as [Tema, string][]).map(([k, l]) =>
              html`<button aria-pressed=${t === k ? 'true' : 'false'} @click=${() => impostaTema(k)}>${l}</button>`)}
          </div>
        </section>
      </div>

      ${admin && imp ? html`
      <section class="section">
        <div class="section-head"><h2>Utenti</h2><button class="btn" @click=${nuovoUtente}>+ Nuovo aiutante</button></div>
        ${lista(utenti.map((u) => riga({
          t: html`${u.nome} ${u.cognome} ${u.attivo ? nothing : badge('Disattivato', 'void')}`,
          m: `${u.username} · ${u.ruolo === 'admin' ? 'titolare' : 'aiutante'}`, cls: u.attivo ? '' : 'archived',
          extra: u.id === me.id ? undefined : html`<div class="btns" style="margin:0">
            <button class="btn sm quiet" @click=${() => modPassword(`Nuova password per ${u.nome}`, (p) => api.resetPassword(u.id, p), 'Comunicala tu: potrà cambiarla dal suo profilo.')}>Password</button>
            <button class="btn sm quiet" @click=${async () => {
              if (u.attivo && !(await chiedi(`Disattivare ${u.nome}?`, 'Non potrà più entrare. I suoi ordini restano. Puoi riattivarlo quando vuoi.', 'Disattiva', true))) return;
              try { await api.impostaAttivo(u.id, !u.attivo); toast(u.attivo ? 'Utente disattivato' : 'Utente riattivato'); ricarica(); }
              catch (e) { toast((e as Error).message, true); }
            }}>${u.attivo ? 'Disattiva' : 'Riattiva'}</button></div>`,
        })))}
      </section>

      <section class="section form">
        <h2>Valori per i calcoli</h2>
        <p class="sub" style="margin-bottom:var(--space-4)">Cambiandoli, i lotti già chiusi mostrano "dati cambiati" e puoi ricalcolarli.</p>
        ${erroreModulo(mi)}
        <div class="row-fields">
          ${campo(mi, 'valore_ora', 'Valore della tua ora', { numero: true, unita: '€/h', hint: '0 = il tuo tempo non entra nel costo' })}
          ${campo(mi, 'tariffa', 'Tariffa auto a uso misto', { numero: true, unita: '€/km', hint: 'Proposta per i nuovi mezzi personali' })}
        </div>
        ${spunta(mi, 'netto', 'Attrezzatura al netto dei contributi ricevuti')}
        <div class="btns">${bottoneInvio(mi, 'Salva valori', async () => {
          mi.err = {};
          const vo = parseNum(mi.v.valore_ora), ta = parseNum(mi.v.tariffa);
          if (vo == null || vo < 0) mi.errore('valore_ora', 'Scrivi un numero (anche 0)');
          if (ta == null || ta < 0) mi.errore('tariffa', 'Scrivi un numero');
          if (await mi.invia(async () => { if (vo == null || ta == null) throw new AppError('Valori non validi'); await api.salvaImpostazioni({ valore_ora: vo, tariffa_auto_km: ta, costo_netto: !!mi.v.netto }); })) toast('Valori salvati');
        }, 'primary')}</div>
      </section>` : nothing}`;
    },
  };
}
