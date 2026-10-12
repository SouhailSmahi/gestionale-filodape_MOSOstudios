/** Componenti dell'interfaccia: moduli, campi, badge, righe, numeri chiave, toast e dialoghi. */
import { html, nothing, render, type TemplateResult } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import { icon } from './icons';
import { aggiorna, dopoDisegno } from '../app';
import { messaggioErrore } from '../lib/errors';
import type { StatoComanda } from '../lib/types';

export { html, nothing };

// ---------------------------------------------------------------- moduli
type Valori = Record<string, string | boolean | string[]>;

/** Stato di un modulo: valori scritti, errori per campo, invio in corso. */
export class Modulo<V extends Valori> {
  v: V; err: Partial<Record<keyof V | '_', string>> = {}; busy = false; private iniziale: string;
  /** l'errore generale viene dal server (va tolto al nuovo tentativo) o da un controllo (va rispettato) */
  private erroreServer = false;
  constructor(v: V) { this.v = v; this.iniziale = JSON.stringify(v); }
  set<K extends keyof V>(k: K, val: V[K]) { this.v[k] = val; if (this.err[k]) { delete this.err[k]; } aggiorna(); }
  errore(k: keyof V | '_', msg: string) { this.err[k] = msg; }
  get ok() { return !Object.values(this.err).some(Boolean); }
  modificato() { return JSON.stringify(this.v) !== this.iniziale; }
  /** dopo un salvataggio riuscito: i valori attuali diventano quelli "puliti" */
  pulito() { this.iniziale = JSON.stringify(this.v); }
  /** Esegue il salvataggio mostrando l'attesa e l'errore in chiaro. Restituisce true se è andato bene. */
  async invia(fn: () => Promise<unknown>): Promise<boolean> {
    if (this.busy) return false;
    if (this.erroreServer) { delete this.err._; this.erroreServer = false; }
    if (!this.ok) { aggiorna(); scorriAErrore(); return false; }
    this.busy = true; aggiorna();
    try { await fn(); this.pulito(); return true; }
    catch (e) { this.err._ = messaggioErrore(e); this.erroreServer = true; toast(this.err._, true); scorriAErrore(); return false; }
    finally { this.busy = false; aggiorna(); }
  }
}
function scorriAErrore() {
  requestAnimationFrame(() => document.querySelector('.field.err, .note.danger')?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
}

let uid = 0;
const nid = (k: string) => `f-${k}-${++uid}`;
const errBox = (m?: string) => m ? html`<div class="errmsg" role="alert">${icon('allerta')}<span>${m}</span></div>` : nothing;

interface OpzCampo {
  type?: string; unita?: string; hint?: string | TemplateResult; placeholder?: string; inputmode?: string; list?: string;
  min?: string; step?: string; autocomplete?: string; numero?: boolean; obbligatorio?: boolean; max?: string; autofocus?: boolean;
}
/** Campo di testo/numero/data collegato a un modulo. */
export function campo<V extends Valori>(m: Modulo<V>, k: keyof V & string, label: string, o: OpzCampo = {}) {
  const id = nid(k), e = m.err[k];
  const inp = html`<input class="input ${o.numero ? 'numero' : ''}" id=${id} name=${k} type=${o.type || 'text'}
    .value=${live(String(m.v[k] ?? ''))} placeholder=${o.placeholder ?? nothing} inputmode=${o.inputmode ?? (o.numero ? 'decimal' : nothing)}
    list=${o.list ?? nothing} min=${o.min ?? nothing} max=${o.max ?? nothing} step=${o.step ?? nothing} autocomplete=${o.autocomplete ?? 'off'}
    ?autofocus=${!!o.autofocus} aria-invalid=${e ? 'true' : 'false'} aria-describedby=${e ? id + '-e' : nothing}
    @input=${(ev: Event) => m.set(k, (ev.target as HTMLInputElement).value as V[typeof k])}>`;
  return html`<div class="field ${e ? 'err' : ''}">
    <label for=${id}>${label}</label>
    ${o.unita ? html`<div class="unit">${inp}<span>${o.unita}</span></div>` : inp}
    ${o.hint && !e ? html`<div class="hint">${o.hint}</div>` : nothing}
    <div id=${id + '-e'}>${errBox(e)}</div></div>`;
}
export function area<V extends Valori>(m: Modulo<V>, k: keyof V & string, label: string, placeholder = '') {
  const id = nid(k);
  return html`<div class="field"><label for=${id}>${label}</label>
    <textarea class="input" id=${id} placeholder=${placeholder} .value=${live(String(m.v[k] ?? ''))}
      @input=${(ev: Event) => m.set(k, (ev.target as HTMLTextAreaElement).value as V[typeof k])}></textarea></div>`;
}
export interface Opzione { v: string | number; l: string; disabled?: boolean }
export function scelta<V extends Valori>(m: Modulo<V>, k: keyof V & string, label: string, opzioni: Opzione[],
  o: { vuota?: string; hint?: string | TemplateResult; onChange?: (v: string) => void } = {}) {
  const id = nid(k), e = m.err[k], cur = String(m.v[k] ?? '');
  return html`<div class="field ${e ? 'err' : ''}"><label for=${id}>${label}</label>
    <select class="select" id=${id} aria-invalid=${e ? 'true' : 'false'}
      @change=${(ev: Event) => { const v = (ev.target as HTMLSelectElement).value; m.set(k, v as V[typeof k]); o.onChange?.(v); }}>
      ${o.vuota !== undefined ? html`<option value="" ?selected=${cur === ''}>${o.vuota}</option>` : nothing}
      ${opzioni.map((x) => html`<option value=${String(x.v)} ?selected=${String(x.v) === cur} ?disabled=${!!x.disabled}>${x.l}</option>`)}
    </select>
    ${o.hint && !e ? html`<div class="hint">${o.hint}</div>` : nothing}${errBox(e)}</div>`;
}
export function spunta<V extends Valori>(m: Modulo<V>, k: keyof V & string, label: string | TemplateResult) {
  return html`<label class="check"><input type="checkbox" .checked=${live(!!m.v[k])}
    @change=${(ev: Event) => m.set(k, (ev.target as HTMLInputElement).checked as V[typeof k])}><span>${label}</span></label>`;
}
/** Errore generale del modulo (in cima o vicino al bottone). */
export const erroreModulo = (m: Modulo<Valori>) => m.err._ ? html`<div class="note danger" role="alert">${m.err._}</div>` : nothing;
export function bottoneInvio(m: Modulo<Valori>, testo: string, onClick: () => void, cls = 'primary full') {
  return html`<button type="button" class="btn ${cls}" ?disabled=${m.busy} aria-busy=${m.busy ? 'true' : 'false'} @click=${onClick}>${m.busy ? 'Salvataggio…' : testo}</button>`;
}

// ---------------------------------------------------------------- intestazione di pagina
export function testa(titolo: string | TemplateResult, o: { sub?: string | TemplateResult; azioni?: TemplateResult; extra?: TemplateResult } = {}) {
  return html`<div class="page-head"><div class="grow"><div class="title"><h1>${titolo}</h1>${o.extra ?? nothing}</div>
    ${o.sub ? html`<p class="sub">${o.sub}</p>` : nothing}</div>
    ${o.azioni ? html`<div class="actions">${o.azioni}</div>` : nothing}</div>`;
}
export function segmenti<K extends string>(voci: [K, string, number?][], attivo: K, scegli: (k: K) => void, label = 'Filtro') {
  return html`<div class="seg" role="group" aria-label=${label}>${voci.map(([k, l, n]) => html`<button aria-pressed=${k === attivo ? 'true' : 'false'}
    @click=${() => scegli(k)}>${l}${n ? html` <span class="count">${n}</span>` : nothing}</button>`)}</div>`;
}

// ---------------------------------------------------------------- righe, card, numeri
export function riga(o: { t: string | TemplateResult; m?: string | TemplateResult; v?: string | TemplateResult; href?: string; onClick?: () => void; extra?: TemplateResult; cls?: string }) {
  const corpo = html`<div class="body"><div class="t">${o.t}</div>${o.m ? html`<div class="m">${o.m}</div>` : nothing}</div>
    ${o.v !== undefined ? html`<div class="v">${o.v}</div>` : nothing}${o.extra ?? nothing}`;
  if (o.href) return html`<a class="item ${o.cls ?? ''}" href=${o.href}>${corpo}<span class="chev">${icon('avanti')}</span></a>`;
  if (o.onClick) return html`<button class="item ${o.cls ?? ''}" @click=${o.onClick}>${corpo}<span class="chev">${icon('avanti')}</span></button>`;
  return html`<div class="item ${o.cls ?? ''}">${corpo}</div>`;
}
export const lista = (righe: TemplateResult[], vuoto: string | TemplateResult = 'Niente da mostrare.') =>
  righe.length ? html`<div class="list">${righe}</div>` : html`<div class="empty">${vuoto}</div>`;
export function kpi(l: string, n: string | number, href?: string) {
  return href ? html`<a class="kpi" href=${href}><div class="l">${l}</div><div class="n">${n}</div></a>`
    : html`<div class="kpi"><div class="l">${l}</div><div class="n">${n}</div></div>`;
}

const STATI: Record<StatoComanda, [string, string, string]> = {
  in_attesa_conferma: ['In attesa di conferma', 'wait', 'orologio'],
  confermata: ['Confermato', 'ok', 'spunta'],
  in_produzione: ['In produzione', 'prod', 'produzione'],
  parzialmente_evasa: ['Consegnato in parte', 'part', 'mezzo'],
  evasa: ['Consegnato', 'done', 'spunta'],
  annullata: ['Annullato', 'void', 'x'],
};
export const nomeStato = (s: StatoComanda) => STATI[s][0];
export const badgeStato = (s: StatoComanda) => html`<span class="badge ${STATI[s][1]}">${icon(STATI[s][2])}${STATI[s][0]}</span>`;
export const badge = (testo: string, cls = 'plain', ic?: string) => html`<span class="badge ${cls}">${ic ? icon(ic) : nothing}${testo}</span>`;

// ---------------------------------------------------------------- toast e dialoghi
const toastRoot = (() => { const d = document.createElement('div'); d.className = 'toasts'; d.setAttribute('aria-live', 'polite'); document.body.appendChild(d); return d; })();
const toasts: { id: number; testo: string; err: boolean }[] = [];
export function toast(testo: string, err = false) {
  const id = ++uid; toasts.push({ id, testo, err });
  if (toasts.length > 3) toasts.shift();
  disegnaToast();
  setTimeout(() => { const i = toasts.findIndex((t) => t.id === id); if (i >= 0) { toasts.splice(i, 1); disegnaToast(); } }, err ? 6000 : 3200);
}
function disegnaToast() {
  render(html`${toasts.map((t) => html`<div class="toast ${t.err ? 'err' : ''}" role=${t.err ? 'alert' : 'status'}>${icon(t.err ? 'allerta' : 'spunta')}<span>${t.testo}</span></div>`)}`, toastRoot);
}

const dlgRoot = (() => { const d = document.createElement('div'); document.body.appendChild(d); return d; })();
/** Finestra di conferma. Restituisce true se l'utente conferma. */
export function chiedi(titolo: string, testo: string | TemplateResult, ok = 'Conferma', pericolo = false): Promise<boolean> {
  return new Promise((res) => {
    const chiudi = (v: boolean) => { render(nothing, dlgRoot); document.removeEventListener('keydown', esc); res(v); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') chiudi(false); };
    document.addEventListener('keydown', esc);
    render(html`<div class="dialog-back" @click=${(e: Event) => { if (e.target === e.currentTarget) chiudi(false); }}>
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-t">
        <h2 id="dlg-t">${titolo}</h2><div>${testo}</div>
        <div class="btns"><button class="btn quiet" @click=${() => chiudi(false)}>Annulla</button>
        <button class="btn ${pericolo ? 'danger' : 'primary'}" id="dlg-ok" @click=${() => chiudi(true)}>${ok}</button></div>
      </div></div>`, dlgRoot);
    requestAnimationFrame(() => (document.getElementById('dlg-ok') as HTMLButtonElement | null)?.focus());
  });
}

/** Finestra con contenuto libero (moduli brevi). Chiamare la funzione restituita per chiuderla. */
export function finestra(contenuto: () => TemplateResult): { chiudi: () => void; ridisegna: () => void } {
  let aperta = true;
  const chiudi = () => { aperta = false; dopoDisegno.delete(ridisegna); render(nothing, dlgRoot); document.removeEventListener('keydown', esc); };
  const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') chiudi(); };
  const ridisegna = () => { if (aperta) render(html`<div class="dialog-back" @click=${(e: Event) => { if (e.target === e.currentTarget) chiudi(); }}>
    <div class="dialog" role="dialog" aria-modal="true">${contenuto()}</div></div>`, dlgRoot); };
  document.addEventListener('keydown', esc);
  dopoDisegno.add(ridisegna);
  ridisegna();
  requestAnimationFrame(() => (dlgRoot.querySelector('input,select,textarea,button') as HTMLElement | null)?.focus());
  return { chiudi, ridisegna };
}
