/** Produzione: lotti con le loro tappe, attività della stagione, costo del lotto. */
import { html, nothing, type TemplateResult } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import type { Pagina } from '../app';
import { aggiorna, ricarica, vai } from '../app';
import * as api from '../lib/api';
import { rif, carica, formatiDi, nomePostazione, mezzo, articolo, invalida } from '../lib/rif';
import { catalogo, variante } from '../lib/catalogo';
import { eur, eurCost, fd, num, kg, durata, isoDate, isoLocal, fromLocal, parseNum, qtyArticolo, numCampo } from '../lib/format';
import { AppError, messaggioErrore } from '../lib/errors';
import { icon } from '../ui/icons';
import { Modulo, campo, scelta, area, testa, toast, erroreModulo, bottoneInvio, riga, lista, kpi, badge, finestra, type Opzione } from '../ui/kit';
import type * as T from '../lib/types';

const badgeLotto = (l: T.Lotto) => l.stato === 'aperto' ? badge('Aperto', 'soft', 'orologio') : badge('Chiuso', 'done', 'spunta');
const costoKgLotto = (l: T.Lotto) => (l.stato === 'chiuso' ? l.costo_kg_congelato : l.costo_kg_attuale);

// ---------------------------------------------------------------- campi comuni: viaggio e tempo
type ValViaggio = { mezzo: string; km: string; costo_terzi: string };
function campiViaggio<V extends ValViaggio & Record<string, string | boolean | string[]>>(m: Modulo<V>, obbligatorio: boolean) {
  const mz = mezzo(Number(m.v.mezzo) || null);
  const opz: Opzione[] = rif.mezzi.filter((x) => !x.archiviato || String(x.id) === m.v.mezzo).map((x) => ({ v: x.id, l: x.nome }));
  return html`${scelta(m, 'mezzo', obbligatorio ? 'Mezzo' : 'Viaggio (facoltativo)', opz, { vuota: obbligatorio ? undefined : 'Nessun viaggio',
      hint: mz ? (mz.tipo === 'dedicato' ? 'Costo dai rifornimenti dell\'anno' : mz.tipo === 'personale' ? `${eur(mz.tariffa_km)} al km` : 'Scrivi quanto è costato il viaggio') : undefined })}
    ${mz && mz.tipo === 'terzi' ? campo(m, 'costo_terzi', 'Costo del viaggio', { numero: true, unita: '€', hint: 'Rimborso, pieno, regalo… Se paghi in miele, registra una rettifica "Compenso in miele"' })
      : mz ? campo(m, 'km', 'Km andata e ritorno', { numero: true, unita: 'km', inputmode: 'numeric' }) : nothing}`;
}
function leggiViaggio(m: Modulo<ValViaggio & Record<string, string | boolean | string[]>>, obbligatorio: boolean) {
  const id = Number(m.v.mezzo) || null, mz = mezzo(id);
  if (obbligatorio && !mz) m.errore('mezzo', 'Scegli il mezzo');
  const km = parseNum(m.v.km), ct = parseNum(m.v.costo_terzi);
  if (mz && mz.tipo !== 'terzi' && (km == null || km < 0)) m.errore('km', 'Scrivi i km, anche stimati');
  if (mz && mz.tipo === 'terzi' && (ct == null || ct < 0)) m.errore('costo_terzi', 'Scrivi il costo, anche 0');
  return { mezzo: id, km: mz && mz.tipo !== 'terzi' ? km : null, costo_terzi: mz && mz.tipo === 'terzi' ? ct : null };
}
type ValTempo = { ore: string; minuti: string };
const campiTempo = <V extends ValTempo & Record<string, string | boolean | string[]>>(m: Modulo<V>, label = 'Tempo impiegato') => html`
  <fieldset style="border:0;padding:0;margin:0"><legend class="label" style="margin-bottom:6px">${label}</legend>
  <div class="row-fields">${campo(m, 'ore', 'Ore', { numero: true, inputmode: 'numeric', unita: 'h' })}${campo(m, 'minuti', 'Minuti', { numero: true, inputmode: 'numeric', unita: 'min' })}</div></fieldset>`;
function leggiTempo(m: Modulo<ValTempo & Record<string, string | boolean | string[]>>, obbligatorio = false) {
  const h = parseNum(m.v.ore) ?? 0, mi = parseNum(m.v.minuti) ?? 0;
  if (h < 0 || mi < 0) m.errore('ore', 'Il tempo non può essere negativo');
  const tot = Math.round(h * 60 + mi);
  if (obbligatorio && !tot) m.errore('ore', 'Scrivi quanto è durato, anche stimato');
  return tot || null;
}

// ---------------------------------------------------------------- elenco
export function produzione(): Pagina {
  let lotti: T.Lotto[] = []; let att: T.Attivita[] = []; let quota: T.QuotaStagione | null = null;
  const anno = new Date().getFullYear();
  let nuovo: Modulo<{ tipo: string; anno: string }> | null = null;

  async function crea() {
    if (!nuovo) return;
    let id = 0;
    if (await nuovo.invia(async () => { id = await api.nuovoLotto(Number(nuovo!.v.tipo), Number(nuovo!.v.anno)); })) {
      toast('Lotto creato'); vai(`/produzione/lotti/${id}`);
    }
  }
  async function ricalcolaTutti() {
    try { const n = await api.ricalcolaTutti(); toast(`Ricalcolati ${n} lotti chiusi`); ricarica(); } catch (e) { toast(messaggioErrore(e), true); }
  }

  return {
    titolo: 'Produzione', tab: 'produzione',
    async carica() {
      [lotti, att, quota] = await Promise.all([api.lotti(), api.attivita(anno), api.quotaStagione(anno), carica('tipi', 'postazioni')]) as [T.Lotto[], T.Attivita[], T.QuotaStagione, void];
    },
    vista() {
      const aperti = lotti.filter((l) => l.stato === 'aperto'), chiusi = lotti.filter((l) => l.stato === 'chiuso');
      const cambiati = chiusi.filter((l) => l.dati_cambiati);
      const sigla = rif.tipi.find((t) => String(t.id) === nuovo?.v.tipo)?.sigla ?? rif.tipi[0]?.sigla ?? 'ACA';
      return html`${testa('Produzione', { sub: 'Ogni lotto è una smielatura di un tipo di miele. Apri un lotto per registrare le tappe con un "+".',
          azioni: html`<button class="btn" @click=${() => { nuovo = nuovo ? null : new Modulo({ tipo: String(rif.tipi.find((t) => !t.archiviato)?.id ?? ''), anno: String(anno) }); aggiorna(); }}>${nuovo ? 'Chiudi' : html`${icon('piu')} Nuovo lotto`}</button>` })}
        ${nuovo ? html`<section class="card form" style="margin-bottom:var(--space-6)"><h3>Nuovo lotto</h3>
          ${erroreModulo(nuovo)}
          <div class="row-fields mt">${scelta(nuovo, 'tipo', 'Tipo di miele', rif.tipi.filter((t) => !t.archiviato).map((t) => ({ v: t.id, l: t.nome })))}
            ${scelta(nuovo, 'anno', 'Anno', [anno - 1, anno, anno + 1].map((y) => ({ v: y, l: String(y) })))}</div>
          <p class="small">Il codice (es. ${sigla}-${nuovo.v.anno}-01) lo crea l'app. Un nuovo tipo di miele si aggiunge in Anagrafica articoli.</p>
          <div class="btns">${bottoneInvio(nuovo, 'Crea lotto', crea, 'primary')}</div></section>` : nothing}
        ${cambiati.length ? html`<div class="note" style="margin-bottom:var(--space-5)">${cambiati.length === 1 ? 'Un lotto chiuso ha' : `${cambiati.length} lotti chiusi hanno`} dati cambiati dopo la chiusura:
          il costo resta quello congelato finché non lo ricalcoli.<div class="btns"><button class="btn sm" @click=${ricalcolaTutti}>Ricalcola tutti</button></div></div>` : nothing}

        <h2 style="margin-bottom:var(--space-3)">Lotti aperti</h2>
        ${aperti.length ? html`<div class="cols">${aperti.map(cardLotto)}</div>` : html`<div class="empty">Nessun lotto aperto.</div>`}

        <section class="section">
          <div class="section-head wrap"><h2>Stagione ${anno}</h2><div class="btns" style="margin:0">
            <a class="btn sm" href="/produzione/attivita?tipo=nutrizione">${icon('piu')} Nutrizione</a>
            <a class="btn sm" href="/produzione/attivita?tipo=trattamento">${icon('piu')} Trattamento</a></div></div>
          <p class="sub" style="margin-bottom:var(--space-4)">Nutrizione e trattamenti servono alle famiglie per tutto l'anno: il loro costo si divide tra tutti i lotti dell'anno.</p>
          <div class="cols">
            <div class="card costrows">
              <div class="cr"><span>Consumi di nutrizione e trattamenti</span><span class="v">${eur(quota?.consumi)}</span></div>
              <div class="cr"><span>Mezzi: carburante non legato ai lotti e costi fissi</span><span class="v">${eur(quota?.mezzi)}</span></div>
              <div class="cr"><span>Altre spese senza magazzino</span><span class="v">${eur(quota?.altre_spese)}</span></div>
              <div class="cr"><span>Costo d'uso dell'attrezzatura</span><span class="v">${eur(quota?.attrezzatura)}</span></div>
              <div class="tot"><span>Quota della stagione</span><span class="v">${eur(quota?.totale)}</span></div>
              <p class="small mt">Divisa su ${num(quota?.kg_riferimento ?? 0, 0)} kg di riferimento (media dei raccolti degli ultimi anni): <b>${eur(quota?.per_kg)} al kg</b></p>
            </div>
            <div>${lista(att.map((a) => riga({
              t: `${a.tipo === 'nutrizione' ? 'Nutrizione' : 'Trattamento'}: ${a.articolo?.nome ?? ''}`,
              m: `${fd(a.data)} · ${num(Number(a.quantita), a.articolo?.unita === 'pz' ? 0 : 2)} ${a.articolo?.unita ?? ''} · ${a.postazioni.length ? a.postazioni.map((p) => nomePostazione(p.postazione_id)).join(', ') : 'Tutte le postazioni'}${a.note ? ` · ${a.note}` : ''}`,
            })), 'Nessuna attività registrata quest\'anno.')}</div>
          </div>
        </section>

        <section class="section"><h2 style="margin-bottom:var(--space-3)">Lotti chiusi</h2>
          ${lista(chiusi.map((l) => riga({ href: `/produzione/lotti/${l.id}`,
            t: html`${l.codice} ${l.dati_cambiati ? badge('dati cambiati', 'soft') : nothing}`,
            m: `${kg(l.kg_smielati)} smielati, calo ${kg(l.kg_calo)}${Number(l.kg_rimasto) ? `, ${kg(l.kg_rimasto)} rimasti` : ''}`,
            v: html`${eur(l.costo_kg_congelato)}<small>al kg</small>` })), 'Nessun lotto chiuso.')}</section>`;
    },
  };
}

function cardLotto(l: T.Lotto): TemplateResult {
  return html`<a class="card" href=${`/produzione/lotti/${l.id}`} style="display:block;color:inherit;text-decoration:none">
    <div class="card-head"><h3>${l.codice}</h3>${badgeLotto(l)}</div>
    <div class="small">${l.tipo_miele} ${l.anno}${l.ultimo_evento ? ` · ultima tappa ${fd(l.ultimo_evento)}` : ''}</div>
    <dl class="dl mt"><dt>Smielati</dt><dd>${kg(l.kg_smielati)}</dd><dt>Sfuso</dt><dd>${kg(l.kg_sfuso)}</dd>
      <dt>Costo al kg</dt><dd>${costoKgLotto(l) ? html`${eur(costoKgLotto(l))} <span class="small">stima</span>` : '—'}</dd></dl>
    ${l.ricordami_chiusura ? html`<p class="small mt"><b>Da chiudere</b>: servono il miele rimasto e i vasetti per te.</p>` : nothing}
  </a>`;
}

// ---------------------------------------------------------------- scheda lotto
function testoEvento(e: T.EventoLotto, l: T.Lotto): [string, string] {
  const mz = e.mezzo ? (e.mezzo.tipo === 'terzi' ? `${e.mezzo.nome}, ${eur(Number(e.costo_terzi ?? 0))}` : `${e.mezzo.nome}, ${num(Number(e.km ?? 0), 0)} km`) : '';
  const tempo = e.minuti ? durata(e.minuti) : '';
  const parti = (...x: string[]) => x.filter(Boolean).join(', ');
  const nota = e.note ? `. ${e.note}` : '';
  switch (e.tipo) {
    case 'spostamento': return [`Spostamento${e.arnie ? ` di ${e.arnie} arnie` : ''}${e.postazione ? ` a ${e.postazione.nome}` : ''}`, parti(mz, tempo) + nota];
    case 'smielatura': {
      const k = e.bariloni.reduce((a, b) => a + Number(b.kg), 0);
      return [`Smielatura: ${kg(k)}`, parti(`${e.bariloni.length} ${e.bariloni.length === 1 ? 'barilone' : 'bariloni'} (${e.bariloni.map((b) => num(Number(b.kg), 1)).join(' + ')} kg)`, tempo, mz ? `viaggio: ${mz}` : '') + nota];
    }
    case 'confezionamento': {
      const kgv = e.righe.reduce((a, r) => a + r.pezzi * pesoVar(r.variante_id), 0);
      return [`Confezionamento: ${e.righe.map((r) => `${r.pezzi} da ${variante(r.variante_id)?.formato ?? ''}`).join(', ')}`, parti(`${kg(kgv, 2)} di miele`, tempo, mz ? `viaggio: ${mz}` : '') + nota];
    }
    case 'chiusura': {
      const pers = e.righe.filter((r) => r.uso_personale);
      return ['Chiusura', parti(pers.length ? `vasetti per te: ${pers.map((r) => `${r.pezzi} da ${variante(r.variante_id)?.formato ?? ''}`).join(', ')}` : '',
        `calo ${kg(l.kg_calo, 2)}`, `rimasti ${kg(l.kg_rimasto, 2)}`, tempo) + nota];
    }
  }
}
const pesoVar = (id: number) => Number(rif.prodotti.flatMap((p) => p.varianti).find((v) => v.id === id)?.peso_kg ?? 0);

export function schedaLotto(p: Record<string, string>): Pagina {
  const id = Number(p.id);
  let l: T.Lotto; let ev: T.EventoLotto[] = []; let vas: T.CostoVasettoLotto[] = []; let costiConf: T.CostoVasetto[] = [];
  const costoKmMezzo = new Map<number, number>();
  let busy = false;

  async function azione(fn: () => Promise<unknown>, ok: string) {
    if (busy) return; busy = true; aggiorna();
    try { await fn(); toast(ok); await ricarica(); } catch (e) { toast(messaggioErrore(e), true); } finally { busy = false; aggiorna(); }
  }

  function modificaEvento(e: T.EventoLotto) {
    const m = new Modulo({ data: isoLocal(new Date(e.data)), km: e.km != null ? numCampo(Number(e.km), 1) : '', costo: e.costo_terzi != null ? numCampo(Number(e.costo_terzi), 2) : '',
      arnie: e.arnie != null ? String(e.arnie) : '', ore: e.minuti ? String(Math.floor(e.minuti / 60)) : '', minuti: e.minuti ? String(e.minuti % 60) : '', note: e.note ?? '',
      bar: e.bariloni.map((b) => numCampo(Number(b.kg), 3)) as string[] });
    const f = finestra(() => html`<h2>Modifica tappa</h2>
      <p class="sub" style="margin-bottom:var(--space-4)">${testoEvento(e, l)[0]}</p>
      ${erroreModulo(m)}
      ${campo(m, 'data', 'Data e ora', { type: 'datetime-local' })}
      ${e.tipo === 'spostamento' ? campo(m, 'arnie', 'Arnie spostate', { numero: true, inputmode: 'numeric' }) : nothing}
      ${e.mezzo && e.mezzo.tipo !== 'terzi' ? campo(m, 'km', 'Km', { numero: true, unita: 'km' }) : nothing}
      ${e.mezzo && e.mezzo.tipo === 'terzi' ? campo(m, 'costo', 'Costo del viaggio', { numero: true, unita: '€' }) : nothing}
      ${e.tipo === 'smielatura' ? html`${(m.v.bar as string[]).map((b, i) => html`<div class="field"><label for=${`mb${i}`}>Barilone ${i + 1}</label>
        <div class="unit"><input class="input numero" id=${`mb${i}`} inputmode="decimal" .value=${live(b)} @input=${(ev2: Event) => { (m.v.bar as string[])[i] = (ev2.target as HTMLInputElement).value; }}><span>kg</span></div></div>`)}` : nothing}
      ${campiTempo(m)}
      ${area(m, 'note', 'Note')}
      ${e.tipo === 'confezionamento' || e.tipo === 'chiusura' ? html`<p class="small">I pezzi confezionati non si cambiano da qui: per correggere il magazzino usa una rettifica.</p>` : nothing}
      <div class="btns"><button class="btn quiet" @click=${() => f.chiudi()}>Annulla</button>
      ${bottoneInvio(m, 'Salva', async () => {
        m.err = {};
        const min = leggiTempo(m);
        const v: Parameters<typeof api.aggiornaEvento>[1] = { data: fromLocal(m.v.data), minuti: min, note: m.v.note.trim() || null };
        if (e.tipo === 'spostamento') v.arnie = parseNum(m.v.arnie);
        if (e.mezzo && e.mezzo.tipo !== 'terzi') { const k = parseNum(m.v.km); if (k == null || k < 0) m.errore('km', 'Scrivi i km'); v.km = k; }
        if (e.mezzo && e.mezzo.tipo === 'terzi') { const c = parseNum(m.v.costo); if (c == null || c < 0) m.errore('costo', 'Scrivi il costo'); v.costo_terzi = c; }
        const bar = (m.v.bar as string[]).map(parseNum);
        if (bar.some((b) => b == null || b <= 0)) m.errore('_', 'Ogni barilone deve avere un peso maggiore di zero');
        if (await m.invia(async () => {
          await api.aggiornaEvento(e.id, v);
          for (let i = 0; i < e.bariloni.length; i++) if (Number(e.bariloni[i].kg) !== bar[i]) await api.aggiornaBarilone(e.bariloni[i].id, bar[i]!);
        })) { f.chiudi(); toast('Tappa aggiornata'); ricarica(); }
      }, 'primary')}</div>`);
  }

  return {
    titolo: 'Lotto', tab: 'produzione', genitore: { path: '/produzione', titolo: 'Produzione' },
    async carica() {
      [l, ev, vas, costiConf] = await Promise.all([api.lotto(id), api.eventiLotto(id).then((x) => x.sort((a, b) => Number(a.tipo === 'chiusura') - Number(b.tipo === 'chiusura'))), api.costoVasettiLotto(id), api.costoVasetti(),
        carica('prodotti', 'mezzi', 'postazioni'), catalogo()]) as [T.Lotto, T.EventoLotto[], T.CostoVasettoLotto[], T.CostoVasetto[], void, unknown];
      this.titolo = l.codice;
      const dedicati = [...new Set(ev.filter((e) => e.mezzo?.tipo === 'dedicato').map((e) => e.mezzo_id!))];
      await Promise.all(dedicati.map(async (m) => costoKmMezzo.set(m, Number(await api.costoKm(l.anno, m)))));
    },
    vista() {
      const aperto = l.stato === 'aperto', haSm = l.kg_smielati > 0;
      const c = (!aperto && l.dettaglio_congelato) ? l.dettaglio_congelato : l.dettaglio_attuale;
      const kmTot = ev.reduce((a, e) => a + Number(e.km ?? 0), 0), minTot = ev.reduce((a, e) => a + Number(e.minuti ?? 0), 0);
      const kgVas = ev.filter((e) => e.tipo === 'confezionamento').reduce((a, e) => a + e.righe.reduce((s, r) => s + r.pezzi * pesoVar(r.variante_id), 0), 0);
      const viaggi = new Map<number, { nome: string; tipo: string; km: number; costo: number }>();
      ev.forEach((e) => { if (!e.mezzo_id || !e.mezzo) return; const x = viaggi.get(e.mezzo_id) ?? { nome: e.mezzo.nome, tipo: e.mezzo.tipo, km: 0, costo: 0 };
        x.km += Number(e.km ?? 0);
        x.costo += e.mezzo.tipo === 'terzi' ? Number(e.costo_terzi ?? 0) : e.mezzo.tipo === 'personale' ? Number(e.km ?? 0) * Number(mezzo(e.mezzo_id)?.tariffa_km ?? 0) : Number(e.km ?? 0) * (costoKmMezzo.get(e.mezzo_id) ?? 0);
        viaggi.set(e.mezzo_id, x); });
      const formati = formatiDi(l.tipo_miele_id);
      const righeVas = formati.map((v) => {
        const fz = vas.find((x) => x.variante_id === v.id);
        const cc = costiConf.find((x) => x.variante_id === v.id);
        const tot = !aperto && fz ? Number(fz.costo_totale) : Number(cc?.costo_confezione ?? 0) + Number(v.peso_kg) * Number(c.costo_kg);
        const pr = variante(v.id)?.prezzo_corrente ?? null;
        return { v, tot, pr };
      });
      return html`
      ${testa(l.codice, { extra: badgeLotto(l), sub: `${l.tipo_miele} ${l.anno}. Km ${num(kmTot, 0)}, tempo ${durata(minTot)}.` })}
      ${aperto ? html`<div class="row wrap" style="margin-bottom:var(--space-5)"><div class="btns" style="margin:0">
          <a class="btn" href=${`/produzione/lotti/${id}/spostamento`}>${icon('piu')} Spostamento</a>
          <a class="btn" href=${`/produzione/lotti/${id}/smielatura`}>${icon('piu')} Smielatura</a>
          ${haSm ? html`<a class="btn" href=${`/produzione/lotti/${id}/confezionamento`}>${icon('piu')} Confezionamento</a>` : nothing}</div>
          ${haSm ? html`<a class="btn pending" href=${`/produzione/lotti/${id}/chiusura`}>Chiudi il lotto</a>` : nothing}</div>` : nothing}
      ${aperto && l.ricordami_chiusura ? html`<div class="note" style="margin-bottom:var(--space-5)">Chiusura rimandata: quando hai un momento, segna il miele rimasto e i vasetti per te.</div>` : nothing}
      ${l.dati_cambiati ? html`<div class="note" style="margin-bottom:var(--space-5)">Dopo la chiusura sono cambiati alcuni dati (acquisti, attrezzatura o impostazioni).
        Il costo congelato è <b>${eur(l.costo_kg_congelato)}</b> al kg; ricalcolato oggi sarebbe <b>${eur(l.costo_kg_attuale)}</b>.
        <div class="btns"><button class="btn sm" ?disabled=${busy} @click=${() => azione(() => api.ricalcolaLotto(id), 'Costo ricalcolato')}>Ricalcola il costo</button></div></div>` : nothing}
      <div class="cols">
        <div>
          <div class="kpis compact" style="grid-template-columns:repeat(3,minmax(0,1fr))">${kpi('Smielati', kg(l.kg_smielati))}${kpi('In vasetti', kg(kgVas))}${kpi('Sfuso', kg(l.kg_sfuso))}</div>
          <section class="card mt2"><h2 style="margin-bottom:var(--space-4)">Tappe</h2>
            ${ev.length ? html`<ol class="timeline">${ev.map((e) => { const [t, m] = testoEvento(e, l); return html`<li><span class="dot ${e.tipo}"></span>
              <div class="row" style="align-items:flex-start"><div class="grow"><div class="t">${t}</div><div class="m">${fd(e.data)}${m ? `: ${m}` : ''}</div></div>
              <button class="iconbtn" aria-label=${`Modifica: ${t}`} @click=${() => modificaEvento(e)}>${icon('matita')}</button></div></li>`; })}</ol>`
              : html`<p class="sub">Nessuna tappa ancora: inizia con uno spostamento o una smielatura.</p>`}
          </section>
        </div>
        <section class="card">
          <div class="card-head"><h2>Costo del lotto</h2>${aperto ? badge('Stima', 'soft') : badge(`Congelato il ${fd(l.dettaglio_congelato ? l.data_chiusura : null)}`, 'plain')}</div>
          ${haSm ? html`<div class="costrows">
            <div class="cr"><div><div>Quota della stagione ${l.anno}</div><div class="m">${eur(c.stagione.per_kg)} al kg per ${kg(c.kg_smielati)} smielati</div></div><span class="v">${eur(c.quota_stagione)}</span></div>
            <div class="cr"><div><div>Viaggi e carburante</div>${[...viaggi.values()].map((x) => html`<div class="m">${x.nome}: ${x.tipo === 'terzi' ? `costo dei viaggi ${eur(x.costo)}` : `${num(x.km, 0)} km a ${eurCost(x.km ? x.costo / x.km : 0)} al km, ${eur(x.costo)}`}</div>`)}</div><span class="v">${eur(c.viaggi)}</span></div>
            <div class="cr"><div><div>Tempo</div><div class="m">${durata(c.minuti)} al valore orario delle impostazioni</div></div><span class="v">${eur(c.ore)}</span></div>
            ${Number(c.confezioni_personali) ? html`<div class="cr"><span>Confezione dei vasetti per te</span><span class="v">${eur(c.confezioni_personali)}</span></div>` : nothing}
            <div class="tot"><span>Totale su ${kg(c.kg_vendibili)} ${aperto ? 'smielati' : 'vendibili'}</span><span class="v">${eur(c.costo_kg)} al kg</span></div>
            <div class="table-wrap mt"><table class="t"><thead><tr><th>Formato</th><th class="r">Costo vasetto</th><th class="r">Prezzo</th><th class="r">Margine</th></tr></thead>
              <tbody>${righeVas.map((x) => html`<tr><td>${x.v.formato}</td><td class="r">${eur(x.tot)}</td><td class="r">${eur(x.pr)}</td>
                <td class="r">${x.pr != null ? `${eur(x.pr - x.tot)} (${num(((x.pr - x.tot) / x.pr) * 100, 0)}%)` : '—'}</td></tr>`)}</tbody></table></div>
          </div>` : html`<p class="sub">Il costo si calcola dopo la prima smielatura.</p>`}
        </section>
      </div>`;
    },
  };
}

// ---------------------------------------------------------------- tappe
type Tappa = 'spostamento' | 'smielatura' | 'confezionamento' | 'chiusura';
const TITOLI: Record<Tappa, string> = { spostamento: 'Spostamento arnie', smielatura: 'Smielatura', confezionamento: 'Confezionamento', chiusura: 'Chiusura del lotto' };

export function tappa(p: Record<string, string>): Pagina {
  const id = Number(p.id), tipo = p.tappa as Tappa;
  let l: T.Lotto; let giac: T.GiacenzaArticolo[] = [];
  const m = new Modulo({ data: isoLocal(), postazione: '', nuova: '', arnie: '', mezzo: '', km: '', costo_terzi: '', ore: '', minuti: '', note: '', rimasto: '' });
  const bar: string[] = [''];
  const pz: Record<number, string> = {};
  let kmToccati = false;
  let fatto = false;
  const origSet = m.set.bind(m);
  m.set = (k, v) => { if (k === 'km') kmToccati = true; origSet(k, v); };

  const formati = () => formatiDi(l.tipo_miele_id);
  const kgDi = () => formati().reduce((a, v) => a + (Number(pz[v.id]) || 0) * Number(v.peso_kg), 0);
  /** materiali che mancano per i vasetti scritti */
  function mancanti(): string[] {
    const serve = new Map<number, number>();
    formati().forEach((v) => { const n = Number(pz[v.id]) || 0; if (n) v.distinta.forEach((d) => serve.set(d.articolo_id, (serve.get(d.articolo_id) ?? 0) + n * Number(d.quantita))); });
    return [...serve].filter(([a, q]) => (Number(giac.find((g) => g.articolo_id === a)?.giacenza) || 0) < q)
      .map(([a, q]) => { const g = giac.find((x) => x.articolo_id === a); return `${g?.codice ?? g?.nome ?? articolo(a)?.nome}: servono ${num(q, 0)}, ci sono ${num(Number(g?.giacenza ?? 0), 0)}`; });
  }

  async function salva() {
    m.err = {};
    const minuti = leggiTempo(m, tipo === 'spostamento');
    const data = m.v.data ? fromLocal(m.v.data) : new Date().toISOString();
    let ok = false;
    if (tipo === 'spostamento') {
      if (m.v.postazione === '__nuova' && !m.v.nuova.trim()) m.errore('nuova', 'Scrivi il nome della nuova postazione');
      if (!m.v.postazione) m.errore('postazione', 'Scegli la postazione');
      const via = leggiViaggio(m, true);
      ok = await m.invia(async () => {
        let pid = Number(m.v.postazione);
        if (m.v.postazione === '__nuova') {
          const r = await api.salva('postazioni', { nome: m.v.nuova.trim(), km_abituali: via.km }) as { id: number };
          pid = r.id; invalida('postazioni');
          // se poi lo spostamento non va a buon fine, al nuovo tentativo la postazione è già in lista
          rif.postazioni.push({ id: pid, nome: m.v.nuova.trim(), localita: null, km_abituali: via.km, arnie: null, note: null, archiviato: false });
          m.v.postazione = String(pid); m.v.nuova = '';
        }
        await api.registraEvento({ lotto: id, tipo: 'spostamento', data, postazione: pid, mezzo: via.mezzo, km: via.km, costo_terzi: via.costo_terzi, minuti, arnie: parseNum(m.v.arnie), note: m.v.note.trim() });
      });
      if (ok) toast('Spostamento registrato');
    }
    if (tipo === 'smielatura') {
      const kgB = bar.map(parseNum).filter((x): x is number => x != null && x > 0);
      if (bar.some((b) => b.trim() && (parseNum(b) == null || parseNum(b)! <= 0))) m.errore('_', 'Controlla i pesi: devono essere numeri maggiori di zero');
      else if (!kgB.length) m.errore('_', 'Scrivi il peso di almeno un barilone');
      const via = leggiViaggio(m, false);
      ok = await m.invia(() => api.registraEvento({ lotto: id, tipo: 'smielatura', data, bariloni: kgB, minuti, mezzo: via.mezzo, km: via.km, costo_terzi: via.costo_terzi, note: m.v.note.trim() }));
      if (ok) toast(`${kg(kgB.reduce((a, b) => a + b, 0))} nel magazzino miele sfuso`);
    }
    if (tipo === 'confezionamento' || tipo === 'chiusura') {
      const righe = formati().map((v) => ({ variante_id: v.id, pezzi: Number(pz[v.id]) || 0 })).filter((r) => r.pezzi);
      if (formati().some((v) => pz[v.id] && (!Number.isInteger(Number(pz[v.id])) || Number(pz[v.id]) < 0))) m.errore('_', 'I vasetti si contano a numeri interi');
      if (tipo === 'confezionamento' && !righe.length) m.errore('_', 'Scrivi quanti vasetti hai riempito');
      if (kgDi() > Number(l.kg_sfuso) + 1e-6) m.errore('_', `Il miele del lotto non basta: servono ${kg(kgDi(), 2)}, ne restano ${kg(l.kg_sfuso, 2)}`);
      if (tipo === 'confezionamento') {
        const via = leggiViaggio(m, false);
        ok = await m.invia(() => api.confeziona({ lotto: id, righe, data, minuti, mezzo: via.mezzo, km: via.km, costo_terzi: via.costo_terzi, note: m.v.note.trim() }));
        if (ok) toast(`Caricati ${righe.reduce((a, r) => a + r.pezzi, 0)} vasetti di ${l.tipo_miele}`);
      } else {
        const rim = parseNum(m.v.rimasto);
        const max = Number(l.kg_sfuso) - kgDi();
        if (rim == null || rim < 0) m.errore('rimasto', 'Scrivi quanto miele è rimasto, anche 0');
        else if (rim > max + 0.0005) m.errore('rimasto', `Risulta al massimo ${kg(max, 2)}: controlla il peso o registra la smielatura mancante`);
        ok = await m.invia(async () => {
          const r = await api.chiudiLotto({ lotto: id, kg_rimasto: rim ?? 0, uso_personale: righe, data: (m.v.data || isoLocal()).slice(0, 10), minuti, note: m.v.note.trim() });
          toast(`Lotto chiuso: costo congelato a ${eur(Number(r.costo_kg))} al kg`);
        });
      }
    }
    if (ok) { fatto = true; vai(`/produzione/lotti/${id}`, { replace: true }); }
  }

  return {
    titolo: TITOLI[tipo] ?? 'Tappa', tab: 'produzione', genitore: { path: `/produzione/lotti/${id}`, titolo: 'Lotto' },
    modificata: () => !fatto && m.modificato(),
    async carica() {
      if (!TITOLI[tipo]) throw new AppError('Tappa sconosciuta.');
      [l, giac] = await Promise.all([api.lotto(id), api.giacenzeArticoli(), carica('postazioni', 'mezzi', 'prodotti', 'articoli'), catalogo()]) as [T.Lotto, T.GiacenzaArticolo[], void, unknown];
      if (l.stato === 'chiuso') throw new AppError('Il lotto è già chiuso: le tappe non si possono più aggiungere.');
      if (tipo === 'spostamento') {
        const pos = rif.postazioni.filter((x) => !x.archiviato);
        m.v.postazione = pos.length ? String(pos[0].id) : '__nuova';
        m.v.mezzo = String(rif.mezzi.find((x) => x.tipo === 'dedicato' && !x.archiviato)?.id ?? rif.mezzi[0]?.id ?? '');
        if (pos[0]?.km_abituali != null) m.v.km = numCampo(Number(pos[0].km_abituali), 1);
      }
      if (tipo === 'chiusura') m.v.data = isoDate() + 'T12:00';
      m.pulito();
    },
    vista() {
      const pos = rif.postazioni.filter((x) => !x.archiviato);
      // proponi i km abituali quando cambia la postazione (finché l'utente non li tocca)
      const onPost = (v: string) => { const x = pos.find((q) => String(q.id) === v); if (!kmToccati && x?.km_abituali != null) { m.v.km = numCampo(Number(x.km_abituali), 1); aggiorna(); } };
      const manc = mancanti();
      const campoVasetti = (label: string) => html`<fieldset style="border:0;padding:0;margin:0 0 var(--space-4)"><legend class="label" style="margin-bottom:6px">${label}</legend>
        <div class="row-fields">${formati().map((v) => html`<div class="field" style="margin:0"><label for=${`pz${v.id}`}>${v.formato}</label>
          <input class="input numero" id=${`pz${v.id}`} type="number" inputmode="numeric" min="0" step="1" placeholder="0" .value=${live(pz[v.id] ?? '')}
            @input=${(e: Event) => { pz[v.id] = (e.target as HTMLInputElement).value; delete m.err._; aggiorna(); }}></div>`)}</div>
        ${kgDi() ? html`<p class="hint mt">${kg(kgDi(), 2)} di miele${tipo === 'confezionamento' ? `, nel lotto ne restano ${kg(l.kg_sfuso, 2)}` : ''}</p>` : nothing}
        ${manc.length ? html`<div class="note danger mt">Materiale insufficiente: ${manc.join('; ')}. Registra prima l'acquisto.</div>` : nothing}</fieldset>`;

      const corpo: Record<Tappa, () => TemplateResult> = {
        spostamento: () => html`
          ${campo(m, 'data', 'Data e ora', { type: 'datetime-local', hint: 'Puoi registrarlo anche il giorno dopo: cambia data e ora' })}
          ${scelta(m, 'postazione', 'Postazione', [...pos.map((x) => ({ v: x.id, l: x.nome })), { v: '__nuova', l: '+ Nuova postazione' }], { onChange: onPost })}
          ${m.v.postazione === '__nuova' ? campo(m, 'nuova', 'Nome della nuova postazione', { placeholder: 'Robinieto di Porpetto', hint: 'La trovi poi in Anagrafiche, dove puoi aggiungere località e arnie' }) : nothing}
          ${campo(m, 'arnie', 'Arnie spostate', { numero: true, inputmode: 'numeric', placeholder: '10' })}
          ${campiViaggio(m, true)}
          ${campiTempo(m)}
          ${campo(m, 'note', 'Note (facoltative)', { placeholder: 'Spostate di notte, api tutte in arnia' })}`,
        smielatura: () => html`
          ${campo(m, 'data', 'Data e ora', { type: 'datetime-local' })}
          <fieldset style="border:0;padding:0;margin:0"><legend class="label" style="margin-bottom:6px">Peso dei bariloni</legend>
          ${bar.map((b, i) => html`<div class="field"><label for=${`b${i}`}>Barilone ${i + 1}</label>
            <div class="row" style="gap:var(--space-2)"><div class="unit grow"><input class="input numero" id=${`b${i}`} inputmode="decimal" placeholder="48,5" .value=${live(b)}
              @input=${(e: Event) => { bar[i] = (e.target as HTMLInputElement).value; delete m.err._; aggiorna(); }}><span>kg</span></div>
              ${bar.length > 1 ? html`<button class="iconbtn" type="button" aria-label=${`Togli barilone ${i + 1}`} @click=${() => { bar.splice(i, 1); aggiorna(); }}>${icon('x')}</button>` : nothing}</div></div>`)}
          <button class="btn" type="button" @click=${() => { bar.push(''); aggiorna(); requestAnimationFrame(() => (document.getElementById(`b${bar.length - 1}`) as HTMLInputElement)?.focus()); }}>${icon('piu')} Aggiungi barilone</button>
          <p class="hint mt">Totale: ${kg(bar.map(parseNum).reduce<number>((a, x) => a + (x ?? 0), 0), 1)}</p></fieldset>
          <div class="mt2">${campiTempo(m)}${campiViaggio(m, false)}${campo(m, 'note', 'Note (facoltative)')}</div>`,
        confezionamento: () => html`
          <p class="sub" style="margin-bottom:var(--space-4)">Nel lotto restano ${kg(l.kg_sfuso, 2)}. Vasetti, tappi, etichette e sigilli si scalano da soli.</p>
          ${campo(m, 'data', 'Data e ora', { type: 'datetime-local' })}
          ${campoVasetti('Vasetti riempiti')}
          ${campiTempo(m)}${campiViaggio(m, false)}${campo(m, 'note', 'Note (facoltative)')}`,
        chiusura: () => html`
          <p style="margin-bottom:var(--space-4)">Secondo i conti restano <b>${kg(l.kg_sfuso, 2)}</b> di miele sfuso.</p>
          ${campo(m, 'data', 'Data', { type: 'datetime-local' })}
          ${campoVasetti('Vasetti che tieni per te, anche non pieni')}
          ${campo(m, 'rimasto', 'Miele rimasto nel barilone', { numero: true, unita: 'kg', placeholder: '0', hint: 'La differenza con i conti diventa calo. Alla chiusura il costo del lotto viene congelato.' })}
          ${campiTempo(m)}${campo(m, 'note', 'Note (facoltative)')}`,
      };
      return html`${testa(TITOLI[tipo], { sub: `${l.codice} · ${l.tipo_miele} ${l.anno}` })}
        <div class="form">
          ${erroreModulo(m)}
          ${corpo[tipo]()}
          <div class="btns">
            ${bottoneInvio(m, tipo === 'confezionamento' ? 'Carica in magazzino' : tipo === 'chiusura' ? 'Chiudi il lotto' : `Registra ${tipo}`, salva, 'primary')}
            ${tipo === 'chiusura' ? html`<button class="btn" @click=${async () => {
              try { await api.ricordamiChiusura(id); fatto = true; toast('Te lo ricordo in Home'); vai(`/produzione/lotti/${id}`, { replace: true }); } catch (e) { toast(messaggioErrore(e), true); }
            }}>Ricordamelo dopo</button>` : nothing}
          </div>
        </div>`;
    },
  };
}

// ---------------------------------------------------------------- attività della stagione
export function nuovaAttivita(_p: Record<string, string>, q: URLSearchParams): Pagina {
  const tipo = q.get('tipo') === 'trattamento' ? 'trattamento' : 'nutrizione';
  let giac: T.GiacenzaArticolo[] = [];
  const m = new Modulo({ data: isoDate(), articolo: '', quantita: '', unita: '', tutte: true as boolean, ore: '', minuti: '', note: '' });
  const scelte = new Set<number>();
  let fatto = false;
  const art = () => rif.articoli.filter((a) => !a.archiviato && a.magazzino === 'apistiche' && rif.categorie.find((c) => c.id === a.categoria_id)?.codice === (tipo === 'nutrizione' ? 'ali' : 'trat'));
  const tutti = () => rif.articoli.filter((a) => !a.archiviato && a.magazzino === 'apistiche');

  return {
    titolo: tipo === 'nutrizione' ? 'Nutrizione' : 'Trattamento', tab: 'produzione', genitore: { path: '/produzione', titolo: 'Produzione' },
    modificata: () => !fatto && m.modificato(),
    async carica() {
      [giac] = await Promise.all([api.giacenzeArticoli(), carica('articoli', 'categorie', 'postazioni')]) as [T.GiacenzaArticolo[], void];
      const lista = art().length ? art() : tutti();
      m.v.articolo = String(lista[0]?.id ?? ''); m.v.unita = ''; m.pulito();
    },
    vista() {
      const lista = art().length ? art() : tutti();
      const a = articolo(Number(m.v.articolo));
      const g = (id: number) => Number(giac.find((x) => x.articolo_id === id)?.giacenza ?? 0);
      const pos = rif.postazioni.filter((x) => !x.archiviato);
      return html`${testa(tipo === 'nutrizione' ? 'Nutrizione' : 'Trattamento', { sub: 'Scala il magazzino materie apistiche; il costo si divide tra i lotti dell\'anno.' })}
        <div class="form">
          ${erroreModulo(m)}
          ${campo(m, 'data', 'Data', { type: 'date' })}
          ${lista.length ? scelta(m, 'articolo', 'Articolo usato', lista.map((x) => ({ v: x.id, l: `${x.nome} (hai ${qtyArticolo(g(x.id), x.unita, x.confezioni)})` })), { onChange: () => { m.v.unita = ''; } })
            : html`<div class="note danger">Non ci sono articoli nel magazzino materie apistiche: registra prima un acquisto.</div>`}
          ${a ? html`<div class="row-fields">${campo(m, 'quantita', 'Quantità', { numero: true, placeholder: '1' })}
            ${scelta(m, 'unita', 'Unità', [{ v: '', l: a.unita }, ...a.confezioni.map((c) => ({ v: c.id, l: `${c.nome} da ${num(Number(c.quantita), 2)} ${a.unita}` }))])}</div>` : nothing}
          <fieldset style="border:0;padding:0;margin:0 0 var(--space-4)"><legend class="label">Postazioni</legend>
            <label class="check"><input type="checkbox" .checked=${live(!!m.v.tutte)} @change=${(e: Event) => m.set('tutte', (e.target as HTMLInputElement).checked)}> Tutte le postazioni</label>
            ${!m.v.tutte ? html`<div class="chips">${pos.map((x) => html`<label><input type="checkbox" .checked=${scelte.has(x.id)}
              @change=${(e: Event) => { (e.target as HTMLInputElement).checked ? scelte.add(x.id) : scelte.delete(x.id); aggiorna(); }}> ${x.nome}${x.arnie ? html` <span class="small">(${x.arnie} arnie)</span>` : nothing}</label>`)}</div>` : nothing}
          </fieldset>
          ${campiTempo(m)}
          ${campo(m, 'note', 'Note (facoltative)', { placeholder: tipo === 'trattamento' ? '2 strisce per arnia' : '' })}
          <div class="btns">${bottoneInvio(m, 'Registra', async () => {
            m.err = {};
            const qta = parseNum(m.v.quantita);
            if (!a) m.errore('articolo', 'Scegli l\'articolo usato');
            if (qta == null || qta <= 0) m.errore('quantita', 'Scrivi la quantità usata');
            if (!m.v.tutte && !scelte.size) m.errore('_', 'Scegli almeno una postazione, oppure "Tutte le postazioni"');
            const conf = m.v.unita ? Number(m.v.unita) : null;
            const base = (qta ?? 0) * (conf ? Number(a?.confezioni.find((c) => c.id === conf)?.quantita ?? 1) : 1);
            if (a && qta && base > g(a.id) + 1e-9) m.errore('quantita', `Ne hai solo ${qtyArticolo(g(a.id), a.unita, a.confezioni)}: registra prima l'acquisto`);
            const minuti = leggiTempo(m);
            if (await m.invia(() => api.registraAttivita({ tipo, data: m.v.data, articolo: a!.id, quantita: qta!, confezione: conf, minuti, note: m.v.note.trim(), postazioni: m.v.tutte ? null : [...scelte] }))) {
              fatto = true; toast(`${tipo === 'nutrizione' ? 'Nutrizione' : 'Trattamento'} registrato`); vai('/produzione', { replace: true });
            }
          }, 'primary')}</div>
        </div>`;
    },
  };
}

