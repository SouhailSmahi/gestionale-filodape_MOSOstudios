/** Ordini di Filippo: elenco per stato e scheda con conferma, consegne e pagamenti. */
import { html, nothing, type TemplateResult } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import type { Pagina } from '../app';
import { aggiorna, ricarica } from '../app';
import * as api from '../lib/api';
import { catalogo, nomeVariante, variante } from '../lib/catalogo';
import { eur, fd, fdl, fdt, isoDate, parseNum, numCampo } from '../lib/format';
import { messaggioErrore } from '../lib/errors';
import { icon } from '../ui/icons';
import { testa, badgeStato, badge, segmenti, toast, chiedi, Modulo, campo, erroreModulo, bottoneInvio, riga, lista } from '../ui/kit';
import type { Comanda, Saldo, StatoComanda } from '../lib/types';

type Vista = 'attesa' | 'corso' | 'evasi' | 'saldi' | 'annullati';
const APERTI: StatoComanda[] = ['confermata', 'in_produzione', 'parzialmente_evasa'];

const totale = (o: Comanda) => o.righe.reduce((a, r) => ({ e: a.e + (r.prezzo_unitario_applicato ?? 0) * r.quantita_ordinata, x: a.x || r.prezzo_unitario_applicato == null }), { e: 0, x: false });
const dovuto = (o: Comanda) => o.righe.reduce((a, r) => a + (r.prezzo_unitario_applicato ?? 0) * r.quantita_evasa, 0);
const incassato = (o: Comanda) => o.pagamenti.reduce((a, p) => a + Number(p.importo), 0);
const nomeCliente = (o: Comanda) => `${o.cliente?.nome ?? ''} ${o.cliente?.cognome ?? ''}`.trim();

export function ordini(q: URLSearchParams): Pagina {
  let vista = (q.get('vista') as Vista) || 'attesa';
  let tutte: Comanda[] = []; let saldi: Saldo[] = [];
  const filtri: Record<Vista, (o: Comanda) => boolean> = {
    attesa: (o) => o.stato === 'in_attesa_conferma',
    corso: (o) => APERTI.includes(o.stato),
    evasi: (o) => o.stato === 'evasa' && Date.now() - new Date(o.creata_il).getTime() < 60 * 864e5,
    saldi: (o) => saldi.some((s) => s.comanda_id === o.id && Number(s.saldo) !== 0),
    annullati: (o) => o.stato === 'annullata' && Date.now() - new Date(o.creata_il).getTime() < 60 * 864e5,
  };
  return {
    titolo: 'Ordini', tab: 'ordini',
    async carica() {
      [tutte, saldi] = await Promise.all([api.comande({ daGiorni: 400 }), api.saldiAperti(), catalogo()]) as [Comanda[], Saldo[], unknown];
      // gli aperti più vecchi di 400 giorni restano comunque visibili
      const vecchi = await api.comande({ stati: ['in_attesa_conferma', ...APERTI] });
      vecchi.forEach((o) => { if (!tutte.some((x) => x.id === o.id)) tutte.push(o); });
    },
    vista() {
      const el = tutte.filter(filtri[vista]).sort((a, b) => vista === 'corso'
        ? (a.data_consegna_indicativa ?? '').localeCompare(b.data_consegna_indicativa ?? '') : b.creata_il.localeCompare(a.creata_il));
      const n = (k: Vista) => tutte.filter(filtri[k]).length;
      return html`${testa('Ordini', { azioni: html`<a class="btn" href="/ordini/nuovo">${icon('piu')} Nuovo ordine</a>` })}
        ${segmenti<Vista>([['attesa', 'Da confermare', n('attesa')], ['corso', 'In corso', n('corso')], ['saldi', 'Da incassare', n('saldi')], ['evasi', 'Consegnati di recente'], ['annullati', 'Annullati']],
          vista, (k) => { vista = k; history.replaceState(history.state, '', `/ordini?vista=${k}`); aggiorna(); })}
        ${!el.length ? html`<div class="empty">Nessun ordine in questa sezione.</div>`
          : vista === 'attesa' || vista === 'corso' ? vistaPerCliente(vista, el, tutte)
          : html`<div class="cols">${el.map((o) => cardOrdine(o, saldi.find((s) => s.comanda_id === o.id)))}</div>`}`;
    },
  };
}

function cardOrdine(o: Comanda, s?: Saldo): TemplateResult {
  const t = totale(o);
  return html`<a class="card" href=${`/ordini/${o.id}`} style="display:block;color:inherit;text-decoration:none">
    <div class="card-head"><h3>${nomeCliente(o)}</h3>${badgeStato(o.stato)}</div>
    <div>${o.righe.map((r) => `${nomeVariante(r.variante_id)} × ${r.quantita_ordinata}${r.quantita_evasa && r.quantita_evasa < r.quantita_ordinata ? ` (${r.quantita_evasa} consegnati)` : ''}`).join(', ')}</div>
    <div class="row mt wrap"><span class="small">Inserito da ${o.creatore?.nome ?? '—'} il ${fd(o.creata_il)}${o.data_consegna_indicativa ? html`, consegna <b>${fd(o.data_consegna_indicativa)}</b>` : nothing}</span>
      <b class="num">${eur(t.e)}${t.x ? ' + X' : ''}</b></div>
    ${s && Number(s.saldo) ? html`<div class="small" style="margin-top:4px">${Number(s.saldo) > 0 ? html`<b class="danger-text">Da incassare ${eur(Number(s.saldo))}</b>`
      : o.stato === 'evasa' ? html`<b>Da restituire ${eur(-Number(s.saldo))}</b>` : html`<b>Acconto ricevuto ${eur(-Number(s.saldo))}</b>`}</div>` : nothing}
  </a>`;
}

export function schedaOrdine(p: Record<string, string>): Pagina {
  const id = Number(p.id);
  let o: Comanda;
  let aperto: '' | 'consegna' | 'pagamento' | 'data' = '';
  const mc = new Modulo({ data: '' });
  const mp = new Modulo({ importo: '', nota: '' });
  let qtyCons: Record<number, string> = {};
  let errCons = '';
  let busy = false;

  const esegui = async (fn: () => Promise<unknown>, ok: string) => {
    if (busy) return; busy = true; aggiorna();
    try { await fn(); toast(ok); aperto = ''; await ricarica(); }
    catch (e) { toast(messaggioErrore(e), true); }
    finally { busy = false; aggiorna(); }
  };

  async function conferma(stato: 'confermata' | 'in_produzione') {
    mc.err = {};
    if (!mc.v.data) mc.errore('data', 'Indica la data di consegna indicativa: la vedrà chi ha preso l\'ordine');
    if (await mc.invia(() => api.confermaComanda(id, stato, mc.v.data))) {
      toast(stato === 'in_produzione' ? 'Segnato in produzione' : 'Ordine confermato'); aperto = ''; ricarica();
    }
  }
  async function consegna() {
    errCons = '';
    const righe: { comanda_riga_id: number; quantita: number }[] = [];
    for (const r of o.righe) {
      const res = r.quantita_ordinata - r.quantita_evasa; if (!res) continue;
      const q = Number(qtyCons[r.id] ?? 0);
      if (!Number.isInteger(q) || q < 0) { errCons = `${nomeVariante(r.variante_id)}: scrivi un numero intero`; break; }
      if (q > res) { errCons = `${nomeVariante(r.variante_id)}: restano da consegnare solo ${res} pz`; break; }
      if (q) righe.push({ comanda_riga_id: r.id, quantita: q });
    }
    if (!errCons && !righe.length) errCons = 'Indica almeno un pezzo da consegnare';
    if (errCons) { aggiorna(); return; }
    const tutto = righe.every((x) => { const r = o.righe.find((y) => y.id === x.comanda_riga_id)!; return x.quantita === r.quantita_ordinata - r.quantita_evasa; })
      && righe.length === o.righe.filter((r) => r.quantita_evasa < r.quantita_ordinata).length;
    esegui(() => api.registraConsegna(id, righe), tutto ? 'Consegna completata' : 'Consegna parziale registrata');
  }
  async function pagamento(segno: 1 | -1) {
    mp.err = {};
    const v = parseNum(mp.v.importo);
    if (!v || v <= 0) mp.errore('importo', 'Scrivi un importo maggiore di zero, es. 10,50');
    const imp = segno * Math.round((v ?? 0) * 100) / 100;
    if (await mp.invia(() => api.registraPagamento(id, imp, mp.v.nota.trim()))) {
      const scoperto = Math.max(0, Math.round((dovuto(o) - incassato(o)) * 100) / 100);
      toast(segno < 0 ? 'Resto registrato' : imp <= scoperto ? 'Incasso registrato' : scoperto > 0 ? 'Incasso registrato, con una parte di acconto' : 'Acconto registrato');
      mp.v = { importo: '', nota: '' }; aperto = ''; ricarica();
    }
  }
  async function annulla() {
    if (o.righe.some((r) => r.quantita_evasa)) { toast('Ci sono già consegne registrate: l\'ordine non si può annullare', true); return; }
    if (!(await chiedi('Annullare l\'ordine?', `L'ordine di ${nomeCliente(o)} passa tra gli annullati.`, 'Annulla ordine', true))) return;
    esegui(() => api.annullaComanda(id), 'Ordine annullato');
  }

  const pannelloConsegna = () => html`<div class="formbox mt"><h3 style="margin-bottom:var(--space-3)">Registra consegna</h3>
    ${o.righe.filter((r) => r.quantita_evasa < r.quantita_ordinata).map((r) => {
      const res = r.quantita_ordinata - r.quantita_evasa, g = variante(r.variante_id)?.disponibile ?? 0;
      return html`<div class="field"><label for=${`cq${r.id}`}>${nomeVariante(r.variante_id)}: da consegnare ${res}, pronti ${g}</label>
        <input class="input numero" id=${`cq${r.id}`} type="number" inputmode="numeric" min="0" step="1" .value=${live(qtyCons[r.id] ?? '')}
          @input=${(e: Event) => { qtyCons[r.id] = (e.target as HTMLInputElement).value; errCons = ''; aggiorna(); }}>
        ${Number(qtyCons[r.id] ?? 0) > g ? html`<div class="hint warn">Ne hai pronti solo ${g}: la consegna verrà rifiutata.</div>` : nothing}</div>`;
    })}
    ${errCons ? html`<div class="errmsg" role="alert">${icon('allerta')}<span>${errCons}</span></div>` : nothing}
    <div class="btns"><button class="btn primary" ?disabled=${busy} @click=${consegna}>Conferma consegna</button>
      <button class="btn quiet" @click=${() => { aperto = ''; aggiorna(); }}>Chiudi</button></div></div>`;

  const pannelloPagamento = () => {
    const sal = Math.round((dovuto(o) - incassato(o)) * 100) / 100;
    return html`<div class="formbox mt"><h3 style="margin-bottom:var(--space-3)">${sal > 0 ? 'Incasso' : 'Acconto'}</h3>
    <p class="small" style="margin-bottom:var(--space-3)">${sal > 0
      ? html`Merce consegnata ancora da pagare: <b>${eur(sal)}</b>. Se ricevi di più, la parte in più è un acconto.`
      : html`Non c'è merce consegnata da pagare: quello che registri è un <b>acconto</b> e si scala alle prossime consegne. La consegna si registra a parte.`}</p>
    ${erroreModulo(mp)}
    ${campo(mp, 'importo', 'Importo', { numero: true, unita: '€', placeholder: '10,50' })}
    ${campo(mp, 'nota', 'Nota (facoltativa)', { placeholder: 'Contanti, bonifico…' })}
    <div class="btns">${bottoneInvio(mp, sal > 0 ? 'Registra incasso' : 'Registra acconto', () => pagamento(1), 'primary')}${bottoneInvio(mp, 'Ho dato il resto', () => pagamento(-1), '')}</div></div>`;
  };

  const pannelloData = () => html`<div class="formbox mt">
    ${erroreModulo(mc)}
    ${campo(mc, 'data', o.stato === 'in_attesa_conferma' ? 'Data di consegna indicativa' : 'Nuova data indicativa', { type: 'date', min: isoDate() })}
    ${o.stato === 'in_attesa_conferma' && o.righe.some((r) => r.quantita_ordinata > (variante(r.variante_id)?.disponibile ?? 0))
      ? html`<div class="note" style="margin-bottom:var(--space-3)">La merce pronta non basta per tutto l'ordine: valuta "In produzione".</div>` : nothing}
    <div class="btns">${bottoneInvio(mc, o.stato === 'in_attesa_conferma' ? 'Conferma' : 'Salva come confermato', () => conferma('confermata'), 'primary')}
      ${bottoneInvio(mc, o.stato === 'in_attesa_conferma' ? 'In produzione' : 'Salva in produzione', () => conferma('in_produzione'), '')}
      ${o.stato === 'in_attesa_conferma' ? html`<button class="btn quiet" @click=${annulla}>Annulla ordine</button>`
        : html`<button class="btn quiet" @click=${() => { aperto = ''; aggiorna(); }}>Chiudi</button>`}</div></div>`;

  return {
    titolo: 'Ordine', tab: 'ordini', genitore: { path: '/ordini', titolo: 'Ordini' },
    async carica() {
      [o] = await Promise.all([api.comanda(id), catalogo(true)]) as [Comanda, unknown];
      this.titolo = `Ordine di ${nomeCliente(o)}`;
      mc.v.data = o.data_consegna_indicativa ?? ''; mc.pulito();
      qtyCons = {};
      o.righe.forEach((r) => { const res = r.quantita_ordinata - r.quantita_evasa; qtyCons[r.id] = String(Math.max(0, Math.min(res, variante(r.variante_id)?.disponibile ?? 0))); });
      if (o.stato === 'in_attesa_conferma') aperto = 'data';
    },
    vista() {
      const t = totale(o), dv = dovuto(o), inc = incassato(o), sal = Math.round((dv - inc) * 100) / 100;
      const attivo = APERTI.includes(o.stato);
      return html`${testa(nomeCliente(o), { extra: badgeStato(o.stato),
          sub: html`Inserito da ${o.creatore?.nome ?? '—'} ${fdt(o.creata_il)}${o.cliente?.telefono ? html` · <a class="link-text" href=${`tel:${o.cliente.telefono}`}>${o.cliente.telefono}</a>` : nothing}` })}
      <div class="cols cols-main">
        <div>
          <div class="card">
            <div class="table-wrap"><table class="t"><thead><tr><th>Prodotto</th><th class="r">Pezzi</th><th class="r">Consegnati</th><th class="r">Importo</th></tr></thead>
              <tbody>${o.righe.map((r) => html`<tr><td>${nomeVariante(r.variante_id)}${(o.stato === 'in_attesa_conferma' || attivo) && r.quantita_evasa < r.quantita_ordinata
                  ? html`<div style="margin-top:4px">${chipPronto(r.quantita_ordinata - r.quantita_evasa, variante(r.variante_id)?.disponibile ?? 0)}</div>` : nothing}</td>
                <td class="r">${r.quantita_ordinata}</td><td class="r">${r.quantita_evasa}</td>
                <td class="r">${r.prezzo_unitario_applicato == null ? html`<span class="small">prezzo X</span>` : eur(r.prezzo_unitario_applicato * r.quantita_ordinata)}</td></tr>`)}</tbody>
              <tfoot><tr><td colspan="3">Totale</td><td class="r">${eur(t.e)}${t.x ? ' + X' : ''}</td></tr></tfoot></table></div>
            ${o.data_consegna_indicativa && o.stato !== 'annullata' ? html`<p class="mt">Consegna indicativa: <b>${fdl(o.data_consegna_indicativa)}</b></p>` : nothing}
            ${o.note ? html`<p class="mt"><span class="small">Nota:</span> ${o.note}</p>` : nothing}
          </div>

          ${o.stato === 'in_attesa_conferma' ? html`<section class="section"><h2>Conferma</h2><p class="sub">Scegli quando pensi di consegnare: la data la vede anche chi ha preso l'ordine.</p>${pannelloData()}</section>` : nothing}

          ${attivo || (o.stato === 'evasa' && sal !== 0) ? html`<div class="btns">
            ${attivo ? html`<button class="btn ${aperto === 'consegna' ? 'primary' : ''}" @click=${() => { aperto = aperto === 'consegna' ? '' : 'consegna'; aggiorna(); }}>Registra consegna</button>` : nothing}
            <button class="btn ${aperto === 'pagamento' ? 'primary' : ''}" @click=${() => {
              aperto = aperto === 'pagamento' ? '' : 'pagamento';
              if (aperto && sal > 0 && !mp.v.importo) mp.v.importo = numCampo(sal);
              aggiorna(); }}>${sal > 0 ? 'Incasso' : 'Acconto'}</button>
            ${o.stato === 'confermata' || o.stato === 'in_produzione' ? html`<button class="btn" @click=${() => { aperto = aperto === 'data' ? '' : 'data'; aggiorna(); }}>Cambia data</button>` : nothing}
            ${o.stato === 'confermata' || o.stato === 'in_produzione' ? html`<button class="btn quiet" @click=${annulla}>Annulla ordine</button>` : nothing}
          </div>` : nothing}
          ${aperto === 'consegna' ? pannelloConsegna() : nothing}
          ${aperto === 'pagamento' ? pannelloPagamento() : nothing}
          ${aperto === 'data' && o.stato !== 'in_attesa_conferma' ? pannelloData() : nothing}
        </div>

        <aside class="stack">
          ${o.stato !== 'in_attesa_conferma' && o.stato !== 'annullata' ? html`<div class="card"><h3>Conti</h3><dl class="dl mt">
            <dt>Consegnato</dt><dd>${eur(dv)}</dd><dt>Incassato</dt><dd>${eur(inc)}</dd>
            <dt>${sal > 0 ? 'Da incassare' : sal < 0 ? (o.stato === 'evasa' ? 'Da restituire' : 'Acconto ricevuto') : 'Saldo'}</dt><dd class=${sal > 0 ? 'danger-text strong' : 'strong'}>${sal ? eur(Math.abs(sal)) : 'in pari'}</dd></dl>
            ${sal < 0 && o.stato !== 'evasa' ? html`<p class="small mt">L'acconto si scala da solo man mano che consegni: a fine consegne il saldo torna in pari.</p>` : nothing}</div>` : nothing}
          ${o.consegne.length ? html`<div><h3 style="margin-bottom:var(--space-2)">Consegne</h3>${lista(o.consegne.map((c) => riga({
            t: fdt(c.data_consegna), m: c.righe.map((x) => `${nomeVariante(o.righe.find((r) => r.id === x.comanda_riga_id)?.variante_id ?? 0)} × ${x.quantita}`).join(', ') })))}</div>` : nothing}
          ${o.pagamenti.length ? html`<div><h3 style="margin-bottom:var(--space-2)">Soldi ricevuti e restituiti</h3>${lista(o.pagamenti.map((x) => riga({
            t: html`${Number(x.importo) > 0 ? '+' : ''}${eur(Number(x.importo))} ${badgeMovimento(x)}`,
            m: `${fd(x.data_movimento)}${x.tipo === 'incasso_acconto' ? ` · di cui acconto ${eur(Number(x.quota_acconto))}` : ''}${notaUtile(x.note) ? ` · ${x.note}` : ''}` })))}</div>` : nothing}
        </aside>
      </div>`;
    },
  };
}


// ---------------------------------------------------------------- vista per cliente (Da confermare, In corso)

/** "pronto" se la merce c'è, altrimenti quanti pezzi mancano: si legge senza colore grazie al testo e all'icona. */
function chipPronto(serve: number, pronti: number) {
  return pronti >= serve ? badge('pronto', 'ok', 'spunta') : badge(pronti > 0 ? `ne mancano ${serve - pronti}` : 'da produrre', 'soft', 'orologio');
}

interface Gruppo { id: number; nome: string; telefono: string | null; ordini: Comanda[] }
interface StatoGruppo { data: string; incasso: string; aperto: boolean; err: string; busy: boolean }
const statiGruppo = new Map<string, StatoGruppo>();
const statoGruppo = (k: string, def: () => Partial<StatoGruppo> = () => ({})) => {
  let g = statiGruppo.get(k);
  if (!g) { g = { data: '', incasso: '', aperto: false, err: '', busy: false, ...def() }; statiGruppo.set(k, g); }
  return g;
};

const residuo = (r: Comanda['righe'][number]) => r.quantita_ordinata - r.quantita_evasa;
const dataOrdine = (o: Comanda) => o.data_consegna_indicativa ?? o.creata_il.slice(0, 10);

function raggruppa(el: Comanda[]): Gruppo[] {
  const m = new Map<number, Gruppo>();
  [...el].sort((a, b) => dataOrdine(a).localeCompare(dataOrdine(b)) || a.id - b.id).forEach((o) => {
    const g = m.get(o.cliente_id) ?? { id: o.cliente_id, nome: nomeCliente(o), telefono: o.cliente?.telefono ?? null, ordini: [] };
    g.ordini.push(o); m.set(o.cliente_id, g);
  });
  return [...m.values()];
}

/**
 * Quanti pezzi pronti spettano a ogni riga: la merce in magazzino va prima agli ordini già confermati
 * (dalla consegna più vicina), poi a quelli da confermare (dal più vecchio).
 */
function assegnaPronti(tutte: Comanda[]) {
  const libero = new Map<number, number>();
  const assegnati = new Map<number, number>();
  const prendi = (vid: number) => { if (!libero.has(vid)) libero.set(vid, Math.max(0, variante(vid)?.disponibile ?? 0)); return libero.get(vid)!; };
  const corso = tutte.filter((o) => APERTI.includes(o.stato)).sort((a, b) => dataOrdine(a).localeCompare(dataOrdine(b)) || a.id - b.id);
  const attesa = tutte.filter((o) => o.stato === 'in_attesa_conferma').sort((a, b) => a.creata_il.localeCompare(b.creata_il));
  for (const o of [...corso, ...attesa]) for (const r of o.righe) {
    const serve = residuo(r); if (serve <= 0) continue;
    const p = Math.min(serve, prendi(r.variante_id));
    assegnati.set(r.id, p); libero.set(r.variante_id, prendi(r.variante_id) - p);
  }
  return assegnati;
}

/** Somma per prodotto: quanti pezzi servono e quanti sono già coperti dalla merce pronta. */
function sommaProdotti(ordini: Comanda[], pronti: Map<number, number>) {
  const m = new Map<number, { serve: number; pronti: number }>();
  ordini.forEach((o) => o.righe.forEach((r) => {
    const s = residuo(r); if (s <= 0) return;
    const x = m.get(r.variante_id) ?? { serve: 0, pronti: 0 };
    x.serve += s; x.pronti += pronti.get(r.id) ?? 0; m.set(r.variante_id, x);
  }));
  return [...m].sort((a, b) => nomeVariante(a[0]).localeCompare(nomeVariante(b[0]), 'it'));
}

function vistaPerCliente(vista: 'attesa' | 'corso', el: Comanda[], tutte: Comanda[]): TemplateResult {
  const pronti = assegnaPronti(tutte);
  const gruppi = raggruppa(el);
  const totali = sommaProdotti(el, pronti);
  const mancanti = totali.filter(([, x]) => x.pronti < x.serve).length;
  return html`
    <details class="card more" ?open=${mancanti > 0} style="margin-bottom:var(--space-4)">
      <summary>${vista === 'attesa' ? 'Totale richiesto' : 'Totale da preparare'}: ${totali.reduce((a, [, x]) => a + x.serve, 0)} pezzi
        ${mancanti ? html`· <span class="danger-text">${mancanti} ${mancanti === 1 ? 'prodotto da produrre' : 'prodotti da produrre'}</span>` : html`· tutto pronto`}</summary>
      <div class="list mt">${totali.map(([vid, x]) => html`<div class="item" style="min-height:52px">
        <div class="body"><div class="t">${nomeVariante(vid)} × ${x.serve}</div><div class="m">pronti ${x.pronti}</div></div>${chipPronto(x.serve, x.pronti)}</div>`)}</div>
      ${vista === 'attesa' ? html`<p class="small mt">La merce pronta va prima agli ordini già confermati: qui vedi quella che resta libera.</p>` : nothing}
    </details>
    <div class="cols">${gruppi.map((g) => vista === 'attesa' ? cardDaConfermare(g, pronti) : cardInCorso(g, pronti))}</div>`;
}

function righeProdotti(g: Gruppo, pronti: Map<number, number>) {
  return html`<div class="list" style="margin:var(--space-3) 0">${sommaProdotti(g.ordini, pronti).map(([vid, x]) => html`<div class="item" style="min-height:52px">
    <div class="body"><div class="t">${nomeVariante(vid)} × ${x.serve}</div></div>${chipPronto(x.serve, x.pronti)}</div>`)}</div>`;
}

function elencoOrdini(g: Gruppo) {
  return html`<div class="small">${g.ordini.map((o, i) => html`${i ? html`<br>` : nothing}<a class="link-text" href=${`/ordini/${o.id}`}>Ordine del ${fd(o.creata_il)}</a>
    ${o.creatore?.nome ? html` · ${o.creatore.nome}` : nothing}${o.data_consegna_indicativa ? html` · consegna ${fd(o.data_consegna_indicativa)}` : nothing}
    ${o.stato !== 'in_attesa_conferma' && o.stato !== 'confermata' ? html` · ${o.stato === 'in_produzione' ? 'in produzione' : 'consegnato in parte'}` : nothing}
    ${o.note ? html`<br><span>Nota: ${o.note}</span>` : nothing}`)}</div>`;
}

const testaGruppo = (g: Gruppo, extra: TemplateResult) => html`<div class="card-head"><div><h3>${g.nome}</h3>
    ${g.telefono ? html`<a class="small link-text" href=${`tel:${g.telefono}`}>${g.telefono}</a>` : nothing}</div>${extra}</div>`;

function cardDaConfermare(g: Gruppo, pronti: Map<number, number>): TemplateResult {
  const k = `a${g.id}`, st = statoGruppo(k);
  const ids = g.ordini.map((o) => o.id), n = ids.length;
  const manca = sommaProdotti(g.ordini, pronti).some(([, x]) => x.pronti < x.serve);
  const conferma = async (s: 'confermata' | 'in_produzione') => {
    st.err = '';
    if (!st.data) { st.err = 'Indica la data di consegna indicativa: la vedrà chi ha preso l\'ordine'; aggiorna(); return; }
    if (st.busy) return; st.busy = true; aggiorna();
    try { await api.confermaComande(ids, s, st.data); toast(n > 1 ? `${n} ordini ${s === 'in_produzione' ? 'segnati in produzione' : 'confermati'}` : s === 'in_produzione' ? 'Segnato in produzione' : 'Ordine confermato'); statiGruppo.delete(k); await ricarica(); }
    catch (e) { st.err = messaggioErrore(e); toast(st.err, true); }
    finally { st.busy = false; aggiorna(); }
  };
  return html`<div class="card">
    ${testaGruppo(g, badgeStato('in_attesa_conferma'))}
    ${n > 1 ? html`<p class="small">${n} ordini da confermare insieme</p>` : nothing}
    ${righeProdotti(g, pronti)}
    ${elencoOrdini(g)}
    <div class="field mt ${st.err ? 'err' : ''}"><label for=${`d-${k}`}>Data di consegna indicativa</label>
      <input class="input" id=${`d-${k}`} type="date" min=${isoDate()} .value=${live(st.data)}
        @input=${(e: Event) => { st.data = (e.target as HTMLInputElement).value; st.err = ''; aggiorna(); }}>
      ${st.err ? html`<div class="errmsg" role="alert">${icon('allerta')}<span>${st.err}</span></div>` : nothing}</div>
    ${manca ? html`<div class="note" style="margin-bottom:var(--space-3)">Non tutta la merce è pronta: valuta "In produzione".</div>` : nothing}
    <div class="btns" style="margin-top:0">
      <button class="btn primary" ?disabled=${st.busy} @click=${() => conferma('confermata')}>${st.busy ? 'Salvataggio…' : n > 1 ? `Conferma tutti (${n})` : 'Conferma'}</button>
      <button class="btn" ?disabled=${st.busy} @click=${() => conferma('in_produzione')}>In produzione</button>
    </div></div>`;
}

function cardInCorso(g: Gruppo, pronti: Map<number, number>): TemplateResult {
  const k = `c${g.id}`;
  const ids = g.ordini.map((o) => o.id), n = ids.length;
  // dopo la consegna completa: valore di tutti gli ordini meno quanto già incassato
  const senzaPrezzo = g.ordini.some((o) => totale(o).x);
  const daIncassare = Math.round(g.ordini.reduce((a, o) => a + totale(o).e - incassato(o), 0) * 100) / 100;
  const st = statoGruppo(k, () => ({ incasso: daIncassare > 0 ? numCampo(daIncassare) : '' }));
  const manca = sommaProdotti(g.ordini, pronti).some(([, x]) => x.pronti < x.serve);
  const prima = g.ordini.map((o) => o.data_consegna_indicativa).filter(Boolean).sort()[0] as string | undefined;
  const consegna = async (conIncasso: boolean) => {
    st.err = '';
    const v = conIncasso ? parseNum(st.incasso) : null;
    if (conIncasso && (!v || v <= 0)) { st.err = 'Scrivi quanto hai incassato, es. 26,00 (oppure consegna senza incasso)'; aggiorna(); return; }
    if (st.busy) return; st.busy = true; aggiorna();
    try {
      await api.consegnaComande(ids, v ? Math.round(v * 100) / 100 : null);
      toast(n > 1 ? `${n} ordini consegnati${v ? ' e incassati' : ''}` : `Consegna registrata${v ? ' con incasso' : ''}`);
      statiGruppo.delete(k); await ricarica();
    } catch (e) { st.err = messaggioErrore(e); toast(st.err, true); }
    finally { st.busy = false; aggiorna(); }
  };
  return html`<div class="card">
    ${testaGruppo(g, prima ? html`<span class="pill">consegna ${fd(prima)}</span>` : html`${nothing}`)}
    ${n > 1 ? html`<p class="small">${n} ordini da preparare insieme</p>` : nothing}
    ${righeProdotti(g, pronti)}
    ${elencoOrdini(g)}
    <div class="row mt wrap"><span class="small">Da incassare a consegna completa</span><b class="num">${senzaPrezzo ? (daIncassare > 0 ? `${eur(daIncassare)} + prezzi da definire` : 'prezzo da definire') : daIncassare > 0 ? eur(daIncassare) : 'niente'}</b></div>
    ${manca ? html`<div class="note mt">Manca merce per consegnare tutto: apri il singolo ordine per una consegna parziale.</div>`
      : !st.aperto ? html`<div class="btns"><button class="btn primary" @click=${() => { st.aperto = true; aggiorna(); }}>${n > 1 ? `Consegna tutto (${n} ordini)` : 'Consegna tutto'}</button></div>`
      : html`<div class="formbox mt">
          <div class="field ${st.err ? 'err' : ''}"><label for=${`i-${k}`}>Incassato adesso</label>
            <div class="unit"><input class="input numero" id=${`i-${k}`} inputmode="decimal" placeholder="0,00" .value=${live(st.incasso)}
              @input=${(e: Event) => { st.incasso = (e.target as HTMLInputElement).value; st.err = ''; aggiorna(); }}><span>€</span></div>
            ${st.err ? html`<div class="errmsg" role="alert">${icon('allerta')}<span>${st.err}</span></div>`
              : html`<div class="hint">${n > 1 ? 'L\'importo viene diviso sugli ordini, dal più vecchio.' : 'Se il cliente paga di più, l\'avanzo resta come acconto.'}</div>`}</div>
          <div class="btns" style="margin-top:0">
            <button class="btn primary" ?disabled=${st.busy} @click=${() => consegna(true)}>${st.busy ? 'Salvataggio…' : 'Consegna e incassa'}</button>
            <button class="btn" ?disabled=${st.busy} @click=${() => consegna(false)}>Consegna senza incasso</button>
            <button class="btn quiet" @click=${() => { st.aperto = false; st.err = ''; aggiorna(); }}>Chiudi</button>
          </div></div>`}
  </div>`;
}

// ---------------------------------------------------------------- movimenti di denaro
const ETICHETTE_MOVIMENTO: Record<Comanda['pagamenti'][number]['tipo'], [string, string, string]> = {
  incasso: ['Incasso', 'ok', 'spunta'],
  acconto: ['Acconto', 'soft', 'orologio'],
  incasso_acconto: ['Incasso + acconto', 'soft', 'spunta'],
  resto: ['Resto restituito', 'plain', 'freccia'],
};
/** Etichetta del movimento: si legge anche senza colori grazie al testo. */
const badgeMovimento = (x: Comanda['pagamenti'][number]) => {
  const [t, c, i] = ETICHETTE_MOVIMENTO[x.tipo] ?? ETICHETTE_MOVIMENTO.incasso;
  return badge(t, c, i);
};
/** Le note scritte in automatico ("Incasso", "Resto dato al cliente"…) non aggiungono niente: si mostrano solo quelle vere. */
const notaUtile = (n: string | null) => !!n && !/^(incasso|resto dato al cliente|incasso alla consegna|storico importato)( \(acconto\))?$/i.test(n.trim());
