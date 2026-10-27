/** Home di Filippo: riquadri scelti da lui, nell'ordine che preferisce. */
import { html, nothing, type TemplateResult } from 'lit-html';
import type { Pagina } from '../app';
import { aggiorna, stato } from '../app';
import * as api from '../lib/api';
import { catalogo, nomeVariante, grammi } from '../lib/catalogo';
import { eur, eur0, fd, fdl, kg, meseBreve, num, qtyArticolo } from '../lib/format';
import { messaggioErrore } from '../lib/errors';
import { icon } from '../ui/icons';
import { testa, kpi, riga, lista, toast, badgeStato } from '../ui/kit';
import { grafLinee } from '../ui/charts';
import { caricaDati, vistaGrafico, titoloGrafico, type Dati } from './andamento';
import type * as T from '../lib/types';

export const HOME_DEF = ['todo', 'kpi', 'produzione'];
const RIQUADRI: Record<string, string> = {
  todo: 'Da fare', kpi: 'Numeri principali', produzione: 'Produzione in corso', venduto: 'Venduto',
  consegne: 'Consegne in arrivo', magazzino: 'Magazzino e ordini', scorte: 'Scorte sotto il minimo',
  acquisti: 'Ultimi acquisti', stagione: 'Costi della stagione', grafico: 'Consegnato dell\'anno',
};

export function home(): Pagina {
  let chiavi: string[] = [];
  let grafici: T.Grafico[] = [];
  let personalizza = false;
  // dati, caricati solo se servono ai riquadri scelti
  let notifiche = 0, daConf = 0, scad: T.Scadenza[] = [], lotti: T.Lotto[] = [], sfuso = 0;
  let giac: T.GiacenzaArticolo[] = [], quadro: T.Quadro[] = [], acq: T.Acquisto[] = [], quota: T.QuotaStagione | null = null;
  let vend: T.Vendita[] = [], dati: Dati | null = null, aperti: T.OrdiniDaIncassare | null = null;
  let per: 'mese' | 'anno' = 'mese';

  const anno = new Date().getFullYear();
  const vuole = (...k: string[]) => k.some((x) => chiavi.includes(x));

  async function salvaChiavi(nuove: string[]) {
    chiavi = nuove; aggiorna();
    try { await api.salvaPreferenzeHome(nuove); await caricaMancanti(); aggiorna(); } catch (e) { toast(messaggioErrore(e), true); }
  }

  async function caricaMancanti() {
    const job: Promise<unknown>[] = [];
    if (vuole('todo', 'kpi')) job.push(api.notificheDaLeggere().then((n) => { notifiche = n.reduce((a, x) => a + x.da_leggere, 0); }),
      api.comande({ stati: ['in_attesa_conferma'] }).then((c) => { daConf = c.length; }));
    if (vuole('kpi', 'consegne')) job.push(api.scadenze().then((s) => { scad = s; }));
    if (vuole('kpi')) job.push(api.mieleSfuso().then((m) => { sfuso = m.reduce((a, x) => a + Number(x.kg), 0); }),
      api.ordiniDaIncassare().then((o) => { aperti = o[0] ?? null; }));
    if (vuole('todo', 'produzione')) job.push(api.lotti().then((l) => { lotti = l; }));
    if (vuole('todo', 'scorte')) job.push(api.giacenzeArticoli().then((g) => { giac = g; }));
    if (vuole('magazzino')) job.push(api.quadroDisponibilita().then((q) => { quadro = q; }));
    if (vuole('acquisti')) job.push(Promise.all([api.acquisti(anno), api.acquisti(anno - 1)]).then(([a, b]) => { acq = [...a, ...b].slice(0, 4); }));
    if (vuole('stagione')) job.push(api.quotaStagione(anno).then((q) => { quota = q; }));
    if (vuole('venduto', 'grafico')) job.push(api.vendite(`${anno - 1}-01-01`).then((v) => { vend = v; }));
    if (chiavi.some((k) => k.startsWith('g:')) && !dati) job.push(caricaDati().then((d) => { dati = d; }));
    job.push(catalogo());
    await Promise.all(job);
  }

  const R: Record<string, () => TemplateResult> = {
    todo() {
      const sotto = giac.filter((a) => a.sotto_scorta && !a.archiviato);
      const daChiudere = lotti.filter((l) => l.stato === 'aperto' && l.ricordami_chiusura);
      const cambiati = lotti.filter((l) => l.dati_cambiati);
      const v: TemplateResult[] = [];
      const apri = (href: string) => html`<a class="btn sm" href=${href}>Apri</a>`;
      if (notifiche) v.push(riga({ t: `${num(notifiche, 0)} ${notifiche === 1 ? 'notifica' : 'notifiche'} da leggere`, extra: apri('/notifiche') }));
      if (daConf) v.push(riga({ t: `${daConf} ${daConf === 1 ? 'ordine' : 'ordini'} da confermare`, m: 'Ti servono la data di consegna', extra: apri('/ordini') }));
      daChiudere.forEach((l) => v.push(riga({ t: `Chiudi il lotto ${l.codice}`, m: 'Servono il miele rimasto e i vasetti tenuti per te', extra: apri(`/produzione/lotti/${l.id}`) })));
      if (sotto.length) v.push(riga({ t: `${sotto.length} ${sotto.length === 1 ? 'articolo' : 'articoli'} sotto la scorta minima`, m: sotto.map((a) => a.codice ?? a.nome).join(', '), extra: apri(`/magazzino?vista=${sotto.some((a) => a.magazzino === 'materiali') ? 'materiali' : 'apistiche'}`) }));
      if (cambiati.length) v.push(riga({ t: `${cambiati.length} ${cambiati.length === 1 ? 'lotto chiuso' : 'lotti chiusi'} con dati cambiati`, m: 'Puoi ricalcolarne il costo', extra: apri('/produzione') }));
      return html`<section><h2 style="margin-bottom:var(--space-3)">Da fare</h2>${lista(v, 'Niente in sospeso.')}</section>`;
    },
    kpi() {
      const o = aperti, n = o?.ordini ?? 0;
      return html`<a class="card totale-ordini" href="/ordini">
          <div class="l">Ordini ancora da incassare</div>
          <div class="n">${eur(Number(o?.totale ?? 0))}</div>
          <div class="small">${n ? html`${n} ${n === 1 ? 'ordine' : 'ordini'} · da confermare ${eur(Number(o!.da_confermare))} · confermati da consegnare ${eur(Number(o!.da_consegnare))} · consegnati da incassare ${eur(Number(o!.consegnati))}`
            : 'Tutti gli ordini sono incassati.'}${o?.pezzi_senza_prezzo ? html`<br><span class="danger-text">${o.pezzi_senza_prezzo} pz senza prezzo non sono nel totale</span>` : nothing}</div>
        </a>
        <div class="kpis">${kpi('Da confermare', daConf, '/ordini')}${kpi('Consegne entro 7 giorni', scad.length, '/ordini?vista=corso')}
        ${kpi('Miele sfuso', kg(sfuso, 0), '/magazzino?vista=sfuso')}</div>`;
    },
    produzione() {
      const ap = lotti.filter((l) => l.stato === 'aperto');
      return html`<section><h2 style="margin-bottom:var(--space-3)">Produzione in corso</h2>
        ${lista(ap.map((l) => riga({ t: l.codice, m: `${l.tipo_miele}: ${kg(l.kg_smielati)} smielati`, v: html`${kg(l.kg_sfuso)}<small>sfusi</small>`, href: `/produzione/lotti/${l.id}` })),
          html`Nessun lotto aperto.<div><a class="btn" href="/produzione">Vai alla produzione</a></div>`)}</section>`;
    },
    venduto() {
      const ora = new Date();
      const r = vend.filter((v) => v.anno === anno && (per === 'anno' || v.mese === ora.getMonth() + 1));
      const pz = r.reduce((a, v) => a + v.pezzi, 0), e = r.reduce((a, v) => a + Number(v.importo ?? 0), 0), k = r.reduce((a, v) => a + Number(v.kg), 0);
      const cl = r.filter((v) => v.canale === 'cliente').reduce((a, v) => a + Number(v.importo ?? 0), 0);
      const senza = r.filter((v) => v.importo == null).reduce((a, v) => a + v.pezzi, 0);
      return html`<section><div class="section-head"><h2>Venduto</h2></div>
        <div class="seg" role="group" aria-label="Periodo">${(['mese', 'anno'] as const).map((p) => html`<button aria-pressed=${per === p ? 'true' : 'false'} @click=${() => { per = p; aggiorna(); }}>${p === 'mese' ? 'Questo mese' : 'Quest\'anno'}</button>`)}</div>
        <div class="kpis compact">${kpi('Euro', eur(e))}${kpi('Pezzi', pz)}${kpi('Chili', num(k, 1))}</div>
        <p class="small mt">Clienti ${eur(cl)}, mercato ${eur(e - cl)}${senza ? `. ${senza} pz venduti senza prezzo non sono nel totale.` : '.'}</p></section>`;
    },
    consegne() {
      const oggi = new Date().toISOString().slice(0, 10);
      return html`<section><h2 style="margin-bottom:var(--space-3)">Consegne in arrivo</h2>
        ${lista(scad.map((s) => riga({ t: s.cliente, m: html`${badgeStato(s.stato)}`, href: `/ordini/${s.id}`,
          v: html`<span class=${s.data_consegna_indicativa < oggi ? 'danger-text' : ''}>${s.data_consegna_indicativa < oggi ? 'In ritardo' : fd(s.data_consegna_indicativa)}</span>` })),
          'Nessuna consegna nei prossimi 7 giorni.')}</section>`;
    },
    magazzino() {
      const r = quadro.filter((q) => q.disponibile || q.da_evadere).sort((a, b) => a.prodotto.localeCompare(b.prodotto) || grammi(a.formato) - grammi(b.formato));
      return html`<section><h2 style="margin-bottom:var(--space-3)">Magazzino e ordini</h2>
        ${lista(r.map((q) => riga({ t: nomeVariante(q.variante_id), m: `${q.disponibile} pronti · ${q.da_evadere} da consegnare${q.prelevata_mercato ? ` · ${q.prelevata_mercato} al mercato` : ''}`,
          v: q.da_produrre ? html`<span class="badge prod">produrre ${q.da_produrre}</span>` : html`${q.disponibile} pz` })), 'Magazzino vuoto.')}</section>`;
    },
    scorte() {
      const s = giac.filter((a) => a.sotto_scorta && !a.archiviato);
      return html`<section><h2 style="margin-bottom:var(--space-3)">Scorte sotto il minimo</h2>
        ${lista(s.map((a) => riga({ t: a.nome, m: `scorta minima ${qtyArticolo(Number(a.scorta_minima), a.unita)}`, v: html`<span class="danger-text">${qtyArticolo(Number(a.giacenza), a.unita)}</span>` })), 'Tutto sopra la scorta minima.')}</section>`;
    },
    acquisti() {
      return html`<section><h2 style="margin-bottom:var(--space-3)">Ultimi acquisti</h2>
        ${lista(acq.map((a) => riga({ t: fd(a.data), m: `${a.fornitore?.nome ?? 'Fornitore non indicato'}: ${a.righe.map((r) => r.articolo.nome).join(', ')}`,
          v: eur(a.righe.reduce((s, r) => s + Number(r.totale), 0)), href: `/acquisti/${a.id}` })), 'Nessun acquisto registrato.')}</section>`;
    },
    stagione() {
      return html`<section><h2 style="margin-bottom:var(--space-3)">Costi della stagione ${anno}</h2><div class="card costrows">
        <div class="cr"><span>Nutrizione e trattamenti</span><span class="v">${eur(quota?.consumi)}</span></div>
        <div class="cr"><span>Mezzi e carburante non legato ai lotti</span><span class="v">${eur(quota?.mezzi)}</span></div>
        <div class="cr"><span>Attrezzatura (costo d'uso)</span><span class="v">${eur(quota?.attrezzatura)}</span></div>
        <div class="cr"><span>Altre spese</span><span class="v">${eur(quota?.altre_spese)}</span></div>
        <div class="tot"><span>${eur(quota?.per_kg)} al kg</span><span class="v">${eur(quota?.totale)}</span></div>
        <p class="small mt">Su ${num(quota?.kg_riferimento ?? 0, 0)} kg di riferimento (media degli ultimi anni).</p></div></section>`;
    },
    grafico() {
      const m = new Date().getMonth();
      const val = Array.from({ length: 12 }, (_, i) => (i > m ? null : vend.filter((v) => v.anno === anno && v.mese === i + 1).reduce((a, v) => a + Number(v.importo ?? 0), 0)));
      return html`<section><h2 style="margin-bottom:var(--space-1)">Consegnato dell'anno</h2>
        <p class="small" style="margin-bottom:var(--space-3)">Valore della merce consegnata, mese per mese (gli ordini non ancora consegnati non ci sono)</p><div class="card">
        ${grafLinee('home-v', Array.from({ length: 12 }, (_, i) => meseBreve(i)), [{ nome: String(anno), valori: val }], (v) => eur(v), (v) => eur0(v))}</div></section>`;
    },
  };

  function riquadro(k: string): TemplateResult {
    if (k.startsWith('g:')) {
      const g = grafici.find((x) => `g:${x.id}` === k);
      if (!g || !dati) return html``;
      return html`<section><h2 style="margin-bottom:var(--space-3)">${titoloGrafico(g)}</h2><div class="card">${vistaGrafico(`h${g.id}`, g, dati)}</div></section>`;
    }
    return R[k]?.() ?? html``;
  }
  const nome = (k: string) => RIQUADRI[k] ?? `Grafico: ${titoloGrafico(grafici.find((g) => `g:${g.id}` === k)!)}`;

  function pannello() {
    const tutti = [...Object.keys(RIQUADRI), ...grafici.map((g) => `g:${g.id}`)];
    const fuori = tutti.filter((k) => !chiavi.includes(k));
    const sposta = (i: number, d: number) => { const a = [...chiavi]; [a[i], a[i + d]] = [a[i + d], a[i]]; salvaChiavi(a); };
    return html`<section class="card section"><h2>Personalizza la Home</h2>
      <p class="sub">Tieni solo quello che ti serve ogni giorno: il resto lo trovi comunque nelle sezioni.</p>
      <div class="list mt">${chiavi.map((k, i) => html`<div class="item"><div class="body"><div class="t">${nome(k)}</div></div>
        <button class="iconbtn" aria-label=${`Sposta su ${nome(k)}`} ?disabled=${i === 0} @click=${() => sposta(i, -1)}>${icon('su')}</button>
        <button class="iconbtn" aria-label=${`Sposta giù ${nome(k)}`} ?disabled=${i === chiavi.length - 1} @click=${() => sposta(i, 1)}>${icon('giu')}</button>
        <button class="btn sm quiet" @click=${() => salvaChiavi(chiavi.filter((x) => x !== k))}>Togli</button></div>`)}</div>
      ${fuori.length ? html`<p class="label mt2">Puoi aggiungere</p><div class="list mt">${fuori.map((k) => html`<div class="item"><div class="body"><div class="t">${nome(k)}</div></div>
        <button class="btn sm" @click=${() => salvaChiavi([...chiavi, k])}>Aggiungi</button></div>`)}</div>` : nothing}
      <div class="btns"><button class="btn primary" @click=${() => { personalizza = false; aggiorna(); }}>Fatto</button>
        <button class="linkbtn" @click=${() => salvaChiavi([...HOME_DEF])}>Torna alla Home di partenza</button></div></section>`;
  }

  return {
    titolo: 'Home', tab: 'home',
    async carica() {
      const [p, g] = await Promise.all([api.preferenzeHome(), api.grafici()]);
      grafici = g;
      chiavi = (p ?? HOME_DEF).filter((k) => RIQUADRI[k] || grafici.some((x) => `g:${x.id}` === k));
      await caricaMancanti();
    },
    vista() {
      const ora = new Date().getHours();
      const saluto = ora < 13 ? 'Buongiorno' : ora < 18 ? 'Buon pomeriggio' : 'Buonasera';
      return html`${testa(`${saluto}, ${stato.me!.nome}`, { sub: fdl(new Date()),
          azioni: personalizza ? undefined : html`<button class="btn" @click=${() => { personalizza = true; aggiorna(); }}>Personalizza la Home</button>` })}
        ${personalizza ? pannello() : nothing}
        <div class="home-grid">${chiavi.map((k) => html`<div class=${k === 'kpi' ? 'w-kpi' : ''}>${riquadro(k)}</div>`)}</div>
        ${chiavi.length ? nothing : html`<div class="empty">La Home è vuota: aggiungi qualche riquadro da "Personalizza la Home".</div>`}`;
    },
  };
}
