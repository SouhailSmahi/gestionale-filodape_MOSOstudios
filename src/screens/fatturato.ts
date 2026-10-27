/** Andamento · Fatturato per anno: fino al 2025 scritto a mano da Filippo, dal 2026 calcolato dagli ordini. */
import { html, nothing, type TemplateResult } from 'lit-html';
import { aggiorna, ricarica } from '../app';
import * as api from '../lib/api';
import { eur, eur0, fd, num, numCampo, parseNum } from '../lib/format';
import { grafBarre } from '../ui/charts';
import { icon } from '../ui/icons';
import { Modulo, campo, erroreModulo, chiedi, toast, badge } from '../ui/kit';
import type { FatturatoAnno, ModificaFatturato, OrdiniAnno } from '../lib/types';

/** Primo anno calcolato dall'app: prima si scrive a mano (lo controlla anche il database). */
const PRIMO_AUTO = 2026;

export interface StatoFatturato {
  anni: FatturatoAnno[]; modifiche: ModificaFatturato[]; ordini: OrdiniAnno[];
  scelti: Set<number> | null;              // null = scelta iniziale (ultimi due anni)
  modulo: Modulo<{ anno: string; importo: string; nota: string }> | null;
  nuovo: boolean;                          // il modulo aggiunge un anno nuovo
}

export const statoFatturato = (): StatoFatturato => ({ anni: [], modifiche: [], ordini: [], scelti: null, modulo: null, nuovo: false });

export async function caricaFatturato(s: StatoFatturato) {
  [s.anni, s.modifiche, s.ordini] = await Promise.all([api.fatturatoAnni(), api.modificheFatturato(), api.ordiniAnno()]);
}

const annoCorrente = () => new Date().getFullYear();
const etichetta = (a: number) => (a === annoCorrente() && a >= PRIMO_AUTO ? `${a} (finora)` : String(a));

function variazione(ora: number, prima: number | undefined) {
  if (prima == null || prima <= 0) return null;
  const p = ((ora - prima) / prima) * 100;
  return `${p >= 0 ? '+' : '−'}${num(Math.abs(p), 0)}%`;
}

export function schedaFatturato(s: StatoFatturato): TemplateResult {
  const tutti = [...s.anni].sort((a, b) => a.anno - b.anno);
  const elenco = tutti.map((x) => x.anno);
  if (!s.scelti) s.scelti = new Set(elenco.slice(-2));
  const scelti = tutti.filter((x) => s.scelti!.has(x.anno));
  const scegli = (a: number) => {
    const n = new Set(s.scelti!);
    if (n.has(a)) { if (n.size > 1) n.delete(a); } else n.add(a);
    s.scelti = n; aggiorna();
  };

  const apri = (a?: FatturatoAnno) => {
    s.nuovo = !a;
    s.modulo = new Modulo({ anno: a ? String(a.anno) : String(Math.min(PRIMO_AUTO - 1, (elenco.find((y) => y < PRIMO_AUTO) ?? PRIMO_AUTO) - 1)),
      importo: a ? numCampo(a.venduto) : '', nota: a?.nota ?? '' });
    aggiorna();
  };

  return html`<section class="card" style="margin-bottom:var(--space-6)">
    <div class="card-head"><h3>Fatturato per anno</h3>
      <button class="btn sm" @click=${() => (s.modulo ? ((s.modulo = null), aggiorna()) : apri())}>${s.modulo ? 'Chiudi' : '+ Anno passato'}</button></div>
    <p class="small">Totale venduto. Fino al ${PRIMO_AUTO - 1} è scritto a mano; dal ${PRIMO_AUTO} lo calcola l'app dagli ordini confermati
      (conta la data dell'ordine) e dalle vendite al mercato.</p>

    ${s.modulo ? moduloFatturato(s) : nothing}

    ${tutti.length ? html`
      <div class="seg mt" role="group" aria-label="Anni da vedere o confrontare">
        ${tutti.map((x) => html`<button aria-pressed=${s.scelti!.has(x.anno) ? 'true' : 'false'} @click=${() => scegli(x.anno)}>${x.anno}</button>`)}</div>
      <p class="small" style="margin-top:calc(-1 * var(--space-3))">Tocca gli anni per vederne uno solo o confrontarne più insieme.</p>
      ${scelti.length > 1 ? grafBarre('fatt', scelti.map((x) => etichetta(x.anno)), [{ nome: 'Venduto', valori: scelti.map((x) => Number(x.venduto)) }], (v) => eur(v), (v) => eur0(v)) : nothing}
      <div class="list mt">${[...scelti].reverse().map((x) => rigaAnno(x, tutti, () => apri(x)))}</div>`
    : html`<p class="chart-empty">Ancora nessun dato: aggiungi il totale di un anno passato.</p>`}
  </section>`;
}

function rigaAnno(x: FatturatoAnno, tutti: FatturatoAnno[], modifica: () => void): TemplateResult {
  const prec = tutti.find((y) => y.anno === x.anno - 1);
  const inCorso = x.anno === annoCorrente() && x.fonte === 'automatico';
  // l'anno in corso non è confrontabile in percentuale con un anno intero
  const v = inCorso ? null : variazione(Number(x.venduto), prec ? Number(prec.venduto) : undefined);
  const dettaglio = x.fonte === 'automatico'
    ? html`Ordini ${eur(Number(x.venduto_ordini))} · mercato ${eur(Number(x.venduto_mercato))} · già incassato ${eur(Number(x.incassato))}
        ${x.pezzi_senza_prezzo ? html`<br><span class="danger-text">${x.pezzi_senza_prezzo} pezzi senza prezzo non sono contati</span>` : nothing}`
    : html`${x.nota ? html`${x.nota} · ` : nothing}${x.aggiornato_il ? `aggiornato il ${fd(x.aggiornato_il)}` : ''}`;
  return html`<div class="item">
    <div class="body"><div class="t">${etichetta(x.anno)} ${x.fonte === 'automatico' ? badge('automatico', 'ok', 'spunta') : badge('scritto a mano', 'soft', 'matita')}</div>
      <div class="m">${dettaglio}</div></div>
    <div class="v">${eur(Number(x.venduto))}${v ? html`<small>${v} sul ${x.anno - 1}</small>` : inCorso ? html`<small>anno in corso</small>` : nothing}</div>
    ${x.fonte === 'manuale' ? html`<button class="iconbtn" aria-label=${`Modifica il fatturato ${x.anno}`} @click=${modifica}>${icon('matita')}</button>` : nothing}
  </div>`;
}

function moduloFatturato(s: StatoFatturato): TemplateResult {
  const m = s.modulo!;
  const anno = Number(m.v.anno);
  const esistente = s.anni.find((x) => x.anno === anno && x.fonte === 'manuale');
  const storia = s.modifiche.filter((x) => x.anno === anno).slice(0, 5);

  async function salva() {
    m.err = {};
    const a = Number(m.v.anno), imp = parseNum(m.v.importo);
    if (!Number.isInteger(a) || a < 1990) m.errore('anno', 'Scrivi l\'anno, es. 2024');
    else if (a >= PRIMO_AUTO) m.errore('anno', `Dal ${PRIMO_AUTO} il fatturato lo calcola l'app: si scrive a mano solo fino al ${PRIMO_AUTO - 1}`);
    if (imp == null || imp < 0) m.errore('importo', 'Scrivi il totale venduto, es. 8.500,00');
    if (s.nuovo && !m.err.anno && s.anni.some((x) => x.anno === a && x.fonte === 'manuale')) m.errore('anno', 'Questo anno c\'è già: usa la matita accanto per correggerlo');
    const ok = await m.invia(() => api.impostaFatturatoStorico(a, Math.round((imp ?? 0) * 100) / 100, m.v.nota.trim()));
    if (!ok) return;
    toast(`Fatturato ${a} salvato`);
    s.modulo = null; s.scelti?.add(a); await ricarica();
  }
  async function togli() {
    if (!(await chiedi(`Togliere il fatturato ${anno}?`, 'Il valore sparisce dai confronti. La modifica resta registrata.', 'Togli', true))) return;
    const ok = await m.invia(() => api.impostaFatturatoStorico(anno, null));
    if (!ok) return;
    toast(`Fatturato ${anno} tolto`); s.modulo = null; s.scelti?.delete(anno); await ricarica();
  }

  return html`<div class="formbox mt">
    <h4 style="margin-bottom:var(--space-3)">${s.nuovo ? 'Aggiungi un anno passato' : `Fatturato ${anno}`}</h4>
    <div class="row-fields">
      ${s.nuovo ? campo(m, 'anno', 'Anno', { inputmode: 'numeric', numero: true, placeholder: String(PRIMO_AUTO - 1) }) : nothing}
      ${campo(m, 'importo', 'Totale venduto', { numero: true, unita: '€', placeholder: '0,00', autofocus: true })}
    </div>
    ${campo(m, 'nota', 'Nota (facoltativa)', { placeholder: 'Es. indicativo, dai conti di fine anno' })}
    ${erroreModulo(m)}
    <div class="btns" style="margin-top:0">
      <button class="btn primary" ?disabled=${m.busy} @click=${salva}>${m.busy ? 'Salvataggio…' : 'Salva'}</button>
      ${!s.nuovo && esistente ? html`<button class="btn quiet" ?disabled=${m.busy} @click=${togli}>Togli il valore</button>` : nothing}
    </div>
    ${storia.length ? html`<details class="more mt"><summary>Modifiche precedenti (${storia.length})</summary>
      <ul class="small" style="padding-left:var(--space-5)">${storia.map((x) => html`<li>${fd(x.modificato_il)}${x.autore?.nome ? `, ${x.autore.nome}` : ''}:
        ${x.importo_prima == null ? 'inserito' : eur(Number(x.importo_prima))} → ${x.importo_dopo == null ? 'tolto' : eur(Number(x.importo_dopo))}${x.nota ? ` (${x.nota})` : ''}</li>`)}</ul></details>` : nothing}
  </div>`;
}

/** Valore di tutti gli ordini inseriti in ogni anno (annullati esclusi), anche quelli da confermare. */
export function schedaValoreOrdini(s: StatoFatturato): TemplateResult {
  if (!s.ordini.length) return html`${nothing}`;
  return html`<section class="card" style="margin-bottom:var(--space-6)">
    <h3>Valore ordini dell'anno</h3>
    <p class="small">Tutti gli ordini inseriti nell'anno, anche quelli ancora da confermare (gli annullati no). Il fatturato qui sopra conta solo quelli confermati.</p>
    <div class="list mt">${[...s.ordini].sort((a, b) => b.anno - a.anno).map((o) => html`<div class="item">
      <div class="body"><div class="t">${etichetta(o.anno)}</div>
        <div class="m">${o.ordini} ordini · consegnati ${eur(Number(o.consegnato))} · da consegnare ${eur(Number(o.da_consegnare))} · da confermare ${eur(Number(o.da_confermare))}</div></div>
      <div class="v">${eur(Number(o.totale))}</div></div>`)}</div>
  </section>`;
}
