/** Andamento: grafici fissi per anno e grafici creati da Filippo (anche in Home). */
import { html, nothing, type TemplateResult } from 'lit-html';
import type { Pagina } from '../app';
import { aggiorna, ricarica } from '../app';
import * as api from '../lib/api';
import { eur, eur0, num, meseBreve, fd } from '../lib/format';
import { messaggioErrore } from '../lib/errors';
import { grafLinee, grafBarre, grafOrizzontale } from '../ui/charts';
import { HOME_DEF } from './home';
import { testa, toast, chiedi, Modulo, scelta } from '../ui/kit';
import type { Grafico, Lotto, Spesa, Vendita } from '../lib/types';

export interface Dati {
  vendite: Vendita[]; spese: Spesa[]; lotti: Lotto[]; usoCespiti: Map<number, number>;
  smielature: { data: string; anno: number; tipo: string; kg: number }[];
}

export async function caricaDati(): Promise<Dati> {
  const [vendite, spese, lotti, sm] = await Promise.all([api.vendite('2000-01-01'), api.spese('2000-01-01'), api.lotti(), api.smielature()]);
  const smielature = sm.map((s) => ({ data: s.data, anno: s.lotto.anno, tipo: s.lotto.tipo.nome, kg: s.bariloni.reduce((a, b) => a + Number(b.kg), 0) }));
  const anni = anniDi({ vendite, spese, lotti, smielature, usoCespiti: new Map() });
  const uso = new Map<number, number>();
  await Promise.all(anni.map(async (a) => uso.set(a, Number(await api.usoCespiti(a)))));
  return { vendite, spese, lotti, smielature, usoCespiti: uso };
}
export function anniDi(d: Dati): number[] {
  const s = new Set<number>([new Date().getFullYear()]);
  d.vendite.forEach((v) => s.add(v.anno)); d.spese.forEach((v) => s.add(v.anno)); d.lotti.forEach((l) => s.add(l.anno));
  return [...s].sort();
}

// ---------------------------------------------------------------- grafici creati dall'utente
export const MISURE: Record<string, { l: string; dims: string[]; f: 'eur' | 'pz' | 'kg' }> = {
  incassi: { l: 'Incassi', dims: ['mese', 'anno', 'tipo_miele', 'formato', 'canale'], f: 'eur' },
  pezzi: { l: 'Pezzi venduti', dims: ['mese', 'anno', 'tipo_miele', 'formato', 'canale'], f: 'pz' },
  kg_smielati: { l: 'Kg smielati', dims: ['mese', 'anno', 'tipo_miele'], f: 'kg' },
  spese: { l: 'Spese', dims: ['mese', 'anno', 'categoria'], f: 'eur' },
  costo_kg: { l: 'Costo al kg dei lotti', dims: ['lotto', 'tipo_miele'], f: 'eur' },
};
export const DIVISIONI: Record<string, string> = {
  mese: 'per mese', anno: 'per anno', tipo_miele: 'per tipo di miele', formato: 'per formato',
  canale: 'per canale di vendita', categoria: 'per categoria', lotto: 'per lotto',
};
const FMT = { eur: (v: number) => eur(v), pz: (v: number) => `${num(v, 0)} pz`, kg: (v: number) => `${num(v, 1)} kg` };
const FMT_ASSE = { eur: (v: number) => eur0(v), pz: (v: number) => num(v, 0), kg: (v: number) => `${num(v, 0)} kg` };

type Def = Pick<Grafico, 'misura' | 'divisione' | 'periodo'>;
const annoDi = (g: Def) => (g.periodo as { anno?: number | null }).anno ?? null;
export function titoloGrafico(g: Def) {
  const a = annoDi(g), d = g.divisione === 'mese' && !a ? 'anno' : g.divisione;
  return `${MISURE[g.misura]?.l ?? g.misura} ${DIVISIONI[d]}, ${a ?? 'tutti gli anni'}`;
}

function aggrega(g: Def, d: Dati) {
  const y = annoDi(g), div = g.divisione === 'mese' && !y ? 'anno' : g.divisione;
  const acc = new Map<string | number, number>();
  const add = (k: string | number, v: number) => acc.set(k, (acc.get(k) ?? 0) + v);
  const chiave = (data: string, anno: number, altro: string) => div === 'mese' ? Number(data.slice(5, 7)) - 1 : div === 'anno' ? anno : altro;
  if (g.misura === 'incassi' || g.misura === 'pezzi') d.vendite.filter((v) => !y || v.anno === y).forEach((v) => {
    const altro = div === 'tipo_miele' ? (v.tipo_miele ?? 'Altri prodotti') : div === 'formato' ? (v.formato ?? 'Altri prodotti') : v.canale === 'cliente' ? 'Clienti' : 'Mercato';
    add(chiave(v.data, v.anno, altro), g.misura === 'incassi' ? Number(v.importo ?? 0) : v.pezzi);
  });
  if (g.misura === 'kg_smielati') d.smielature.filter((s) => !y || s.anno === y).forEach((s) => add(chiave(s.data, s.anno, s.tipo), s.kg));
  if (g.misura === 'spese') d.spese.filter((s) => !y || s.anno === y).forEach((s) => add(chiave(s.data, s.anno, s.categoria_nome), Number(s.totale)));
  if (g.misura === 'costo_kg') {
    const ls = d.lotti.filter((l) => l.kg_smielati > 0 && (!y || l.anno === y));
    if (div === 'lotto') ls.forEach((l) => acc.set(l.codice, Number(l.costo_kg_congelato ?? l.costo_kg_attuale ?? 0)));
    else {
      const w = new Map<string, [number, number]>();
      ls.forEach((l) => { const c = l.stato === 'chiuso' && l.dettaglio_congelato ? l.dettaglio_congelato : l.dettaglio_attuale;
        const x = w.get(l.tipo_miele) ?? [0, 0]; x[0] += Number(c.totale); x[1] += Number(c.kg_vendibili); w.set(l.tipo_miele, x); });
      w.forEach(([t, k], tipo) => acc.set(tipo, k ? t / k : 0));
    }
  }
  return { div, acc };
}

/** Disegna un grafico salvato: linee per i mesi, barre per gli anni, barre orizzontali per i confronti. */
export function vistaGrafico(id: string, g: Def, d: Dati): TemplateResult {
  const { div, acc } = aggrega(g, d), mis = MISURE[g.misura], f = FMT[mis.f], fa = FMT_ASSE[mis.f];
  if (div === 'mese') {
    const ora = new Date(), y = annoDi(g), ultimo = y === ora.getFullYear() ? ora.getMonth() : 11;
    return grafLinee(id, Array.from({ length: 12 }, (_, i) => meseBreve(i)), [{ nome: mis.l, valori: Array.from({ length: 12 }, (_, i) => (i <= ultimo ? acc.get(i) ?? 0 : null)) }], f, fa);
  }
  if (div === 'anno') {
    const ks = [...acc.keys()].map(Number).sort();
    return grafBarre(id, ks.map(String), [{ nome: mis.l, valori: ks.map((k) => acc.get(k) ?? 0) }], f, fa);
  }
  return grafOrizzontale([...acc].map(([l, v]) => ({ l: String(l), v })).sort((a, b) => b.v - a.v), f);
}

// ---------------------------------------------------------------- pagina
export function andamento(q: URLSearchParams): Pagina {
  let d: Dati; let grafici: Grafico[] = []; let home: string[] = []; let anno = Number(q.get('anno')) || new Date().getFullYear();
  let articolo = 0;
  let builder: Modulo<{ misura: string; divisione: string; anno: string }> | null = null;

  const venditeMese = (y: number) => Array.from({ length: 12 }, (_, m) =>
    d.vendite.filter((v) => v.anno === y && v.mese === m + 1).reduce((a, v) => a + Number(v.importo ?? 0), 0));

  async function salvaGrafico() {
    if (!builder) return;
    const b = builder.v;
    const ok = await builder.invia(() => api.salvaGrafico({ titolo: titoloGrafico({ misura: b.misura, divisione: b.divisione, periodo: { anno: b.anno === 'tutti' ? null : Number(b.anno) } }),
      misura: b.misura, divisione: b.divisione, periodo: { anno: b.anno === 'tutti' ? null : Number(b.anno) }, in_home: false }));
    if (ok) { builder = null; toast('Grafico salvato: puoi mostrarlo anche in Home'); ricarica(); }
  }

  return {
    titolo: 'Andamento', tab: 'andamento',
    async carica() { let h: string[] | null; [d, grafici, h] = await Promise.all([caricaDati(), api.grafici(), api.preferenzeHome()]); home = h ?? [...HOME_DEF]; },
    vista() {
      const anni = anniDi(d);
      if (!anni.includes(anno)) anno = anni[anni.length - 1];
      const corr = venditeMese(anno), prec = anni.includes(anno - 1) ? venditeMese(anno - 1) : null;
      const ultimoMese = anno === new Date().getFullYear() ? new Date().getMonth() : 11;
      const serieV = [{ nome: String(anno), valori: corr.map((v, i) => (i <= ultimoMese ? v : null)) }, ...(prec ? [{ nome: String(anno - 1), valori: prec, tratteggio: true }] : [])];
      const speseCat = new Map<string, number>();
      d.spese.filter((s) => s.anno === anno).forEach((s) => speseCat.set(s.categoria_nome, (speseCat.get(s.categoria_nome) ?? 0) + Number(s.totale)));
      const totSpese = [...speseCat.values()].reduce((a, b) => a + b, 0);
      // prezzo di un articolo nel tempo
      const conAcquisti = [...new Map(d.spese.map((s) => [s.articolo_id, s.articolo])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'it'));
      if (!articolo || !conAcquisti.some(([id]) => id === articolo)) articolo = (conAcquisti.find(([, n]) => /vasetto 500/i.test(n)) ?? conAcquisti[0])?.[0] ?? 0;
      const punti = d.spese.filter((s) => s.articolo_id === articolo);
      const unita = punti[0]?.unita ?? 'pz';
      // kg smielati
      const tipi = [...new Set(d.smielature.map((s) => s.tipo))].sort();
      const serieKg = tipi.map((t) => ({ nome: t, valori: anni.map((y) => d.smielature.filter((s) => s.anno === y && s.tipo === t).reduce((a, s) => a + s.kg, 0)) }));
      // incassi e costi
      const inc = anni.map((y) => d.vendite.filter((v) => v.anno === y).reduce((a, v) => a + Number(v.importo ?? 0), 0));
      const cst = anni.map((y) => d.spese.filter((s) => s.anno === y && !s.attrezzatura_pluriennale).reduce((a, s) => a + Number(s.totale), 0) + (d.usoCespiti.get(y) ?? 0));

      return html`
      ${testa('Andamento', { sub: 'Come sta andando, anno per anno. Tocca o passa sopra i grafici per vedere i valori. I primi anni avranno pochi dati: i confronti diventano utili col tempo.',
        azioni: html`<button class="btn" @click=${() => { builder = builder ? null : new Modulo({ misura: 'incassi', divisione: 'tipo_miele', anno: String(anno) }); aggiorna(); }}>${builder ? 'Chiudi' : '+ Nuovo grafico'}</button>` })}
      ${builder ? vistaBuilder(builder, d, anni, salvaGrafico) : nothing}
      <div class="seg" role="group" aria-label="Anno">${anni.map((y) => html`<button aria-pressed=${y === anno ? 'true' : 'false'} @click=${() => { anno = y; history.replaceState(history.state, '', `/andamento?anno=${y}`); aggiorna(); }}>${y}</button>`)}</div>
      <div class="cols">
        <section class="card"><h3>Vendite per mese</h3><p class="small">Incassato da clienti e mercati, ${anno}${prec ? ` rispetto al ${anno - 1}` : ''}</p>
          ${grafLinee('vm', Array.from({ length: 12 }, (_, i) => meseBreve(i)), serieV, (v) => eur(v), (v) => eur0(v))}</section>
        <section class="card"><h3>Spese per categoria</h3><p class="small" style="margin-bottom:var(--space-3)">Pagate nel ${anno}, attrezzatura compresa: ${eur(totSpese)}</p>
          ${grafOrizzontale([...speseCat].map(([l, v]) => ({ l, v })).sort((a, b) => b.v - a.v), (v) => eur0(v))}</section>
        <section class="card"><h3>Prezzo di un articolo</h3>
          ${conAcquisti.length ? html`<div class="field mt"><label for="an-art">Articolo</label>
            <select class="select" id="an-art" @change=${(e: Event) => { articolo = Number((e.target as HTMLSelectElement).value); aggiorna(); }}>
              ${conAcquisti.map(([id, n]) => html`<option value=${id} ?selected=${id === articolo}>${n}</option>`)}</select></div>
            <p class="small">Prezzo per ${unita} pagato a ogni acquisto${punti.length > 1 ? `: ${punti[punti.length - 1].prezzo_unitario >= punti[0].prezzo_unitario ? '+' : ''}${num(((punti[punti.length - 1].prezzo_unitario - punti[0].prezzo_unitario) / punti[0].prezzo_unitario) * 100, 0)}% dal primo` : ''}</p>
            ${grafLinee('pa', punti.map((p) => fd(p.data)), [{ nome: `€ per ${unita}`, valori: punti.map((p) => Number(p.prezzo_unitario)) }], (v) => eur(v), (v) => eur(v))}`
            : html`<p class="chart-empty">Ancora nessun acquisto registrato.</p>`}</section>
        <section class="card"><h3>Miele smielato</h3><p class="small">Kg per tipo di miele e anno</p>
          ${grafBarre('kg', anni.map(String), serieKg, (v) => `${num(v, 1)} kg`, (v) => num(v, 0))}</section>
        <section class="card"><h3>Incassi e costi</h3><p class="small">I costi comprendono il costo d'uso dell'attrezzatura, non il suo acquisto</p>
          ${grafBarre('ic', anni.map(String), [{ nome: 'Incassi', valori: inc }, { nome: 'Costi', valori: cst }], (v) => eur(v), (v) => eur0(v))}
          <p class="small">${anni.map((y, i) => `${y}: restano ${eur(inc[i] - cst[i])}`).join(' · ')}</p></section>
      </div>
      ${grafici.length ? html`<section class="section"><h2>I tuoi grafici</h2><div class="cols">${grafici.map((g) => html`<div class="card">
        <h3>${titoloGrafico(g)}</h3>${vistaGrafico(`g${g.id}`, g, d)}
        <div class="btns"><button class="btn sm" @click=${async () => {
          const k = `g:${g.id}`, c = home.includes(k);
          try { await api.salvaPreferenzeHome(c ? home.filter((x) => x !== k) : [...home, k]); toast(c ? 'Tolto dalla Home' : 'Ora è anche in Home'); ricarica(); } catch (e) { toast(messaggioErrore(e), true); }
        }}>${home.includes(`g:${g.id}`) ? 'Togli dalla Home' : 'Mostra in Home'}</button>
        <button class="btn sm quiet" @click=${async () => {
          if (!(await chiedi('Eliminare il grafico?', titoloGrafico(g), 'Elimina', true))) return;
          try { await api.eliminaGrafico(g.id); if (home.includes(`g:${g.id}`)) await api.salvaPreferenzeHome(home.filter((x) => x !== `g:${g.id}`)); ricarica(); } catch (e) { toast(messaggioErrore(e), true); }
        }}>Elimina</button></div></div>`)}</div></section>` : nothing}`;
    },
  };
}

function vistaBuilder(b: Modulo<{ misura: string; divisione: string; anno: string }>, d: Dati, anni: number[], salva: () => void) {
  const mis = MISURE[b.v.misura];
  if (!mis.dims.includes(b.v.divisione)) b.v.divisione = mis.dims[0];
  const def = { misura: b.v.misura, divisione: b.v.divisione, periodo: { anno: b.v.anno === 'tutti' ? null : Number(b.v.anno) } };
  return html`<section class="card" style="margin-bottom:var(--space-6)"><h3>Nuovo grafico</h3>
    <p class="small">Tre scelte: il tipo di grafico lo decide l'app.</p>
    <div class="row-fields mt">
      ${scelta(b, 'misura', 'Cosa misurare', Object.entries(MISURE).map(([v, m]) => ({ v, l: m.l })))}
      ${scelta(b, 'divisione', 'Come dividerlo', mis.dims.map((v) => ({ v, l: DIVISIONI[v] })))}
      ${scelta(b, 'anno', 'Periodo', [...anni.map((y) => ({ v: String(y), l: String(y) })), { v: 'tutti', l: 'Tutti gli anni' }])}
    </div>
    <p class="small">Anteprima: ${titoloGrafico(def)}</p>
    ${vistaGrafico('anteprima', def, d)}
    <div class="btns"><button class="btn primary" ?disabled=${b.busy} @click=${salva}>Salva il grafico</button></div></section>`;
}
