/** Anagrafiche (clienti, fornitori, postazioni, mezzi) e anagrafica articoli (articoli, prodotti in vendita). */
import { html, nothing, type TemplateResult } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import type { Pagina } from '../app';
import { aggiorna, ricarica } from '../app';
import * as api from '../lib/api';
import { rif, carica, invalida, categoria } from '../lib/rif';
import { catalogo, invalidaCatalogo, grammi } from '../lib/catalogo';
import { eur, eurCost, num, parseNum, capitalizza } from '../lib/format';
import { messaggioErrore } from '../lib/errors';
import { icon } from '../ui/icons';
import { Modulo, campo, scelta, area, testa, toast, chiedi, erroreModulo, bottoneInvio, riga, lista, kpi, segmenti, finestra } from '../ui/kit';
import { prezzo as apriPrezzo } from './magazzino';
import type * as T from '../lib/types';

/** Elimina se mai usato, altrimenti propone di archiviare. */
async function rimuovi(tabella: string, id: number, nome: string, chiudi: () => void, campoArchivio = 'archiviato') {
  if (!(await chiedi(`Togliere ${nome}?`, 'Se non è mai stato usato viene cancellato; altrimenti lo archivio: sparisce dai menu ma resta nello storico.', 'Togli', true))) return;
  try {
    const r = await api.eliminaSePossibile(tabella, id);
    if (r === 'usato') { await api.salva(tabella, { [campoArchivio]: campoArchivio === 'attivo' ? false : true }, id); toast(`${nome}: archiviato`); }
    else toast(`${nome}: eliminato`);
    chiudi(); invalida(); invalidaCatalogo(); ricarica();
  } catch (e) { toast(messaggioErrore(e), true); }
}
const ripristina = async (tabella: string, id: number, campoArchivio = 'archiviato') => {
  try { await api.salva(tabella, { [campoArchivio]: campoArchivio === 'attivo' }, id); toast('Riattivato'); invalida(); invalidaCatalogo(); ricarica(); }
  catch (e) { toast(messaggioErrore(e), true); }
};
const archiviati = (righe: { id: number; nome: string }[], tabella: string, campoArchivio = 'archiviato') => righe.length
  ? html`<details class="more mt"><summary>Archiviati (${righe.length})</summary>${lista(righe.map((x) => riga({ t: x.nome, cls: 'archived',
    extra: html`<button class="btn sm" @click=${() => ripristina(tabella, x.id, campoArchivio)}>Riattiva</button>` })))}</details>` : nothing;

// ---------------------------------------------------------------- anagrafiche
type VistaA = 'clienti' | 'fornitori' | 'postazioni' | 'mezzi';
export function anagrafiche(q: URLSearchParams): Pagina {
  let vista = (q.get('vista') as VistaA) || 'clienti';
  let clienti: T.Cliente[] = []; let cerca = '';
  const costoKm = new Map<number, number>();
  const anno = new Date().getFullYear();

  function modCliente(c?: T.Cliente) {
    const m = new Modulo({ nome: c?.nome ?? '', cognome: c?.cognome ?? '', telefono: c?.telefono ?? '', tipo: c?.tipo ?? 'privato', note: c?.note ?? '' });
    const f = finestra(() => html`<h2>${c ? 'Modifica cliente' : 'Nuovo cliente'}</h2>${erroreModulo(m)}
      <div class="row-fields">${campo(m, 'nome', 'Nome')}${campo(m, 'cognome', 'Cognome')}</div>
      <div class="row-fields">${campo(m, 'telefono', 'Telefono', { type: 'tel', inputmode: 'tel' })}${scelta(m, 'tipo', 'Tipo', [{ v: 'privato', l: 'Privato' }, { v: 'azienda', l: 'Azienda (bar, negozio)' }])}</div>
      ${area(m, 'note', 'Note')}
      <p class="hint" style="margin-bottom:var(--space-4)">Per un'azienda: ragione sociale nel nome, un riferimento nel cognome.</p>
      <div class="btns">${c ? html`<button class="btn danger" @click=${() => rimuovi('clienti', c.id, `${c.nome} ${c.cognome}`, f.chiudi)}>Togli</button>` : nothing}
        <button class="btn quiet" @click=${() => f.chiudi()}>Annulla</button>
        ${bottoneInvio(m, 'Salva', async () => {
          m.err = {};
          if (!m.v.nome.trim()) m.errore('nome', 'Scrivi il nome');
          const dup = clienti.find((x) => x.id !== c?.id && `${x.nome} ${x.cognome}`.toLowerCase() === `${m.v.nome} ${m.v.cognome}`.trim().toLowerCase());
          if (dup) m.errore('nome', 'Esiste già un cliente con questo nome');
          if (await m.invia(() => api.salva('clienti', { nome: capitalizza(m.v.nome), cognome: capitalizza(m.v.cognome), telefono: m.v.telefono.trim() || null, tipo: m.v.tipo, note: m.v.note.trim() || null }, c?.id))) {
            f.chiudi(); toast(c ? 'Cliente aggiornato' : 'Cliente aggiunto'); ricarica();
          }
        }, 'primary')}</div>`);
  }
  function modFornitore(x?: T.Fornitore) {
    const m = new Modulo({ nome: x?.nome ?? '', telefono: x?.telefono ?? '', piva: x?.partita_iva ?? '', note: x?.note ?? '' });
    const f = finestra(() => html`<h2>${x ? 'Modifica fornitore' : 'Nuovo fornitore'}</h2>${erroreModulo(m)}
      ${campo(m, 'nome', 'Nome', { placeholder: 'Consorzio Apicoltori FVG' })}
      <div class="row-fields">${campo(m, 'telefono', 'Telefono', { type: 'tel', inputmode: 'tel' })}${campo(m, 'piva', 'Partita IVA', { inputmode: 'numeric' })}</div>
      ${area(m, 'note', 'Note')}
      <div class="btns">${x ? html`<button class="btn danger" @click=${() => rimuovi('fornitori', x.id, x.nome, f.chiudi)}>Togli</button>` : nothing}
        <button class="btn quiet" @click=${() => f.chiudi()}>Annulla</button>
        ${bottoneInvio(m, 'Salva', async () => {
          m.err = {}; if (!m.v.nome.trim()) m.errore('nome', 'Scrivi il nome');
          if (await m.invia(() => api.salva('fornitori', { nome: m.v.nome.trim(), telefono: m.v.telefono.trim() || null, partita_iva: m.v.piva.trim() || null, note: m.v.note.trim() || null }, x?.id))) {
            f.chiudi(); invalida('fornitori'); toast(x ? 'Fornitore aggiornato' : 'Fornitore aggiunto'); ricarica();
          }
        }, 'primary')}</div>`);
  }
  function modPostazione(p?: T.Postazione) {
    const m = new Modulo({ nome: p?.nome ?? '', localita: p?.localita ?? '', km: p?.km_abituali != null ? num(Number(p.km_abituali), 1) : '', arnie: p?.arnie != null ? String(p.arnie) : '', note: p?.note ?? '' });
    const f = finestra(() => html`<h2>${p ? 'Modifica postazione' : 'Nuova postazione'}</h2>${erroreModulo(m)}
      <div class="row-fields">${campo(m, 'nome', 'Nome', { placeholder: 'Robinieto di Porpetto' })}${campo(m, 'localita', 'Località')}</div>
      <div class="row-fields">${campo(m, 'km', 'Km abituali, andata e ritorno', { numero: true, unita: 'km' })}${campo(m, 'arnie', 'Arnie in postazione', { numero: true, inputmode: 'numeric' })}</div>
      ${area(m, 'note', 'Note')}
      <p class="hint" style="margin-bottom:var(--space-4)">Cambiare il nome lo aggiorna anche nelle registrazioni passate. Una postazione già usata non si cancella: si archivia.</p>
      <div class="btns">${p ? html`<button class="btn danger" @click=${() => rimuovi('postazioni', p.id, p.nome, f.chiudi)}>Togli</button>` : nothing}
        <button class="btn quiet" @click=${() => f.chiudi()}>Annulla</button>
        ${bottoneInvio(m, 'Salva', async () => {
          m.err = {}; if (!m.v.nome.trim()) m.errore('nome', 'Scrivi il nome');
          const k = parseNum(m.v.km), a = m.v.arnie ? Number(m.v.arnie) : null;
          if (m.v.km && (k == null || k < 0)) m.errore('km', 'Scrivi un numero di km');
          if (a != null && !(Number.isInteger(a) && a >= 0)) m.errore('arnie', 'Numero intero');
          if (await m.invia(() => api.salva('postazioni', { nome: m.v.nome.trim(), localita: m.v.localita.trim() || null, km_abituali: k, arnie: a, note: m.v.note.trim() || null }, p?.id))) {
            f.chiudi(); invalida('postazioni'); toast(p ? 'Postazione aggiornata ovunque' : 'Postazione aggiunta'); ricarica();
          }
        }, 'primary')}</div>`);
  }
  function modMezzo(x?: T.Mezzo) {
    const m = new Modulo({ nome: x?.nome ?? '', tipo: x?.tipo ?? 'dedicato', tariffa: x?.tariffa_km != null ? num(Number(x.tariffa_km), 3) : '0,15', note: x?.note ?? '' });
    const f = finestra(() => html`<h2>${x ? 'Modifica mezzo' : 'Nuovo mezzo'}</h2>${erroreModulo(m)}
      ${campo(m, 'nome', 'Nome', { placeholder: 'Fiorino' })}
      ${scelta(m, 'tipo', 'Come si calcola il costo', [{ v: 'dedicato', l: 'Dedicato alle api: costo dai rifornimenti' }, { v: 'personale', l: 'Uso misto: tariffa al km' }, { v: 'terzi', l: 'Di altri: costo per viaggio' }])}
      ${m.v.tipo === 'personale' ? campo(m, 'tariffa', 'Tariffa al km', { numero: true, unita: '€/km', hint: 'Solo carburante: l\'auto la useresti comunque' }) : nothing}
      ${area(m, 'note', 'Note')}
      <div class="btns">${x ? html`<button class="btn danger" @click=${() => rimuovi('mezzi', x.id, x.nome, f.chiudi)}>Togli</button>` : nothing}
        <button class="btn quiet" @click=${() => f.chiudi()}>Annulla</button>
        ${bottoneInvio(m, 'Salva', async () => {
          m.err = {}; if (!m.v.nome.trim()) m.errore('nome', 'Scrivi il nome');
          const t = parseNum(m.v.tariffa);
          if (m.v.tipo === 'personale' && (t == null || t < 0)) m.errore('tariffa', 'Scrivi la tariffa, per esempio 0,15');
          if (await m.invia(() => api.salva('mezzi', { nome: m.v.nome.trim(), tipo: m.v.tipo, tariffa_km: m.v.tipo === 'personale' ? t : null, note: m.v.note.trim() || null }, x?.id))) {
            f.chiudi(); invalida('mezzi'); toast(x ? 'Mezzo aggiornato' : 'Mezzo aggiunto'); ricarica();
          }
        }, 'primary')}</div>`);
  }

  return {
    titolo: 'Anagrafiche', tab: 'anagrafiche',
    async carica() {
      invalida('fornitori', 'postazioni', 'mezzi');
      [clienti] = await Promise.all([api.lista<T.Cliente>('clienti', 'cognome'), carica('fornitori', 'postazioni', 'mezzi')]) as [T.Cliente[], void];
      await Promise.all(rif.mezzi.filter((x) => x.tipo === 'dedicato').map(async (x) => costoKm.set(x.id, Number(await api.costoKm(anno, x.id)))));
    },
    vista() {
      let corpo: TemplateResult;
      if (vista === 'clienti') {
        const t = cerca.trim().toLowerCase();
        const el = clienti.filter((c) => !c.archiviato && (!t || `${c.nome} ${c.cognome} ${c.telefono ?? ''}`.toLowerCase().includes(t)));
        corpo = html`<div class="row wrap" style="margin-bottom:var(--space-4)"><input class="input grow" style="max-width:420px" type="search" placeholder="Cerca un cliente" aria-label="Cerca un cliente"
            .value=${live(cerca)} @input=${(e: Event) => { cerca = (e.target as HTMLInputElement).value; aggiorna(); }}>
          <button class="btn" @click=${() => modCliente()}>${icon('piu')} Nuovo cliente</button></div>
          ${lista(el.map((c) => riga({ onClick: () => modCliente(c), t: `${c.nome} ${c.cognome}`, m: `${c.tipo === 'azienda' ? 'Azienda' : 'Privato'}${c.telefono ? ` · ${c.telefono}` : ''}` })), t ? 'Nessun cliente trovato.' : 'Nessun cliente.')}
          ${archiviati(clienti.filter((c) => c.archiviato).map((c) => ({ id: c.id, nome: `${c.nome} ${c.cognome}` })), 'clienti')}`;
      } else if (vista === 'fornitori') {
        corpo = html`<div class="btns" style="margin:0 0 var(--space-4)"><button class="btn" @click=${() => modFornitore()}>${icon('piu')} Nuovo fornitore</button></div>
          ${lista(rif.fornitori.filter((x) => !x.archiviato).map((x) => riga({ onClick: () => modFornitore(x), t: x.nome,
            m: [x.telefono, x.partita_iva ? `P.IVA ${x.partita_iva}` : '', x.note].filter(Boolean).join(' · ') || 'Nessun dettaglio' })), 'Nessun fornitore.')}
          ${archiviati(rif.fornitori.filter((x) => x.archiviato), 'fornitori')}`;
      } else if (vista === 'postazioni') {
        const ps = rif.postazioni.filter((x) => !x.archiviato);
        corpo = html`<p class="sub" style="margin-bottom:var(--space-4)">I luoghi dove porti le api. Si scelgono dal menu negli spostamenti, nelle nutrizioni e nei trattamenti, così lo stesso posto non compare mai due volte con nomi diversi.</p>
          <div class="kpis compact" style="margin-bottom:var(--space-4)">${kpi('Postazioni', ps.length)}${kpi('Arnie', ps.reduce((a, x) => a + (x.arnie ?? 0), 0))}</div>
          <div class="btns" style="margin:0 0 var(--space-4)"><button class="btn" @click=${() => modPostazione()}>${icon('piu')} Nuova postazione</button></div>
          ${lista(ps.map((x) => riga({ onClick: () => modPostazione(x), t: x.nome,
            m: [x.localita, x.km_abituali != null ? `${num(Number(x.km_abituali), 0)} km andata e ritorno` : '', x.note].filter(Boolean).join(' · ') || 'Nessun dettaglio',
            v: html`${x.arnie ?? '—'}<small>arnie</small>` })), 'Nessuna postazione.')}
          ${archiviati(rif.postazioni.filter((x) => x.archiviato), 'postazioni')}`;
      } else {
        corpo = html`<p class="sub" style="margin-bottom:var(--space-4)">Ogni viaggio indica il mezzo. Dedicato: costo al km dai rifornimenti e dal contachilometri. Uso misto: tariffa fissa al km. Di altri: il costo del viaggio.</p>
          <div class="btns" style="margin:0 0 var(--space-4)"><button class="btn" @click=${() => modMezzo()}>${icon('piu')} Nuovo mezzo</button></div>
          ${lista(rif.mezzi.filter((x) => !x.archiviato).map((x) => riga({ onClick: () => modMezzo(x), t: x.nome,
            m: x.tipo === 'dedicato' ? 'Dedicato alle api: costo dai rifornimenti' : x.tipo === 'personale' ? 'Uso misto: nessun rifornimento da registrare' : 'Di altri: costo scritto a ogni viaggio',
            v: x.tipo === 'dedicato' ? html`${eurCost(costoKm.get(x.id) ?? 0)}<small>al km nel ${anno}</small>` : x.tipo === 'personale' ? html`${eurCost(Number(x.tariffa_km ?? 0))}<small>al km</small>` : '' })), 'Nessun mezzo.')}
          ${archiviati(rif.mezzi.filter((x) => x.archiviato), 'mezzi')}`;
      }
      return html`${testa('Anagrafiche')}
        ${segmenti<VistaA>([['clienti', 'Clienti'], ['fornitori', 'Fornitori'], ['postazioni', 'Postazioni'], ['mezzi', 'Mezzi']], vista,
          (k) => { vista = k; history.replaceState(history.state, '', `/anagrafiche?vista=${k}`); aggiorna(); }, 'Anagrafica')}
        ${corpo}`;
    },
  };
}

// ---------------------------------------------------------------- articoli e prodotti
type VistaR = 'articoli' | 'prodotti';
export function anagraficaArticoli(q: URLSearchParams): Pagina {
  let vista = (q.get('vista') as VistaR) || 'articoli';
  let spese: T.Spesa[] = []; let catProd: { id: number; nome: string }[] = []; let cat: T.Disponibilita[] = [];

  function modArticolo(a?: T.Articolo) {
    const usato = !!a && spese.some((s) => s.articolo_id === a.id);
    const m = new Modulo({ nome: a?.nome ?? '', cat: String(a?.categoria_id ?? rif.categorie.find((c) => c.codice === 'altro')?.id ?? ''), unita: a?.unita ?? 'pz',
      scorta: a?.scorta_minima != null ? num(Number(a.scorta_minima), 3) : '', codice: a?.codice ?? '', confNome: '', confQta: '' });
    const f = finestra(() => {
      const c = rif.categorie.find((x) => String(x.id) === m.v.cat);
      return html`<h2>${a ? 'Modifica articolo' : 'Nuovo articolo'}</h2>${erroreModulo(m)}
      ${campo(m, 'nome', 'Nome', { placeholder: 'Sciroppo zuccherino' })}
      ${usato ? html`<p class="hint" style="margin-bottom:var(--space-4)">Categoria ${categoria(a!.categoria_id)?.nome}, unità ${a!.unita}: non modificabili perché l'articolo è già stato acquistato.</p>`
        : html`<div class="row-fields">${scelta(m, 'cat', 'Categoria', rif.categorie.map((x) => ({ v: x.id, l: x.nome })))}
          ${scelta(m, 'unita', 'Unità base', [{ v: 'pz', l: 'pezzi' }, { v: 'kg', l: 'kg' }, { v: 'l', l: 'litri' }])}</div>
          <p class="hint" style="margin-bottom:var(--space-4)">${c?.magazzino_default ? `Va nel magazzino ${c.magazzino_default === 'materiali' ? 'Materiali di consumo' : 'Materie apistiche'}.` : 'Solo spesa: non va in magazzino.'}</p>`}
      <div class="row-fields">${campo(m, 'scorta', 'Scorta minima (facoltativa)', { numero: true, unita: a?.unita ?? m.v.unita })}${campo(m, 'codice', 'Codice (facoltativo)', { placeholder: 'VAS-500G' })}</div>
      ${a?.confezioni.length ? html`<p class="label">Confezioni</p>${a.confezioni.map((x) => html`<div class="row"><span>${x.nome} da ${num(Number(x.quantita), 2)} ${a.unita}</span>
        <button class="linkbtn" @click=${async () => { try { await api.eliminaConfezione(x.id); a.confezioni = a.confezioni.filter((y) => y.id !== x.id); invalida('articoli'); f.ridisegna(); } catch (e) { toast(messaggioErrore(e), true); } }}>Togli</button></div>`)}` : nothing}
      <div class="row-fields">${campo(m, 'confNome', 'Nuova confezione (facoltativa)', { placeholder: 'sacco' })}${campo(m, 'confQta', 'Contiene', { numero: true, unita: a?.unita ?? m.v.unita, placeholder: '25' })}</div>
      <div class="btns">${a ? html`<button class="btn danger" @click=${() => rimuovi('articoli', a.id, a.nome, f.chiudi)}>Togli</button>` : nothing}
        <button class="btn quiet" @click=${() => f.chiudi()}>Annulla</button>
        ${bottoneInvio(m, 'Salva', async () => {
          m.err = {};
          if (!m.v.nome.trim()) m.errore('nome', 'Scrivi il nome');
          const sc = m.v.scorta.trim() ? parseNum(m.v.scorta) : null, cq = parseNum(m.v.confQta);
          if (m.v.scorta.trim() && (sc == null || sc < 0)) m.errore('scorta', 'Scrivi un numero');
          if (m.v.confNome.trim() && (!cq || cq <= 0)) m.errore('confQta', 'Quanto contiene la confezione?');
          const cc = rif.categorie.find((x) => String(x.id) === m.v.cat);
          if (await m.invia(async () => {
            const v: Record<string, unknown> = { nome: m.v.nome.trim(), scorta_minima: sc, codice: m.v.codice.trim().toUpperCase() || null };
            if (!usato) Object.assign(v, { categoria_id: Number(m.v.cat), unita: m.v.unita, magazzino: cc?.magazzino_default ?? null });
            const r = await api.salva('articoli', v, a?.id) as { id: number } | null;
            const id = a?.id ?? r!.id;
            if (m.v.confNome.trim()) await api.salvaConfezione(id, m.v.confNome.trim(), cq!);
          })) { f.chiudi(); invalida('articoli'); toast(a ? 'Articolo aggiornato' : 'Articolo aggiunto'); ricarica(); }
        }, 'primary')}</div>`;
    });
  }

  function modDistinta(v: T.Variante, nome: string) {
    const righe = v.distinta.map((d) => ({ a: String(d.articolo_id), q: num(Number(d.quantita), 3) }));
    const comp = rif.articoli.filter((a) => !a.archiviato && a.magazzino === 'materiali');
    let err = '', busy = false;
    const f = finestra(() => html`<h2>Distinta: ${nome}</h2>
      <p class="sub" style="margin-bottom:var(--space-4)">Cosa serve per confezionarne uno. Vale per i prossimi confezionamenti.</p>
      ${righe.map((r, i) => html`<div class="line-item" style="margin-bottom:var(--space-3)">
        <div class="field"><label for=${`ds${i}`}>Componente</label><select class="select" id=${`ds${i}`} @change=${(e: Event) => { r.a = (e.target as HTMLSelectElement).value; }}>
          ${comp.map((a) => html`<option value=${a.id} ?selected=${String(a.id) === r.a}>${a.nome}</option>`)}</select></div>
        <div class="field"><label for=${`dq${i}`}>Quantità</label><input class="input numero" id=${`dq${i}`} inputmode="decimal" .value=${live(r.q)} @input=${(e: Event) => { r.q = (e.target as HTMLInputElement).value; }}></div>
        <button class="iconbtn" aria-label="Togli componente" @click=${() => { righe.splice(i, 1); f.ridisegna(); }}>${icon('x')}</button></div>`)}
      ${righe.length ? nothing : html`<p class="sub">Nessun componente: il costo del prodotto non sarà calcolabile.</p>`}
      <button class="btn" @click=${() => { righe.push({ a: String(comp[0]?.id ?? ''), q: '1' }); f.ridisegna(); }}>${icon('piu')} Aggiungi componente</button>
      ${err ? html`<div class="note danger mt">${err}</div>` : nothing}
      <div class="btns"><button class="btn quiet" @click=${() => f.chiudi()}>Annulla</button>
        <button class="btn primary" ?disabled=${busy} @click=${async () => {
          const rr = righe.map((r) => ({ articolo_id: Number(r.a), quantita: parseNum(r.q) ?? 0 }));
          if (rr.some((r) => !r.articolo_id || r.quantita <= 0)) { err = 'Ogni componente ha bisogno di una quantità maggiore di zero.'; f.ridisegna(); return; }
          if (new Set(rr.map((r) => r.articolo_id)).size !== rr.length) { err = 'Lo stesso componente compare due volte.'; f.ridisegna(); return; }
          busy = true; f.ridisegna();
          try { await api.salvaDistinta(v.id, rr); f.chiudi(); invalida('prodotti'); toast(`Distinta di ${nome} salvata`); ricarica(); }
          catch (e) { err = messaggioErrore(e); busy = false; f.ridisegna(); }
        }}>Salva distinta</button></div>`);
  }

  function nuovoProdotto() {
    const m = new Modulo({ cosa: 'formato', tipo: String(rif.tipi.find((t) => !t.archiviato)?.id ?? ''), grammi: '250', nomeMiele: '', sigla: '', nome: '', categoria: String(catProd.find((c) => c.nome !== 'Miele')?.id ?? '') });
    const f = finestra(() => html`<h2>Nuovo prodotto</h2>${erroreModulo(m)}
      ${scelta(m, 'cosa', 'Che cos\'è', [{ v: 'formato', l: 'Un nuovo formato di un miele' }, { v: 'tipo', l: 'Un nuovo tipo di miele' }, { v: 'altro', l: 'Un altro prodotto (candele, propoli, kit…)' }])}
      ${m.v.cosa === 'formato' ? html`<div class="row-fields">${scelta(m, 'tipo', 'Tipo di miele', rif.tipi.filter((t) => !t.archiviato).map((t) => ({ v: t.id, l: t.nome })))}
          ${campo(m, 'grammi', 'Formato', { numero: true, inputmode: 'numeric', unita: 'g' })}</div>
          <p class="hint" style="margin-bottom:var(--space-4)">Propongo la distinta con vasetto, tappo, etichetta e sigillo dello stesso formato, se esistono tra gli articoli (codici VAS-, TAP-, ETI-, SIG-).</p>`
        : m.v.cosa === 'tipo' ? html`<div class="row-fields">${campo(m, 'nomeMiele', 'Nome del miele', { placeholder: 'Tiglio' })}${campo(m, 'sigla', 'Sigla, 3 lettere', { placeholder: 'TIG' })}</div>
          <p class="hint" style="margin-bottom:var(--space-4)">La sigla entra nei codici dei lotti (TIG-2027-01) e dei prodotti. Creo un vasetto per ogni formato già in uso, con la distinta proposta.</p>`
        : html`<div class="row-fields">${campo(m, 'nome', 'Nome', { placeholder: 'Candela a rotolo' })}${scelta(m, 'categoria', 'Categoria', catProd.filter((c) => c.nome !== 'Miele').map((c) => ({ v: c.id, l: c.nome })))}</div>`}
      <div class="btns"><button class="btn quiet" @click=${() => f.chiudi()}>Annulla</button>
        ${bottoneInvio(m, 'Crea', async () => {
          m.err = {};
          if (m.v.cosa === 'formato') {
            const g = Number(m.v.grammi), t = rif.tipi.find((x) => String(x.id) === m.v.tipo);
            if (!(g > 0 && Number.isInteger(g))) m.errore('grammi', 'Scrivi i grammi, per esempio 250');
            const fmt = g >= 1000 ? `${num(g / 1000, 2)}kg` : `${g}g`;
            const p = rif.prodotti.find((x) => x.tipo_miele_id === t?.id);
            if (p?.varianti.some((v) => v.formato === fmt)) m.errore('grammi', `${t?.nome} ${fmt} esiste già`);
            if (await m.invia(async () => {
              const r = await api.salvaVariante({ prodotto_id: p!.id, formato: fmt, peso_kg: g / 1000, codice_articolo: `MIE-${t!.sigla}-${g >= 1000 ? fmt.toUpperCase() : g}` }) as { id: number };
              await api.proponiDistinta(r.id);
            })) { f.chiudi(); invalida('prodotti'); invalidaCatalogo(); toast(`Creato ${t?.nome} ${fmt}: controlla la distinta proposta`); ricarica(); }
          } else if (m.v.cosa === 'tipo') {
            const sg = m.v.sigla.trim().toUpperCase();
            if (!m.v.nomeMiele.trim()) m.errore('nomeMiele', 'Scrivi il nome');
            if (!/^[A-Z]{3}$/.test(sg)) m.errore('sigla', 'Tre lettere, per esempio TIG');
            if (await m.invia(() => api.nuovoTipoMiele(capitalizza(m.v.nomeMiele), sg))) { f.chiudi(); invalida('prodotti', 'tipi'); invalidaCatalogo(); toast('Nuovo miele creato'); ricarica(); }
          } else {
            if (!m.v.nome.trim()) m.errore('nome', 'Scrivi il nome');
            const nome = m.v.nome.trim();
            if (await m.invia(async () => {
              const p = await api.salvaProdotto({ nome, categoria_id: Number(m.v.categoria) });
              await api.salvaVariante({ prodotto_id: p.id, formato: null, peso_kg: null, codice_articolo: `${nome.normalize('NFD').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase()}-${String(p.id).padStart(2, '0')}` });
            })) { f.chiudi(); invalida('prodotti'); invalidaCatalogo(); toast(`Creato ${nome}`); ricarica(); }
          }
        }, 'primary')}</div>`);
  }

  return {
    titolo: 'Anagrafica articoli', tab: 'articoli',
    async carica() {
      invalida('articoli', 'prodotti', 'tipi');
      [spese, catProd, cat] = await Promise.all([api.spese('2000-01-01'), api.categorieProdotto(), catalogo(true), carica('articoli', 'categorie', 'prodotti', 'tipi')]) as [T.Spesa[], { id: number; nome: string }[], T.Disponibilita[], void];
    },
    vista() {
      let corpo: TemplateResult;
      if (vista === 'articoli') {
        corpo = html`<p class="sub" style="margin-bottom:var(--space-4)">Tutto ciò che compri, per categoria. I singoli beni che possiedi (con anno e prezzo) sono in <a class="link-text" href="/attrezzatura">Attrezzatura</a>.</p>
          <div class="btns" style="margin:0 0 var(--space-4)"><button class="btn" @click=${() => modArticolo()}>${icon('piu')} Nuovo articolo</button></div>
          ${rif.categorie.map((c) => {
            const as = rif.articoli.filter((a) => a.categoria_id === c.id && !a.archiviato);
            if (!as.length) return nothing;
            return html`<section style="margin-bottom:var(--space-6)"><h2 style="margin-bottom:var(--space-3)">${c.nome}</h2>${lista(as.map((a) => {
              const pts = spese.filter((s) => s.articolo_id === a.id), ult = pts[pts.length - 1], prima = pts[pts.length - 2];
              const ch = ult && prima ? ((Number(ult.prezzo_unitario) - Number(prima.prezzo_unitario)) / Number(prima.prezzo_unitario)) * 100 : null;
              return riga({ onClick: () => modArticolo(a), t: a.nome,
                m: html`${a.magazzino ? (a.magazzino === 'materiali' ? 'Materiali di consumo' : 'Materie apistiche') : 'Solo spesa'}${a.confezioni.length ? `, ${a.confezioni.map((x) => `${x.nome} da ${num(Number(x.quantita), 2)} ${a.unita}`).join(', ')}` : ''}${ch != null && Math.abs(ch) >= 0.5 ? html`, <span class=${ch > 0 ? 'danger-text' : ''}>${ch > 0 ? '+' : ''}${num(ch, 0)}% dall'acquisto prima</span>` : ''}`,
                v: ult ? html`${eurCost(Number(ult.prezzo_unitario))}<small>al ${a.unita}</small>` : html`<small>nessun acquisto</small>` });
            }))}</section>`;
          })}
          ${archiviati(rif.articoli.filter((a) => a.archiviato), 'articoli')}`;
      } else {
        const tutti = rif.prodotti.flatMap((p) => p.varianti.map((v) => ({ p, v })));
        const gruppi = [...rif.tipi.map((t) => [t.nome, tutti.filter((x) => x.p.tipo_miele_id === t.id)] as const), ['Altri prodotti', tutti.filter((x) => !x.p.tipo_miele_id)] as const];
        const nomeV = (x: { p: T.Prodotto; v: T.Variante }) => x.v.formato ? `${x.p.tipo?.nome ?? x.p.nome} ${x.v.formato}` : x.p.nome;
        corpo = html`<p class="sub" style="margin-bottom:var(--space-4)">Ogni prodotto ha la sua distinta base: cosa serve per confezionarne uno. Il confezionamento in Produzione scala proprio questi componenti.</p>
          <div class="btns" style="margin:0 0 var(--space-4)"><button class="btn" @click=${nuovoProdotto}>${icon('piu')} Nuovo prodotto</button></div>
          ${gruppi.map(([g, vv]) => {
            const att = vv.filter((x) => x.v.attivo).sort((a, b) => grammi(a.v.formato) - grammi(b.v.formato));
            if (!att.length) return nothing;
            return html`<section style="margin-bottom:var(--space-6)"><h2 style="margin-bottom:var(--space-3)">${g}</h2>${lista(att.map((x) => {
              const d = cat.find((c) => c.variante_id === x.v.id);
              return riga({ t: nomeV(x),
                m: `${x.v.codice_articolo} · ${x.v.distinta.length ? x.v.distinta.map((r) => `${rif.articoli.find((a) => a.id === r.articolo_id)?.nome ?? '?'}${Number(r.quantita) !== 1 ? ` × ${num(Number(r.quantita), 2)}` : ''}`).join(', ') : 'senza distinta base'}`,
                v: eur(d?.prezzo_corrente ?? null),
                extra: html`<div class="btns" style="margin:0;flex-wrap:nowrap">${x.v.formato ? html`<button class="btn sm quiet" @click=${() => modDistinta(x.v, nomeV(x))}>Distinta</button>` : nothing}
                  ${d ? html`<button class="btn sm quiet" @click=${() => apriPrezzo(d)}>Prezzo</button>` : nothing}
                  <button class="iconbtn" aria-label=${`Togli ${nomeV(x)}`} @click=${() => rimuovi('varianti_prodotto', x.v.id, nomeV(x), () => {}, 'attivo')}>${icon('cestino')}</button></div>` });
            }))}</section>`;
          })}
          ${archiviati(tutti.filter((x) => !x.v.attivo).map((x) => ({ id: x.v.id, nome: nomeV(x) })), 'varianti_prodotto', 'attivo')}`;
      }
      return html`${testa('Anagrafica articoli')}
        ${segmenti<VistaR>([['articoli', 'Articoli'], ['prodotti', 'Prodotti in vendita']], vista,
          (k) => { vista = k; history.replaceState(history.state, '', `/articoli?vista=${k}`); aggiorna(); }, 'Anagrafica')}
        ${corpo}`;
    },
  };
}
