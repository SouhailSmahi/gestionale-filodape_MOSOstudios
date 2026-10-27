/** Mercato, attrezzatura, notifiche e menu "Altro" del telefono. */
import { html, nothing } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import type { Pagina } from '../app';
import { aggiorna, ricarica, stato } from '../app';
import * as api from '../lib/api';
import { catalogo, nomeBreve, nomeVariante } from '../lib/catalogo';
import { rif, carica } from '../lib/rif';
import { eur, fd, fdl, isoDate, parseNum, numCampo } from '../lib/format';
import { messaggioErrore } from '../lib/errors';
import { icon } from '../ui/icons';
import { esci } from './login';
import { Modulo, campo, scelta, area, testa, toast, chiedi, erroreModulo, bottoneInvio, riga, lista, kpi, badge, finestra, segmenti } from '../ui/kit';
import type * as T from '../lib/types';

// ---------------------------------------------------------------- mercato
export function mercato(): Pagina {
  let sessioni: T.Mercato[] = []; let cat: T.Disponibilita[] = [];
  const m = new Modulo({ luogo: 'Mercato di Udine', data: isoDate() });
  const qta: Record<number, string> = {}; const rese: Record<number, string> = {};
  let errQ = '', errR = '';
  const venduto = (s: T.Mercato) => s.righe.reduce((a, r) => ({ pz: a.pz + r.quantita_prelevata - (r.quantita_resa ?? 0), e: a.e + (r.quantita_prelevata - (r.quantita_resa ?? 0)) * Number(r.prezzo_unitario_applicato ?? 0), x: a.x || (r.prezzo_unitario_applicato == null && r.quantita_prelevata > (r.quantita_resa ?? 0)) }), { pz: 0, e: 0, x: false });

  async function preleva() {
    m.err = {}; errQ = '';
    if (!m.v.luogo.trim()) m.errore('luogo', 'Scrivi dove si tiene il mercato');
    const righe: { variante_id: number; quantita_prelevata: number }[] = [];
    for (const v of cat) {
      const raw = qta[v.variante_id]; if (!raw) continue;
      const q = Number(raw);
      if (!Number.isInteger(q) || q < 0) { errQ = `${nomeBreve(v.prodotto, v.formato)}: scrivi un numero intero`; break; }
      if (q > v.disponibile) { errQ = `${nomeBreve(v.prodotto, v.formato)}: disponibili solo ${v.disponibile} pz`; break; }
      if (q) righe.push({ variante_id: v.variante_id, quantita_prelevata: q });
    }
    if (!errQ && !righe.length) errQ = 'Indica almeno un prodotto da portare';
    if (errQ) m.errore('_', errQ);
    if (await m.invia(() => api.apriMercato(m.v.luogo.trim(), m.v.data, righe))) { toast('Merce prelevata per il mercato'); Object.keys(qta).forEach((k) => delete qta[+k]); ricarica(); }
  }
  async function chiudi(s: T.Mercato) {
    errR = '';
    const r: { variante_id: number; quantita_resa: number }[] = [];
    for (const x of s.righe) {
      const raw = rese[x.variante_id] ?? '';
      if (raw === '') { errR = `Scrivi quanti ${nomeVariante(x.variante_id)} riporti a casa (anche 0)`; break; }
      const q = Number(raw);
      if (!Number.isInteger(q) || q < 0 || q > x.quantita_prelevata) { errR = `${nomeVariante(x.variante_id)}: il residuo va da 0 a ${x.quantita_prelevata}`; break; }
      r.push({ variante_id: x.variante_id, quantita_resa: q });
    }
    if (errR) { aggiorna(); return; }
    try { await api.chiudiMercato(s.id, r); toast('Mercato chiuso'); await catalogo(true); ricarica(); } catch (e) { toast(messaggioErrore(e), true); }
  }

  return {
    titolo: 'Mercato', tab: 'mercato',
    async carica() { [sessioni, cat] = await Promise.all([api.mercati(), catalogo(true)]); },
    vista() {
      const aperta = sessioni.find((s) => s.stato === 'aperta');
      const passate = sessioni.filter((s) => s.stato === 'chiusa');
      const top = aperta ? html`<section class="card"><div class="card-head"><h2>${aperta.luogo}</h2>${badge('In corso', 'soft', 'orologio')}</div>
          <p class="sub">${fdl(aperta.data)}. La merce qui sotto è prelevata: non risulta disponibile per gli ordini.</p>
          <p class="strong mt2" style="margin-bottom:var(--space-3)">A fine giornata, quanto riporti a casa?</p>
          ${aperta.righe.map((r) => html`<div class="field"><label for=${`rs${r.variante_id}`}>${nomeVariante(r.variante_id)}: portati ${r.quantita_prelevata}</label>
            <input class="input numero" id=${`rs${r.variante_id}`} type="number" inputmode="numeric" min="0" max=${r.quantita_prelevata} step="1" placeholder="Residuo"
              .value=${live(rese[r.variante_id] ?? '')} @input=${(e: Event) => { rese[r.variante_id] = (e.target as HTMLInputElement).value; errR = ''; aggiorna(); }}></div>`)}
          ${errR ? html`<div class="errmsg" role="alert">${icon('allerta')}<span>${errR}</span></div>` : nothing}
          <div class="btns"><button class="btn primary" @click=${() => chiudi(aperta)}>Chiudi il mercato</button></div></section>`
        : html`<section class="card"><h2>Prepara un mercato</h2><p class="sub">Indica cosa porti: esce dal magazzino finché non chiudi la giornata.</p>
          <div class="mt">${erroreModulo(m)}</div>
          <div class="row-fields">${campo(m, 'luogo', 'Dove')}${campo(m, 'data', 'Quando', { type: 'date' })}</div>
          ${cat.filter((v) => v.disponibile > 0).map((v) => html`<div class="row" style="margin-bottom:var(--space-2)">
            <label for=${`mq${v.variante_id}`} class="grow">${nomeBreve(v.prodotto, v.formato)} <span class="small">(${v.disponibile} pronti)</span></label>
            <input class="input numero" style="width:96px" id=${`mq${v.variante_id}`} type="number" inputmode="numeric" min="0" max=${v.disponibile} step="1" placeholder="0"
              .value=${live(qta[v.variante_id] ?? '')} @input=${(e: Event) => { qta[v.variante_id] = (e.target as HTMLInputElement).value; delete m.err._; aggiorna(); }}></div>`)}
          <div class="btns">${bottoneInvio(m, 'Preleva la merce', preleva, 'primary')}</div></section>`;
      return html`${testa('Mercato', { sub: 'Porti la merce, a fine giornata inserisci il residuo e il venduto si calcola da solo.' })}
        <div class="form">${top}</div>
        <section class="section"><h2 style="margin-bottom:var(--space-3)">Mercati passati</h2>
          ${passate.length ? html`<div class="cols">${passate.map((s) => { const v = venduto(s); return html`<div class="card">
            <div class="card-head"><h3>${s.luogo}</h3><b class="num">${eur(v.e)}${v.x ? ' + X' : ''}</b></div>
            <p class="small">${fdl(s.data)}, ${v.pz} pz venduti</p>
            <div class="table-wrap mt"><table class="t">${s.righe.map((r) => html`<tr><td>${nomeVariante(r.variante_id)}<div class="small">portati ${r.quantita_prelevata}, tornati ${r.quantita_resa ?? 0}</div></td>
              <td class="r">${r.quantita_prelevata - (r.quantita_resa ?? 0)} pz</td></tr>`)}</table></div></div>`; })}</div>`
            : html`<div class="empty">Ancora nessun mercato registrato.</div>`}</section>`;
    },
  };
}

// ---------------------------------------------------------------- attrezzatura
export function attrezzatura(): Pagina {
  let el: T.Cespite[] = []; let imp: T.Impostazioni | null = null; let usoAnno = 0;
  const anno = new Date().getFullYear();

  function modulo(c?: T.Cespite) {
    const cat0 = rif.categorieCespite[0];
    const m = new Modulo({ nome: c?.nome ?? '', categoria: String(c?.categoria_id ?? cat0?.id ?? ''), quantita: String(c?.quantita ?? 1), anno: String(c?.anno_acquisto ?? anno),
      prezzo: c ? numCampo(Number(c.prezzo), 2) : '', contributo: c && Number(c.contributo) ? numCampo(Number(c.contributo), 2) : '', vita: String(c?.vita_utile ?? cat0?.vita_utile_default ?? 10), note: c?.note ?? '' });
    const f = finestra(() => html`<h2>${c ? 'Modifica bene' : 'Nuovo bene'}</h2>
      ${erroreModulo(m)}
      ${campo(m, 'nome', 'Nome', { placeholder: 'Smielatore 4 telaini' })}
      <div class="row-fields">${scelta(m, 'categoria', 'Categoria', rif.categorieCespite.map((x) => ({ v: x.id, l: x.nome })), {
        onChange: (v) => { if (!c) { m.v.vita = String(rif.categorieCespite.find((x) => String(x.id) === v)?.vita_utile_default ?? m.v.vita); f.ridisegna(); } } })}
        ${campo(m, 'quantita', 'Quantità', { numero: true, inputmode: 'numeric' })}</div>
      <div class="row-fields">${campo(m, 'anno', 'Anno di acquisto', { numero: true, inputmode: 'numeric' })}${campo(m, 'prezzo', 'Prezzo pagato', { numero: true, unita: '€', placeholder: '850' })}</div>
      <div class="row-fields">${campo(m, 'contributo', 'Contributo ricevuto', { numero: true, unita: '€', placeholder: '0' })}${campo(m, 'vita', 'Anni di vita', { numero: true, inputmode: 'numeric' })}</div>
      <p class="hint" style="margin-bottom:var(--space-4)">${c ? 'Le modifiche valgono per i lotti aperti e futuri; quelli chiusi tengono il costo congelato finché non li ricalcoli.' : 'Anno e prezzo possono essere indicativi.'}</p>
      ${area(m, 'note', 'Note')}
      <div class="btns">${c && !c.acquisto_riga_id ? html`<button class="btn danger" @click=${async () => {
          if (!(await chiedi('Eliminare il bene?', 'Se è stato inserito per errore. Se non lo usi più, meglio "Segna come dismesso".', 'Elimina', true))) return;
          try { await api.eliminaCespite(c.id); f.chiudi(); toast('Bene eliminato'); ricarica(); } catch (e) { toast(messaggioErrore(e), true); } }}>Elimina</button>` : nothing}
        <button class="btn quiet" @click=${() => f.chiudi()}>Annulla</button>
        ${bottoneInvio(m, 'Salva', async () => {
          m.err = {};
          const a = Number(m.v.anno), p = parseNum(m.v.prezzo), co = parseNum(m.v.contributo) ?? 0, v = Number(m.v.vita), q = Number(m.v.quantita);
          if (!m.v.nome.trim()) m.errore('nome', 'Scrivi il nome');
          if (!(a >= 1950 && a <= anno + 1)) m.errore('anno', 'Scrivi l\'anno, anche indicativo');
          if (p == null || p <= 0) m.errore('prezzo', 'Scrivi il prezzo pagato, anche indicativo');
          if (co < 0 || (p != null && co > p)) m.errore('contributo', 'Il contributo non può superare il prezzo');
          if (!(v >= 1)) m.errore('vita', 'Scrivi gli anni di vita');
          if (!(q >= 1 && Number.isInteger(q))) m.errore('quantita', 'Almeno 1');
          if (await m.invia(() => api.salvaCespite({ id: c?.id, nome: m.v.nome.trim(), categoria_id: Number(m.v.categoria), quantita: q, anno_acquisto: a, prezzo: p!, contributo: co, vita_utile: v, note: m.v.note.trim() || null }))) {
            f.chiudi(); toast(c ? 'Bene aggiornato' : 'Bene aggiunto'); ricarica();
          }
        }, 'primary')}</div>`);
  }
  async function dismetti(c: T.Cespite, torna = false) {
    if (!torna && !(await chiedi(`Dismettere ${c.nome}?`, 'Esce dal calcolo del costo dall\'anno prossimo. Puoi rimetterlo in uso.', 'Segna come dismesso'))) return;
    try { await api.salvaCespite({ id: c.id, stato: torna ? 'in_uso' : 'dismesso', data_dismissione: torna ? null : isoDate() }); toast(torna ? `${c.nome}: di nuovo in uso` : `${c.nome}: dismesso`); ricarica(); }
    catch (e) { toast(messaggioErrore(e), true); }
  }

  return {
    titolo: 'Attrezzatura', tab: 'attrezzatura',
    async carica() { [el, imp, usoAnno] = await Promise.all([api.cespiti(), api.impostazioni(), api.usoCespiti(anno), carica('categorieCespite')]) as [T.Cespite[], T.Impostazioni, number, void]; },
    vista() {
      const uso = el.filter((c) => c.stato === 'in_uso'), dis = el.filter((c) => c.stato === 'dismesso');
      const pieno = uso.reduce((a, c) => a + Number(c.prezzo) / c.vita_utile, 0);
      return html`${testa('Attrezzatura', { sub: 'Ogni bene, finché lo usi, costa ogni anno la stessa cifra: prezzo meno contributo, diviso gli anni di vita. Esce dal calcolo solo quando lo segni come dismesso.',
          azioni: html`<button class="btn" @click=${() => modulo()}>${icon('piu')} Aggiungi un bene</button>` })}
        <div class="kpis" style="margin-bottom:var(--space-6)">${kpi(`Costo d'uso ${anno}`, eur(Number(usoAnno)))}${kpi('Senza contributi', eur(pieno))}${kpi('Beni in uso', uso.length)}</div>
        <h2 style="margin-bottom:var(--space-3)">In uso</h2>
        ${uso.length ? html`<div class="cols">${uso.map((c) => { const netto = Number(c.prezzo) - Number(c.contributo); const oltre = c.anno_acquisto + c.vita_utile <= anno;
          return html`<div class="card"><div class="card-head"><h3>${c.nome}${c.quantita > 1 ? ` × ${c.quantita}` : ''}</h3>${oltre ? badge('oltre la vita utile', 'soft') : nothing}</div>
            <p class="small">${c.categoria?.nome ?? ''}, acquistato nel ${c.anno_acquisto}${c.acquisto_riga_id ? ', dal registro acquisti' : ''}</p>
            <dl class="dl mt"><dt>Prezzo pagato</dt><dd>${eur(Number(c.prezzo))}</dd>
              ${Number(c.contributo) ? html`<dt>Contributo</dt><dd>−${eur(Number(c.contributo))}</dd><dt>Costo netto</dt><dd>${eur(netto)}</dd>` : nothing}
              <dt>Vita utile</dt><dd>${c.vita_utile} anni</dd><dt class="strong">Costo d'uso annuo</dt><dd class="strong">${eur((imp?.costo_netto ? netto : Number(c.prezzo)) / c.vita_utile)}</dd></dl>
            ${Number(c.contributo) ? html`<p class="small mt">Da ricomprare senza contributo costerebbe ${eur(Number(c.prezzo) / c.vita_utile)} l'anno.</p>` : nothing}
            <div class="btns"><button class="btn sm" @click=${() => modulo(c)}>Modifica</button><button class="btn sm quiet" @click=${() => dismetti(c)}>Segna come dismesso</button></div></div>`; })}</div>`
          : html`<div class="empty">Nessun bene: inserisci l'attrezzatura che hai già, con anno e prezzo indicativi.</div>`}
        ${dis.length ? html`<section class="section"><h2 style="margin-bottom:var(--space-3)">Dismessi</h2>${lista(dis.map((c) => riga({ t: c.nome, m: `Dismesso il ${fd(c.data_dismissione)}`,
          extra: html`<button class="btn sm" @click=${() => dismetti(c, true)}>Rimetti in uso</button>` })))}</section>` : nothing}`;
    },
  };
}

// ---------------------------------------------------------------- notifiche
const CAT_NOT: Record<string, string> = { ordini: 'Ordini', stock: 'Scorte', prezzi: 'Prezzi', modifiche: 'Modifiche', produzione: 'Produzione', backup: 'Backup' };
export function notifiche(): Pagina {
  let da: T.Notifica[] = [], lette: T.Notifica[] = []; let f = 'tutte';
  const inF = (n: T.Notifica) => f === 'tutte' || n.categoria === f;
  async function leggi(id: number | null) {
    try {
      if (id) await api.segnaLetta(id);
      else { const n = await api.segnaTutteLette(f === 'tutte' ? null : f); toast(`${n} ${n === 1 ? 'notifica segnata' : 'notifiche segnate'} come lette`); }
      stato.contatori.notifiche = Math.max(0, stato.contatori.notifiche - (id ? 1 : da.filter(inF).length));
      ricarica();
    } catch (e) { toast(messaggioErrore(e), true); }
  }
  const link = (n: T.Notifica) => n.tabella_rif === 'comande' && n.record_rif ? html`<a class="btn sm" href=${`/ordini/${n.record_rif}`}>Apri l'ordine</a>`
    : n.categoria === 'stock' ? html`<a class="btn sm" href="/acquisti/nuovo">Registra un acquisto</a>`
    : n.categoria === 'backup' ? html`<a class="btn sm" href="/impostazioni#backup">Scarica il backup</a>` : nothing;
  return {
    titolo: 'Notifiche', tab: 'notifiche',
    async carica() { [da, lette] = await Promise.all([api.notifiche(false), api.notifiche(true)]); },
    vista() {
      const u = da.filter(inF), o = lette.filter(inF);
      const voci: [string, string, number?][] = [['tutte', 'Tutte', da.length], ...Object.entries(CAT_NOT).map(([k, l]) => [k, l, da.filter((n) => n.categoria === k).length] as [string, string, number])];
      return html`${testa('Notifiche')}
        ${segmenti(voci, f, (k) => { f = k; aggiorna(); }, 'Categoria')}
        <div class="section-head"><h2>Da leggere</h2>${u.length ? html`<button class="linkbtn" @click=${() => leggi(null)}>Segna tutte come lette</button>` : nothing}</div>
        ${u.length ? html`<div class="cols">${u.map((n) => html`<div class="card"><p class="small">${CAT_NOT[n.categoria] ?? n.categoria}, ${fd(n.creata_il)}</p>
          <h3 style="margin-top:4px">${n.titolo}</h3>${n.messaggio ? html`<p class="mt">${n.messaggio}</p>` : nothing}
          <div class="btns">${link(n)}<button class="btn sm primary" @click=${() => leggi(n.id)}>Segna come letta</button></div></div>`)}</div>`
          : html`<div class="empty">Sei in pari: nessuna notifica da leggere.</div>`}
        <section class="section"><h2 style="margin-bottom:var(--space-3)">Storico</h2>
          ${lista(o.map((n) => riga({ t: n.titolo, m: n.messaggio ?? '', v: html`<small>${CAT_NOT[n.categoria] ?? ''}</small>${fd(n.creata_il)}` })), 'Qui trovi le notifiche già lette.')}</section>`;
    },
  };
}

// ---------------------------------------------------------------- altro (telefono)
export function altro(): Pagina {
  const voci: [string, string, () => string][] = [
    ['/acquisti', 'Acquisti', () => 'Spese e rifornimenti'], ['/mercato', 'Mercato', () => 'Merce portata e residuo'],
    ['/attrezzatura', 'Attrezzatura', () => 'Beni che durano più anni'], ['/andamento', 'Andamento', () => 'Grafici, anche creati da te'],
    ['/notifiche', 'Notifiche', () => (stato.contatori.notifiche ? `${stato.contatori.notifiche} da leggere` : 'Nessuna da leggere')],
    ['/anagrafiche', 'Anagrafiche', () => 'Clienti, fornitori, postazioni, mezzi'], ['/articoli', 'Anagrafica articoli', () => 'Articoli e prodotti in vendita'],
    ['/impostazioni', 'Impostazioni', () => 'Utenti, password, valori di calcolo, aspetto'],
  ];
  return { titolo: 'Altro', tab: 'altro', vista: () => html`${testa('Altro')}${lista(voci.map(([h, t, m]) => riga({ href: h, t, m: m() })))}
    <div class="btns"><button class="btn" @click=${esci}>${icon('esci')} Esci (cambia utente)</button></div>` };
}

