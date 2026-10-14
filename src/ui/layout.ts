/** Cornice dell'app: menu in basso sul telefono, barra laterale da 1024 px. */
import { html, nothing, type TemplateResult } from 'lit-html';
import { stato, precedente } from '../app';
import { icon } from './icons';
import { esci } from '../screens/login';

interface Voce { path: string; tab: string; l: string; ic: string; count?: () => number }

const ADMIN_BASSO: Voce[] = [
  { path: '/', tab: 'home', l: 'Home', ic: 'home' },
  { path: '/ordini', tab: 'ordini', l: 'Ordini', ic: 'ordini', count: () => stato.contatori.daConfermare },
  { path: '/produzione', tab: 'produzione', l: 'Produzione', ic: 'produzione' },
  { path: '/magazzino', tab: 'magazzino', l: 'Magazzino', ic: 'magazzino' },
  { path: '/altro', tab: 'altro', l: 'Altro', ic: 'altro', count: () => stato.contatori.notifiche },
];
const ADMIN_LATO: (Voce | string)[] = [
  { path: '/', tab: 'home', l: 'Home', ic: 'home' },
  { path: '/ordini', tab: 'ordini', l: 'Ordini', ic: 'ordini', count: () => stato.contatori.daConfermare },
  { path: '/produzione', tab: 'produzione', l: 'Produzione', ic: '' },
  { path: '/magazzino', tab: 'magazzino', l: 'Magazzino', ic: '' },
  { path: '/acquisti', tab: 'acquisti', l: 'Acquisti', ic: '' },
  { path: '/mercato', tab: 'mercato', l: 'Mercato', ic: '' },
  { path: '/attrezzatura', tab: 'attrezzatura', l: 'Attrezzatura', ic: '' },
  { path: '/andamento', tab: 'andamento', l: 'Andamento', ic: '' },
  { path: '/notifiche', tab: 'notifiche', l: 'Notifiche', ic: '', count: () => stato.contatori.notifiche },
  'Anagrafiche',
  { path: '/anagrafiche', tab: 'anagrafiche', l: 'Anagrafiche', ic: '' },
  { path: '/articoli', tab: 'articoli', l: 'Anagrafica articoli', ic: '' },
];
const STAFF: Voce[] = [
  { path: '/nuovo', tab: 'nuovo', l: 'Nuovo ordine', ic: 'piu' },
  { path: '/miei', tab: 'miei', l: 'I miei ordini', ic: 'lista' },
  { path: '/disponibilita', tab: 'disponibilita', l: 'Disponibilità', ic: 'magazzino' },
];
/** voci raggiungibili da "Altro" sul telefono */
export const TAB_ALTRO = ['acquisti', 'mercato', 'attrezzatura', 'andamento', 'notifiche', 'anagrafiche', 'articoli', 'impostazioni', 'altro'];

export const logo = (cls: string) => html`<img class="${cls} logo-light" src="/logo-filodape.png" alt="Filodape — dalla natura al miele"
  ><img class="${cls} logo-dark" src="/logo-filodape-chiaro.png" alt="Filodape — dalla natura al miele">`;


export function cornice(contenuto: TemplateResult): TemplateResult {
  const me = stato.me!;
  const admin = me.ruolo === 'admin';
  const tab = stato.pagina?.tab ?? '';
  const tabBasso = admin && TAB_ALTRO.includes(tab) ? 'altro' : tab;
  const corrente = (t: string, sel = tab) => (t === sel ? 'page' : nothing);
  const cnt = (v: Voce) => { const n = v.count?.() ?? 0; return n ? html`<span class="count" aria-label=${`${n} da vedere`}>${n}</span>` : nothing; };
  const prev = precedente();
  const basso = admin ? ADMIN_BASSO : STAFF;
  return html`
  ${stato.online ? nothing : html`<div class="offline" role="status">Sei offline: le modifiche si potranno salvare quando torna la connessione.</div>`}
  <div class="shell">
    <aside class="sidebar" aria-label="Menu">
      <a href=${admin ? '/' : '/nuovo'} style="background:none;padding:0">${logo('logo')}</a>
      <nav>${(admin ? ADMIN_LATO : STAFF).map((v) => typeof v === 'string'
        ? html`<div class="group">${v}</div>`
        : html`<a href=${v.path} aria-current=${corrente(v.tab)}><span>${v.l}</span>${cnt(v)}</a>`)}</nav>
      <div class="foot">
        <div><b>${me.nome}</b>, <span class="small">${admin ? 'titolare' : 'aiutante'}</span></div>
        <a href="/impostazioni" aria-current=${corrente('impostazioni')}>${admin ? 'Impostazioni' : 'Profilo e password'}</a>
        <button class="linkbtn" @click=${esci}>Esci</button>
      </div>
    </aside>
    <div>
      <header class="topbar">
        <a href=${admin ? '/' : '/nuovo'}>${logo('logo')}</a>
        <div class="who">
          ${admin ? html`<a class="bell" href="/notifiche" aria-label="Notifiche">${icon('campana')}${stato.contatori.notifiche ? html`<span class="count">${stato.contatori.notifiche}</span>` : nothing}</a>`
            : html`<a class="bell" href="/impostazioni" aria-label="Profilo e password">${icon('persona')}</a>`}
          <span>${me.nome}</span>
        </div>
      </header>
      <main class="main" id="contenuto">
        ${prev ? html`<button class="back" @click=${prev.azione}>${icon('freccia')}<span>${prev.titolo}</span></button>` : nothing}
        ${contenuto}
      </main>
    </div>
  </div>
  <nav class="bottomnav" aria-label="Menu principale">${basso.map((v) => html`<a href=${v.path} aria-current=${corrente(v.tab, tabBasso)}>
    ${icon(v.ic)}<span>${v.l}</span>${cnt(v)}</a>`)}</nav>`;
}
