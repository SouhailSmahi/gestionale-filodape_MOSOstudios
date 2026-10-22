/**
 * Nucleo dell'app: profilo dell'utente, router con URL veri, ciclo di disegno.
 * Ogni pagina è un oggetto { titolo, carica?, vista } creato a ogni visita (dati sempre freschi).
 */
import { render, html, type TemplateResult } from 'lit-html';
import type { Profilo } from './lib/types';
import { messaggioErrore } from './lib/errors';
import { controllaVersione, versioneNuova, ricaricaConVersioneNuova } from './lib/versione';

export interface Pagina {
  titolo: string;
  /** voce del menu da evidenziare */
  tab?: string;
  /** dove porta "indietro" quando la pagina è aperta da un link diretto */
  genitore?: { path: string; titolo: string };
  carica?: () => Promise<void>;
  vista: () => TemplateResult;
  /** true se ci sono modifiche non salvate (chiede conferma prima di uscire) */
  modificata?: () => boolean;
}
export type Fabbrica = (p: Record<string, string>, q: URLSearchParams) => Pagina;
export interface Rotta { path: string; ruolo: 'admin' | 'staff' | 'tutti'; f: Fabbrica }

export const stato = {
  me: null as Profilo | null,
  pagina: null as Pagina | null,
  caricamento: false,
  errore: '' as string,
  contatori: { notifiche: 0, daConfermare: 0 },
  online: navigator.onLine,
  /** c'è una versione nuova dell'app, ma ci sono modifiche non salvate: si mostra l'avviso */
  aggiornamento: false,
};

let rotte: Rotta[] = [];
let shell: (contenuto: TemplateResult) => TemplateResult = (c) => c;
let root: HTMLElement;
let onNav: () => void = () => {};

export function avvia(opts: { root: HTMLElement; rotte: Rotta[]; shell: typeof shell; dopoNavigazione: () => void }) {
  root = opts.root; rotte = opts.rotte; shell = opts.shell; onNav = opts.dopoNavigazione;
  window.addEventListener('popstate', (e) => {
    const i = (e.state && typeof e.state.i === 'number') ? e.state.i : 0;
    if (stato.pagina?.modificata?.() && !confirm('Hai modifiche non salvate. Vuoi uscire lo stesso?')) {
      history.pushState({ i: pila.i }, '', pila.voci[pila.i]?.path ?? location.pathname);
      return;
    }
    pila.i = i; salvaPila();
    apri(location.pathname + location.search);
  });
  window.addEventListener('online', () => { stato.online = true; aggiorna(); });
  window.addEventListener('offline', () => { stato.online = false; aggiorna(); });
  // versione nuova: si controlla quando l'app torna in primo piano e ogni 15 minuti
  const verifica = async () => {
    if (!(await controllaVersione(true))) return;
    if (stato.pagina?.modificata?.()) { stato.aggiornamento = true; aggiorna(); return; }
    ricaricaConVersioneNuova();
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') verifica(); });
  setInterval(() => { if (document.visibilityState === 'visible') controllaVersione().then((n) => { if (n) { stato.aggiornamento = true; aggiorna(); } }); }, 15 * 60_000);
  window.addEventListener('beforeunload', (e) => { if (stato.pagina?.modificata?.()) e.preventDefault(); });
  document.addEventListener('click', (e) => {
    // link interni senza ricaricare la pagina
    const a = (e.target as HTMLElement).closest('a');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || a.target) return;
    const href = a.getAttribute('href');
    if (!href || !href.startsWith('/') || href.startsWith('//')) return;
    e.preventDefault();
    vai(href);
  });
  if (!history.state || typeof history.state.i !== 'number') history.replaceState({ i: pila.i }, '');
}

// ---------------------------------------------------------------- pila per il tasto "indietro"
const pila: { i: number; voci: { path: string; titolo: string }[] } = (() => {
  try { const s = JSON.parse(sessionStorage.getItem('filodape-pila') || ''); if (s && Array.isArray(s.voci)) return s; } catch { /* nuova */ }
  return { i: 0, voci: [] };
})();
function salvaPila() { try { sessionStorage.setItem('filodape-pila', JSON.stringify(pila)); } catch { /* facoltativo */ } }

export function precedente(): { titolo: string; azione: () => void } | null {
  const prev = pila.i > 0 ? pila.voci[pila.i - 1] : null;
  if (prev && prev.titolo) return { titolo: prev.titolo, azione: () => history.back() };
  const g = stato.pagina?.genitore;
  if (g) return { titolo: g.titolo, azione: () => vai(g.path, { replace: true }) };
  return null;
}

/** Naviga a un percorso interno. */
export function vai(path: string, o: { replace?: boolean } = {}) {
  if (!o.replace && path === location.pathname + location.search) { apri(path); return; }
  if (stato.pagina?.modificata?.() && !confirm('Hai modifiche non salvate. Vuoi uscire lo stesso?')) return;
  if (o.replace) {
    history.replaceState({ i: pila.i }, '', path);
  } else {
    pila.i += 1; pila.voci.length = pila.i;
    history.pushState({ i: pila.i }, '', path);
  }
  pila.voci[pila.i] = { path, titolo: '' };
  salvaPila();
  // cambio pagina: momento sicuro per passare alla versione nuova
  if (versioneNuova()) { ricaricaConVersioneNuova(path); return; }
  apri(path);
  controllaVersione();
  window.scrollTo(0, 0);
}

function trova(pathname: string): { r: Rotta; p: Record<string, string> } | null {
  for (const r of rotte) {
    const a = r.path.split('/'), b = pathname.replace(/\/$/, '').split('/');
    if (r.path === '/' && (pathname === '/' || pathname === '')) return { r, p: {} };
    if (a.length !== b.length) continue;
    const p: Record<string, string> = {};
    if (a.every((s, k) => (s.startsWith(':') ? ((p[s.slice(1)] = decodeURIComponent(b[k])), true) : s === b[k]))) return { r, p };
  }
  return null;
}

let generazione = 0;
/** Crea la pagina del percorso corrente e ne carica i dati. */
export async function apri(full = location.pathname + location.search) {
  const url = new URL(full, location.origin);
  const me = stato.me;
  let m = trova(url.pathname);
  const consentita = (r: Rotta) => r.ruolo === 'tutti' || (me && (r.ruolo === me.ruolo || me.ruolo === 'admin'));
  if (!m || !consentita(m.r)) {
    const home = me?.ruolo === 'admin' ? '/' : '/nuovo';
    history.replaceState({ i: pila.i }, '', home);
    m = trova(home);
    if (!m) return;
  }
  const g = ++generazione;
  const pagina = m.r.f(m.p, url.searchParams);
  stato.pagina = pagina; stato.errore = ''; stato.caricamento = !!pagina.carica;
  pila.voci[pila.i] = { path: url.pathname + url.search, titolo: pagina.titolo }; salvaPila();
  document.title = `${pagina.titolo} · Filodape`;
  aggiorna();
  onNav();
  if (pagina.carica) {
    try { await pagina.carica(); }
    catch (e) { if (g === generazione) stato.errore = messaggioErrore(e); }
    if (g !== generazione) return;
    stato.caricamento = false;
    document.title = `${pagina.titolo} · Filodape`;
    pila.voci[pila.i].titolo = pagina.titolo; salvaPila();
    aggiorna();
  }
}

/** Ricarica i dati della pagina corrente senza cambiare indirizzo. */
export async function ricarica() {
  const p = stato.pagina;
  if (!p?.carica) { aggiorna(); return; }
  try { await p.carica(); } catch (e) { stato.errore = messaggioErrore(e); }
  aggiorna();
}

let programmato = false;
/** Ridisegna lo schermo (raggruppa più chiamate nello stesso istante). */
export function aggiorna() {
  if (programmato) return;
  programmato = true;
  queueMicrotask(() => { programmato = false; disegna(); });
}
function disegna() {
  const p = stato.pagina;
  let contenuto: TemplateResult;
  if (!p) contenuto = html`<div class="loading">Caricamento</div>`;
  else if (stato.errore) contenuto = html`<div class="note danger" role="alert">${stato.errore}</div>
    <div class="btns"><button class="btn" @click=${() => apri()}>Riprova</button></div>`;
  else if (stato.caricamento) contenuto = html`<div class="loading" aria-live="polite">Caricamento</div>`;
  else contenuto = p.vista();
  render(shell(contenuto), root);
  dopoDisegno.forEach((f) => f());
}
/** funzioni chiamate dopo ogni ridisegno (es. finestre aperte sopra la pagina) */
export const dopoDisegno = new Set<() => void>();
