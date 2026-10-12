/** Magazzino: prodotti pronti, miele sfuso, materiali, materie apistiche, prezzi e costi. */
import { html, nothing, type TemplateResult } from 'lit-html';
import type { Pagina } from '../app';
import { aggiorna, ricarica } from '../app';
import * as api from '../lib/api';
import { catalogo, nomeBreve, gruppo } from '../lib/catalogo';
import { eur, eurCost, fd, kg, num, parseNum, qtyArticolo } from '../lib/format';
import { Modulo, campo, scelta, testa, toast, erroreModulo, bottoneInvio, riga, lista, kpi, segmenti, finestra } from '../ui/kit';
import type * as T from '../lib/types';

type Vista = 'pronti' | 'sfuso' | 'materiali' | 'apistiche' | 'prezzi';

/** Finestra di rettifica: quantità +/− e motivo (lista estendibile con "Altro"). */
function rettifica(o: { titolo: string; unita: string; disponibile: number; magazzino: T.Motivo['magazzino']; motivi: T.Motivo[]; esempio?: string;
  salva: (q: number, motivo: string, note: string) => Promise<unknown> }) {
  const m = new Modulo({ quantita: o.esempio ?? '', motivo: '', altro: '', note: '' });
  const motivi = o.motivi.filter((x) => x.magazzino === o.magazzino);
  const f = finestra(() => html`<h2>Rettifica</h2><p class="sub" style="margin-bottom:var(--space-4)">${o.titolo}: ora ${num(o.disponibile, o.unita === 'pz' ? 0 : 2)} ${o.unita}</p>
    ${erroreModulo(m)}
    ${campo(m, 'quantita', 'Quantità da aggiungere o togliere', { numero: true, inputmode: 'text', unita: o.unita, placeholder: '-2', hint: 'Con il meno per togliere (es. -2), senza per aggiungere (es. 5)' })}
    ${scelta(m, 'motivo', 'Motivo', [...motivi.map((x) => ({ v: x.nome, l: x.nome })), { v: '__altro', l: 'Altro: scrivi il motivo' }], { vuota: 'Scegli…' })}
    ${m.v.motivo === '__altro' ? campo(m, 'altro', 'Motivo', { hint: 'Entra nella lista per le prossime volte' }) : nothing}
    ${campo(m, 'note', 'Note (facoltative)')}
    <div class="btns"><button class="btn quiet" @click=${() => f.chiudi()}>Annulla</button>
    ${bottoneInvio(m, 'Registra rettifica', async () => {
      m.err = {};
      const q = parseNum(m.v.quantita);
      if (!q) m.errore('quantita', 'Scrivi di quanto correggere, per esempio -2 o 5');
      else if (o.unita === 'pz' && !Number.isInteger(q)) m.errore('quantita', 'I pezzi si contano a numeri interi');
      else if (o.disponibile + q < -1e-9) m.errore('quantita', `Non puoi togliere più di ${num(o.disponibile, 2)} ${o.unita}`);
      const motivo = m.v.motivo === '__altro' ? m.v.altro.trim() : m.v.motivo;
      if (!motivo) m.errore(m.v.motivo === '__altro' ? 'altro' : 'motivo', 'Scegli il motivo, o scrivilo con "Altro"');
      if (await m.invia(() => o.salva(q!, motivo, m.v.note.trim()))) { f.chiudi(); toast(`Rettifica registrata: ${motivo}`); ricarica(); }
    }, 'primary')}</div>`);
}

export function prezzo(v: T.Disponibilita) {
  const m = new Modulo({ prezzo: v.prezzo_corrente != null ? num(v.prezzo_corrente, 2) : '' });
  let storico: { prezzo: number; valido_dal: string; valido_al: string | null }[] = [];
  const f = finestra(() => html`<h2>Prezzo: ${nomeBreve(v.prodotto, v.formato)}</h2>
    <p class="sub" style="margin-bottom:var(--space-4)">Il nuovo prezzo vale da adesso: gli ordini già inseriti non cambiano.</p>
    ${erroreModulo(m)}
    ${campo(m, 'prezzo', 'Prezzo di vendita', { numero: true, unita: '€', placeholder: '7,50', hint: 'Lascia vuoto per "prezzo da decidere" (X)' })}
    ${storico.filter((x) => x.valido_al).length ? html`<p class="small">Prezzi precedenti: ${storico.filter((x) => x.valido_al).map((x) => `${eur(Number(x.prezzo))} fino al ${fd(x.valido_al)}`).join(', ')}</p>` : nothing}
    <div class="btns"><button class="btn quiet" @click=${() => f.chiudi()}>Annulla</button>
    ${bottoneInvio(m, 'Salva prezzo', async () => {
      m.err = {};
      const p = m.v.prezzo.trim() ? parseNum(m.v.prezzo) : null;
      if (m.v.prezzo.trim() && (p == null || p < 0)) m.errore('prezzo', 'Scrivi un prezzo valido, per esempio 7,50');
      if (await m.invia(() => api.impostaPrezzo(v.variante_id, p == null ? null : Math.round(p * 100) / 100))) { f.chiudi(); toast('Prezzo aggiornato'); await catalogo(true); ricarica(); }
    }, 'primary')}</div>`);
  api.prezziStorico(v.variante_id).then((s) => { storico = s; f.ridisegna(); }).catch(() => {});
}

function dettaglioCosto(c: T.CostoVasetto, l: T.Lotto | undefined) {
  let sim = '';
  const tot = Number(c.costo_confezione) + Number(c.costo_miele);
  const d = l ? (l.stato === 'chiuso' && l.dettaglio_congelato ? l.dettaglio_congelato : l.dettaglio_attuale) : null;
  const quota = (x: number) => d && Number(d.kg_vendibili) ? (Number(c.peso_kg) * x) / Number(d.kg_vendibili) : 0;
  const f = finestra(() => {
    const s = parseNum(sim);
    return html`<h2>Costo: ${nomeBreve(c.prodotto, c.formato)}</h2>
    <div class="costrows">
      ${(c.componenti ?? []).map((x) => html`<div class="cr"><span class="m">${x.articolo}${Number(x.quantita) !== 1 ? ` × ${num(Number(x.quantita), 2)}` : ''}</span><span class="m">${x.costo_medio == null ? 'nessun acquisto' : eurCost(Number(x.costo_medio) * Number(x.quantita))}</span></div>`)}
      <div class="cr"><span>Confezione</span><span class="v">${eurCost(Number(c.costo_confezione))}</span></div>
      ${l ? html`<div class="cr"><div><div>Miele: ${num(Number(c.peso_kg) * 1000, 0)} g dal lotto ${l.codice}${c.stima ? ' (stima)' : ''}</div>
        <div class="m">di cui quota stagione ${eurCost(quota(Number(d!.quota_stagione)))}, viaggi ${eurCost(quota(Number(d!.viaggi)))}, tempo ${eurCost(quota(Number(d!.ore)))}</div></div>
        <span class="v">${eurCost(Number(c.costo_miele))}</span></div>` : html`<p class="small">Ancora nessun lotto di questo miele: il costo comprende solo la confezione.</p>`}
      <div class="tot"><span>Costo del vasetto</span><span class="v">${eur(tot)}</span></div>
      ${c.prezzo != null ? html`<div class="cr"><span>Margine al prezzo attuale (${eur(Number(c.prezzo))})</span><span class="v">${eur(Number(c.prezzo) - tot)}</span></div>` : nothing}
    </div>
    <div class="field mt"><label for="sim">Se lo vendessi a…</label><div class="unit"><input class="input numero" id="sim" inputmode="decimal" placeholder="7,50"
      @input=${(e: Event) => { sim = (e.target as HTMLInputElement).value; f.ridisegna(); }}><span>€</span></div>
      ${s ? html`<div class="strong">Margine ${eur(s - tot)} (${num(((s - tot) / s) * 100, 0)}%)</div>` : nothing}
      <div class="hint">Solo una simulazione: il prezzo non cambia.</div></div>
    <div class="btns"><button class="btn primary" @click=${() => f.chiudi()}>Chiudi</button></div>`;
  });
}

export function magazzino(q: URLSearchParams): Pagina {
  let vista = (q.get('vista') as Vista) || 'pronti';
  let quadro: T.Quadro[] = [], sfuso: T.MieleSfuso[] = [], giac: T.GiacenzaArticolo[] = [], costi: T.CostoVasetto[] = [];
  let cat: T.Disponibilita[] = [], motivi: T.Motivo[] = [], lotti: T.Lotto[] = [], imp: T.Impostazioni | null = null, quota: T.QuotaStagione | null = null;

  const VOCI: [Vista, string][] = [['pronti', 'Pronti'], ['sfuso', 'Miele sfuso'], ['materiali', 'Materiali'], ['apistiche', 'Materie apistiche'], ['prezzi', 'Prezzi e costi']];

  function vistaArticoli(mag: 'materiali' | 'apistiche'): TemplateResult {
    const el = giac.filter((a) => a.magazzino === mag && !a.archiviato);
    const bassi = el.filter((a) => a.sotto_scorta);
    const valore = el.reduce((s, a) => s + Number(a.valore), 0);
    return html`<p class="sub" style="margin-bottom:var(--space-4)">${mag === 'materiali' ? 'Si caricano con gli acquisti e si scaricano da soli con il confezionamento.' : 'Si caricano con gli acquisti e si scaricano con nutrizione e trattamenti in Produzione.'}
      Valore in magazzino: <b>${eur(valore)}</b> (al costo medio degli acquisti).</p>
      ${bassi.length ? html`<div class="note danger" style="margin-bottom:var(--space-4)">${bassi.length} sotto la scorta minima: ${bassi.map((a) => a.codice ?? a.nome).join(', ')}</div>` : nothing}
      ${lista(el.map((a) => riga({ t: a.nome,
        m: `${a.codice ? `${a.codice} · ` : ''}scorta minima ${a.scorta_minima != null ? qtyArticolo(Number(a.scorta_minima), a.unita) : '—'}${a.costo_medio != null ? ` · costo medio ${eurCost(Number(a.costo_medio))}/${a.unita}` : ''}`,
        v: html`<span class=${a.sotto_scorta ? 'danger-text' : ''}>${qtyArticolo(Number(a.giacenza), a.unita, a.confezioni)}</span>`,
        extra: html`<button class="btn sm quiet" @click=${() => rettifica({ titolo: a.nome, unita: a.unita, disponibile: Number(a.giacenza), magazzino: 'articoli', motivi,
          salva: (x, mo, n) => api.rettificaArticolo(a.articolo_id, x, mo, n) })}>Rettifica</button>` })), 'Nessun articolo in questo magazzino.')}
      <div class="btns"><a class="btn" href="/acquisti/nuovo">Registra un acquisto</a><a class="btn quiet" href="/articoli">Anagrafica articoli</a></div>`;
  }

  return {
    titolo: 'Magazzino', tab: 'magazzino',
    async carica() {
      const a = new Date().getFullYear();
      [quadro, sfuso, giac, costi, cat, motivi, lotti, imp, quota] = await Promise.all([api.quadroDisponibilita(), api.mieleSfuso(), api.giacenzeArticoli(),
        api.costoVasetti(), catalogo(true), api.motivi(), api.lotti(), api.impostazioni(), api.quotaStagione(a)]);
    },
    vista() {
      let corpo: TemplateResult;
      if (vista === 'pronti') {
        const gruppi = new Map<string, T.Disponibilita[]>();
        cat.forEach((c) => gruppi.set(gruppo(c.prodotto), [...(gruppi.get(gruppo(c.prodotto)) ?? []), c]));
        corpo = html`<p class="sub" style="margin-bottom:var(--space-4)">Si caricano dal confezionamento in Produzione e si scaricano con consegne e mercati.</p>
          <div class="cols">${[...gruppi].map(([g, vv]) => html`<section><h2 style="margin-bottom:var(--space-3)">${g}</h2>${lista(vv.map((v) => {
            const qd = quadro.find((x) => x.variante_id === v.variante_id);
            return riga({ t: nomeBreve(v.prodotto, v.formato),
              m: html`${v.codice_articolo}${qd?.da_evadere ? ` · ${qd.da_evadere} da consegnare` : ''}${v.prelevata_mercato ? ` · ${v.prelevata_mercato} al mercato` : ''}${qd?.da_produrre ? html` · <b class="danger-text">da produrre ${qd.da_produrre}</b>` : ''}`,
              v: html`<span class=${v.disponibile ? '' : 'danger-text'}>${v.disponibile} pz</span>`,
              extra: html`<button class="btn sm quiet" @click=${() => rettifica({ titolo: nomeBreve(v.prodotto, v.formato), unita: 'pz', disponibile: v.disponibile, magazzino: 'prodotti', motivi,
                salva: (x, mo, n) => api.rettificaProdotto(v.variante_id, x, mo, n) })}>Rettifica</button>` });
          }))}</section>`)}</div>
          <p class="small mt2">Prima volta? I vasetti già pronti si caricano con una rettifica "Correzione inventario".</p>`;
      } else if (vista === 'sfuso') {
        const el = sfuso.filter((s) => Number(s.kg) > 0.0005);
        const perTipo = new Map<string, number>(); el.forEach((s) => perTipo.set(s.tipo_miele, (perTipo.get(s.tipo_miele) ?? 0) + Number(s.kg)));
        corpo = html`<p class="sub" style="margin-bottom:var(--space-4)">Il miele smielato e non ancora invasettato, lotto per lotto. Il valore usa il costo al kg del lotto.</p>
          ${perTipo.size ? html`<div class="kpis compact" style="margin-bottom:var(--space-5)">${[...perTipo].map(([t, k]) => kpi(t, kg(k)))}</div>` : nothing}
          ${lista(el.map((s) => riga({ t: s.codice, m: `${s.stato === 'chiuso' ? 'Residuo di un lotto chiuso' : 'Lotto aperto'} · valore ${eur(Number(s.valore))}`, v: kg(Number(s.kg), 2),
            extra: s.stato === 'chiuso' ? html`<button class="btn sm quiet" @click=${() => rettifica({ titolo: s.codice, unita: 'kg', disponibile: Number(s.kg), magazzino: 'miele', motivi, esempio: `-${num(Number(s.kg), 2)}`,
              salva: (x, mo, n) => api.rettificaMiele(s.lotto_id, x, mo, n) })}>Usato o scartato</button>` : html`<a class="btn sm" href=${`/produzione/lotti/${s.lotto_id}`}>Apri</a>` })), 'Tutto il miele è invasettato.')}`;
      } else if (vista === 'materiali' || vista === 'apistiche') {
        corpo = vistaArticoli(vista);
      } else {
        corpo = html`<p class="sub" style="margin-bottom:var(--space-4)">Il calcolatore somma confezione e miele (costi del lotto e quota della stagione). I prezzi li decidi sempre tu.</p>
          <div class="card" style="margin-bottom:var(--space-5)"><div class="card-head"><h3>Valori di calcolo</h3><a class="linkbtn" href="/impostazioni">Modifica</a></div>
            <p class="small">Valore della tua ora: ${eur(imp?.valore_ora)}. Attrezzatura al costo ${imp?.costo_netto ? 'netto (prezzo meno contributo)' : 'pieno'}.
              Quota della stagione ${new Date().getFullYear()}: ${eur(quota?.per_kg)} al kg. Tariffe dei mezzi in Anagrafiche.</p></div>
          ${lista(cat.map((v) => {
            const c = costi.find((x) => x.variante_id === v.variante_id);
            const tot = c ? Number(c.costo_confezione) + Number(c.costo_miele) : null;
            const mg = tot != null && v.prezzo_corrente != null ? v.prezzo_corrente - tot : null;
            return riga({ t: nomeBreve(v.prodotto, v.formato),
              m: c ? html`Costo ${eur(tot)}${c.lotto_rif ? `, lotto ${c.lotto_rif}${c.stima ? ' (stima)' : ''}` : ', senza lotto: solo confezione'}` : 'Costo non calcolabile: il prodotto non ha una distinta base',
              v: html`${eur(v.prezzo_corrente)}${mg != null ? html`<small class=${mg < 0 ? 'danger-text' : ''}>margine ${num((mg / v.prezzo_corrente!) * 100, 0)}%</small>` : nothing}`,
              extra: html`<div class="btns" style="margin:0;flex-wrap:nowrap">${c ? html`<button class="btn sm quiet" @click=${() => dettaglioCosto(c, lotti.find((l) => l.codice === c.lotto_rif))}>Dettaglio</button>` : nothing}
                <button class="btn sm" @click=${() => prezzo(v)}>Prezzo</button></div>` });
          }))}`;
      }
      return html`${testa('Magazzino')}
        ${segmenti<Vista>(VOCI.map(([k, l]) => [k, l, k === 'materiali' || k === 'apistiche' ? giac.filter((a) => a.magazzino === k && a.sotto_scorta && !a.archiviato).length : undefined]),
          vista, (k) => { vista = k; history.replaceState(history.state, '', `/magazzino?vista=${k}`); aggiorna(); }, 'Magazzino')}
        ${corpo}`;
    },
  };
}
