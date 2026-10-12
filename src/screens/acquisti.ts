/** Acquisti registrati come scontrini: fornitore, voci con quantità e totale pagato (IVA compresa). */
import { html, nothing } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import type { Pagina } from '../app';
import { aggiorna, ricarica, vai } from '../app';
import * as api from '../lib/api';
import { rif, carica, invalida, categoria } from '../lib/rif';
import { leggiBozza, salvaBozza, cancellaBozza } from '../lib/bozze';
import { eur, eurCost, fd, isoDate, num, parseNum, qtyArticolo, capitalizza } from '../lib/format';
import { messaggioErrore } from '../lib/errors';
import { icon } from '../ui/icons';
import { testa, toast, chiedi, Modulo, campo, erroreModulo, bottoneInvio, riga, lista, badge, finestra } from '../ui/kit';
import type * as T from '../lib/types';

const totAcq = (a: T.Acquisto) => a.righe.reduce((s, r) => s + Number(r.totale), 0);

export function acquisti(q: URLSearchParams): Pagina {
  let anno = Number(q.get('anno')) || new Date().getFullYear();
  let el: T.Acquisto[] = [];
  return {
    titolo: 'Acquisti', tab: 'acquisti',
    async carica() { [el] = await Promise.all([api.acquisti(anno), carica('categorie')]) as [T.Acquisto[], void]; },
    vista() {
      const tot = el.reduce((s, a) => s + totAcq(a), 0);
      const y = new Date().getFullYear();
      return html`${testa('Acquisti', { sub: html`Il totale di ogni voce è quello pagato, IVA compresa; il prezzo unitario lo calcola l'app. Articoli e fornitori sono in <a class="link-text" href="/articoli">Anagrafica articoli</a> e <a class="link-text" href="/anagrafiche?vista=fornitori">Anagrafiche</a>.`,
          azioni: html`<a class="btn primary" href="/acquisti/nuovo">${icon('piu')} Nuovo acquisto</a>` })}
        <div class="seg" role="group" aria-label="Anno">${[y - 2, y - 1, y].map((a) => html`<button aria-pressed=${a === anno ? 'true' : 'false'}
          @click=${() => { anno = a; history.replaceState(history.state, '', `/acquisti?anno=${a}`); ricarica(); }}>${a}</button>`)}</div>
        <p class="sub" style="margin-bottom:var(--space-4)">${el.length} acquisti nel ${anno}, in tutto <b>${eur(tot)}</b>.</p>
        ${lista(el.map((a) => riga({ href: `/acquisti/${a.id}`, t: html`${fd(a.data)} · ${a.fornitore?.nome ?? 'Fornitore non indicato'}`,
          m: a.righe.map((r) => r.articolo.nome).join(', '), v: eur(totAcq(a)) })), 'Nessun acquisto registrato in quest\'anno.')}`;
    },
  };
}

// ---------------------------------------------------------------- nuovo acquisto
interface Voce { nome: string; quantita: string; conf: string; totale: string; cat: string; unita: string; mezzo: string; km: string; dura: boolean; catCesp: string; vita: string; contributo: string }
interface Bozza { data: string; fornitore: string; note: string; voci: Voce[] }
const vuota = (): Voce => ({ nome: '', quantita: '', conf: '', totale: '', cat: 'altro', unita: 'pz', mezzo: '', km: '', dura: false, catCesp: '', vita: '', contributo: '' });

export function nuovoAcquisto(): Pagina {
  const b: Bozza = leggiBozza<Bozza>('acquisto') ?? { data: isoDate(), fornitore: '', note: '', voci: [vuota()] };
  const m = new Modulo({ x: '' });
  const err: Record<string, string> = {};
  const salva = () => salvaBozza('acquisto', b);
  const art = (n: string) => rif.articoli.find((a) => a.nome.trim().toLowerCase() === n.trim().toLowerCase());
  const catCod = (v: Voce) => { const a = art(v.nome); return a ? categoria(a.categoria_id)?.codice ?? 'altro' : v.cat; };
  const qBase = (v: Voce) => { const a = art(v.nome), q = parseNum(v.quantita); if (q == null) return null;
    const c = a?.confezioni.find((x) => String(x.id) === v.conf); return c ? q * Number(c.quantita) : q; };

  const set = (v: Voce, k: keyof Voce, x: string | boolean) => { (v as unknown as Record<string, unknown>)[k] = x; Object.keys(err).forEach((e) => delete err[e]); salva(); aggiorna(); };
  const inp = (v: Voce, k: keyof Voce, id: string, label: string, o: { ph?: string; num?: boolean; unita?: string; list?: string; type?: string; hint?: string } = {}) => html`
    <div class="field ${err[id] ? 'err' : ''}"><label for=${id}>${label}</label>
      ${o.unita ? html`<div class="unit"><input class="input numero" id=${id} inputmode="decimal" placeholder=${o.ph ?? ''} .value=${live(String(v[k]))} @input=${(e: Event) => set(v, k, (e.target as HTMLInputElement).value)}><span>${o.unita}</span></div>`
        : html`<input class="input ${o.num ? 'numero' : ''}" id=${id} type=${o.type ?? 'text'} inputmode=${o.num ? 'decimal' : nothing} list=${o.list ?? nothing} autocomplete="off" placeholder=${o.ph ?? ''}
          .value=${live(String(v[k]))} @input=${(e: Event) => set(v, k, (e.target as HTMLInputElement).value)}>`}
      ${err[id] ? html`<div class="errmsg" role="alert">${icon('allerta')}<span>${err[id]}</span></div>` : o.hint ? html`<div class="hint">${o.hint}</div>` : nothing}</div>`;
  const sel = (v: Voce, k: keyof Voce, id: string, label: string, opz: { v: string | number; l: string }[]) => html`<div class="field"><label for=${id}>${label}</label>
    <select class="select" id=${id} @change=${(e: Event) => set(v, k, (e.target as HTMLSelectElement).value)}>${opz.map((o) => html`<option value=${String(o.v)} ?selected=${String(o.v) === String(v[k])}>${o.l}</option>`)}</select></div>`;

  async function registra() {
    Object.keys(err).forEach((e) => delete err[e]);
    if (!b.data) err.data = 'Indica la data';
    const voci = b.voci.filter((v) => v.nome.trim() || v.quantita || v.totale);
    if (!voci.length) err['n0'] = 'Scrivi almeno un articolo';
    voci.forEach((v) => {
      const i = b.voci.indexOf(v), q = parseNum(v.quantita), t = parseNum(v.totale), c = catCod(v);
      if (!v.nome.trim()) err[`n${i}`] = 'Scrivi l\'articolo';
      if (!q || q <= 0) err[`q${i}`] = 'Scrivi la quantità';
      if (t == null || t < 0) err[`t${i}`] = 'Scrivi il totale pagato';
      if (c === 'attr' && v.dura && !(Number(v.vita) >= 1)) err[`v${i}`] = 'Per quanti anni lo userai?';
      if (c === 'carb' && v.km && !(Number(v.km) > 0)) err[`k${i}`] = 'Scrivi i km del contachilometri o lascia vuoto';
    });
    if (Object.keys(err).length) { aggiorna(); requestAnimationFrame(() => document.querySelector('.field.err')?.scrollIntoView({ block: 'center', behavior: 'smooth' })); return; }
    const forn = rif.fornitori.find((f) => f.nome.trim().toLowerCase() === b.fornitore.trim().toLowerCase());
    const righe: T.RigaAcquistoIn[] = voci.map((v) => {
      const a = art(v.nome), c = catCod(v);
      const r: T.RigaAcquistoIn = { quantita: parseNum(v.quantita)!, totale: Math.round(parseNum(v.totale)! * 100) / 100 };
      if (a) r.articolo_id = a.id; else r.nuovo_articolo = { nome: capitalizza(v.nome), categoria: v.cat, unita: v.unita };
      if (a && v.conf) r.confezione_id = Number(v.conf);
      if (c === 'carb') { r.mezzo_id = Number(v.mezzo) || rif.mezzi.find((x) => x.tipo === 'dedicato' && !x.archiviato)?.id || null; r.contachilometri = Number(v.km) || null; }
      if (c === 'attr' && v.dura) r.cespite = { nome: a?.nome ?? capitalizza(v.nome), categoria_id: Number(v.catCesp) || rif.categorieCespite[0]?.id, vita_utile: Number(v.vita), contributo: parseNum(v.contributo) ?? 0 };
      return r;
    });
    let id = 0;
    const ok = await m.invia(async () => { id = await api.registraAcquisto(b.data, forn?.id ?? null, forn ? null : (b.fornitore.trim() || null), righe, b.note.trim()); });
    if (!ok) return;
    cancellaBozza('acquisto'); invalida('articoli', 'fornitori');
    toast('Acquisto registrato'); vai(`/acquisti/${id}`, { replace: true });
  }

  return {
    titolo: 'Nuovo acquisto', tab: 'acquisti', genitore: { path: '/acquisti', titolo: 'Acquisti' },
    async carica() { await carica('articoli', 'categorie', 'fornitori', 'mezzi', 'categorieCespite'); },
    vista() {
      const dedicati = rif.mezzi.filter((x) => x.tipo === 'dedicato' && !x.archiviato);
      return html`${testa('Nuovo acquisto', { sub: 'Come uno scontrino: data, fornitore e le voci una alla volta. Il totale è quello pagato, IVA compresa.' })}
      <div class="form">
        ${erroreModulo(m)}
        <div class="row-fields">
          <div class="field ${err.data ? 'err' : ''}"><label for="aq-d">Data</label><input class="input" id="aq-d" type="date" .value=${live(b.data)} @input=${(e: Event) => { b.data = (e.target as HTMLInputElement).value; salva(); }}></div>
          <div class="field"><label for="aq-f">Fornitore</label><input class="input" id="aq-f" list="aq-fl" autocomplete="off" placeholder="Vetreria Friulana" .value=${live(b.fornitore)}
            @input=${(e: Event) => { b.fornitore = (e.target as HTMLInputElement).value; salva(); aggiorna(); }}>
            <datalist id="aq-fl">${rif.fornitori.filter((f) => !f.archiviato).map((f) => html`<option value=${f.nome}></option>`)}</datalist>
            ${b.fornitore.trim() && !rif.fornitori.some((f) => f.nome.toLowerCase() === b.fornitore.trim().toLowerCase()) ? html`<div class="hint">Nuovo fornitore: lo aggiungo all'anagrafica.</div>` : nothing}</div>
        </div>
        <datalist id="aq-al">${rif.articoli.filter((a) => !a.archiviato).map((a) => html`<option value=${a.nome}></option>`)}</datalist>
        ${b.voci.map((v, i) => {
          const a = art(v.nome), nuovo = !!v.nome.trim() && !a, c = catCod(v), qb = qBase(v), t = parseNum(v.totale);
          return html`<div class="formbox">
            <div class="row" style="margin-bottom:var(--space-3)"><b>Voce ${i + 1}</b>${b.voci.length > 1 ? html`<button class="iconbtn" type="button" aria-label=${`Togli voce ${i + 1}`} @click=${() => { b.voci.splice(i, 1); salva(); aggiorna(); }}>${icon('x')}</button>` : nothing}</div>
            ${inp(v, 'nome', `n${i}`, 'Articolo', { ph: 'Candito proteico', list: 'aq-al',
              hint: a ? `${categoria(a.categoria_id)?.nome ?? ''}${a.magazzino ? `, va in ${a.magazzino === 'materiali' ? 'Materiali di consumo' : 'Materie apistiche'}` : ', solo spesa'}` : undefined })}
            ${nuovo ? html`<div class="note" style="margin-bottom:var(--space-4)">Articolo nuovo: indica categoria e unità, lo aggiungo all'anagrafica.</div>
              <div class="row-fields">${sel(v, 'cat', `c${i}`, 'Categoria', rif.categorie.map((x) => ({ v: x.codice, l: x.nome })))}${sel(v, 'unita', `u${i}`, 'Unità', [{ v: 'pz', l: 'pezzi' }, { v: 'kg', l: 'kg' }, { v: 'l', l: 'litri' }])}</div>` : nothing}
            <div class="row-fields">
              ${inp(v, 'quantita', `q${i}`, 'Quantità', { ph: '1', num: true })}
              ${a && a.confezioni.length ? sel(v, 'conf', `cf${i}`, 'Unità', [{ v: '', l: a.unita }, ...a.confezioni.map((x) => ({ v: x.id, l: `${x.nome} da ${num(Number(x.quantita), 2)} ${a.unita}` }))]) : nothing}
              ${inp(v, 'totale', `t${i}`, 'Totale pagato', { ph: '36,00', unita: '€' })}
            </div>
            ${qb && t != null ? html`<p class="hint" style="margin-top:-8px;margin-bottom:var(--space-3)">Prezzo unitario: ${eurCost(t / qb)} al ${a?.unita ?? v.unita}</p>` : nothing}
            ${c === 'carb' ? html`<div class="row-fields">${dedicati.length > 1 ? sel(v, 'mezzo', `m${i}`, 'Mezzo', dedicati.map((x) => ({ v: x.id, l: x.nome }))) : nothing}
              ${inp(v, 'km', `k${i}`, 'Km sul contachilometri (facoltativo)', { ph: '216600', num: true })}</div>
              <p class="hint">Con due letture nell'anno l'app calcola il costo al km reale. Il carburante dell'auto personale non si registra: vale la tariffa al km.</p>` : nothing}
            ${c === 'attr' ? html`<label class="check"><input type="checkbox" .checked=${live(v.dura)} @change=${(e: Event) => set(v, 'dura', (e.target as HTMLInputElement).checked)}> È un bene che dura più anni (va nell'attrezzatura)</label>
              ${v.dura ? html`<div class="row-fields">${sel(v, 'catCesp', `cc${i}`, 'Tipo di bene', rif.categorieCespite.map((x) => ({ v: x.id, l: `${x.nome} (${x.vita_utile_default} anni)` })))}
                ${inp(v, 'vita', `v${i}`, 'Anni di vita', { ph: String(rif.categorieCespite.find((x) => String(x.id) === v.catCesp)?.vita_utile_default ?? 10), num: true })}
                ${inp(v, 'contributo', `co${i}`, 'Contributo ricevuto', { ph: '0', unita: '€' })}</div>` : nothing}` : nothing}
          </div>`;
        })}
        <button class="btn" type="button" @click=${() => { b.voci.push(vuota()); salva(); aggiorna(); }}>${icon('piu')} Aggiungi una voce</button>
        <div class="field mt2"><label for="aq-n">Note (facoltative)</label><input class="input" id="aq-n" .value=${live(b.note)} @input=${(e: Event) => { b.note = (e.target as HTMLInputElement).value; salva(); }}></div>
        <div class="row wrap"><p class="strong">Totale: ${eur(b.voci.reduce((s, v) => s + (parseNum(v.totale) ?? 0), 0))}</p>
          ${bottoneInvio(m, 'Registra acquisto', registra, 'primary')}</div>
      </div>`;
    },
  };
}

// ---------------------------------------------------------------- scheda acquisto
export function schedaAcquisto(p: Record<string, string>): Pagina {
  const id = Number(p.id);
  let a: T.Acquisto; let cespiti: T.Cespite[] = [];
  function modificaRiga(r: T.Acquisto['righe'][number]) {
    const m = new Modulo({ quantita: num(Number(r.quantita), 3), totale: num(Number(r.totale), 2), km: r.contachilometri ? String(r.contachilometri) : '' });
    const f = finestra(() => html`<h2>${r.articolo.nome}</h2>
      <p class="sub" style="margin-bottom:var(--space-4)">Correggendo la quantità, il magazzino si aggiorna da solo.</p>
      ${erroreModulo(m)}
      ${campo(m, 'quantita', 'Quantità', { numero: true, unita: r.articolo.unita })}
      ${campo(m, 'totale', 'Totale pagato', { numero: true, unita: '€' })}
      ${r.mezzo_id ? campo(m, 'km', 'Km sul contachilometri', { numero: true, inputmode: 'numeric' }) : nothing}
      <div class="btns"><button class="btn danger" @click=${async () => {
        if (!(await chiedi('Togliere la voce?', `${r.articolo.nome}: la quantità esce dal magazzino.`, 'Togli voce', true))) return;
        try { await api.eliminaRigaAcquisto(r.id); f.chiudi(); toast('Voce tolta'); ricarica(); } catch (e) { toast(messaggioErrore(e), true); }
      }}>Togli voce</button>
      <button class="btn quiet" @click=${() => f.chiudi()}>Annulla</button>
      ${bottoneInvio(m, 'Salva', async () => {
        m.err = {};
        const q = parseNum(m.v.quantita), t = parseNum(m.v.totale);
        if (!q || q <= 0) m.errore('quantita', 'Scrivi la quantità');
        if (t == null || t < 0) m.errore('totale', 'Scrivi il totale');
        if (await m.invia(() => api.aggiornaRigaAcquisto(r.id, { quantita: q!, totale: t!, ...(r.mezzo_id ? { contachilometri: Number(m.v.km) || null } : {}) }))) { f.chiudi(); toast('Voce aggiornata'); ricarica(); }
      }, 'primary')}</div>`);
  }
  return {
    titolo: 'Acquisto', tab: 'acquisti', genitore: { path: '/acquisti', titolo: 'Acquisti' },
    async carica() { [a, cespiti] = await Promise.all([api.acquisto(id), api.cespiti()]); this.titolo = `Acquisto del ${fd(a.data)}`; },
    vista() {
      return html`${testa(`Acquisto del ${fd(a.data)}`, { sub: a.fornitore?.nome ?? 'Fornitore non indicato' })}
        <div class="form-wide">
          ${lista(a.righe.map((r) => {
            const ce = cespiti.find((c) => c.acquisto_riga_id === r.id);
            return riga({ onClick: () => modificaRiga(r),
              t: html`${r.articolo.nome} ${ce ? badge('attrezzatura', 'prod') : nothing}`,
              m: `${qtyArticolo(Number(r.quantita), r.articolo.unita)}, ${eurCost(Number(r.totale) / Number(r.quantita))} al ${r.articolo.unita}${r.mezzo ? `, ${r.mezzo.nome}${r.contachilometri ? ` a ${num(r.contachilometri, 0)} km` : ''}` : ''}`,
              v: eur(Number(r.totale)) });
          }))}
          <p class="strong mt">Totale ${eur(totAcq(a))}</p>
          ${a.note ? html`<p class="mt"><span class="small">Nota:</span> ${a.note}</p>` : nothing}
          <div class="btns"><button class="btn danger" @click=${async () => {
            if (!(await chiedi('Eliminare l\'acquisto?', 'Tutte le voci escono dal magazzino. Se un bene è già in Attrezzatura, resta lì.', 'Elimina', true))) return;
            try { await api.eliminaAcquisto(id); toast('Acquisto eliminato'); vai('/acquisti', { replace: true }); } catch (e) { toast(messaggioErrore(e), true); }
          }}>Elimina acquisto</button></div>
          <p class="small mt">Tocca una voce per correggerla.</p>
        </div>`;
    },
  };
}
