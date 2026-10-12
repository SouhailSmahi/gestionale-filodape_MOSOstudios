/** Nuovo ordine: usato dagli aiutanti e da Filippo. */
import { html, nothing } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import type { Pagina } from '../app';
import { aggiorna, stato, vai } from '../app';
import * as api from '../lib/api';
import { catalogo, nomeBreve } from '../lib/catalogo';
import { leggiBozza, salvaBozza, cancellaBozza } from '../lib/bozze';
import { eur, capitalizza } from '../lib/format';
import { AppError } from '../lib/errors';
import { icon } from '../ui/icons';
import { testa, toast, erroreModulo, Modulo } from '../ui/kit';
import type { ClienteBreve, Disponibilita } from '../lib/types';

interface Bozza { cliente: string; telefono: string; note: string; righe: { v: number; q: string }[] }

export function nuovoOrdine(): Pagina {
  const admin = stato.me?.ruolo === 'admin';
  let clienti: ClienteBreve[] = [];
  let cat: Disponibilita[] = [];
  const b: Bozza = leggiBozza<Bozza>('ordine') ?? { cliente: '', telefono: '', note: '', righe: [] };
  const m = new Modulo({ cliente: '', righe: '' });   // usato solo per errori e attesa
  const errRiga: Record<number, string> = {};
  let conNote = !!b.note || !!b.telefono;

  const salva = () => salvaBozza('ordine', b);
  const disp = (id: number) => cat.find((c) => c.variante_id === id);
  const clienteNoto = () => {
    const t = b.cliente.trim().toLowerCase().replace(/\s+/g, ' ');
    return clienti.find((c) => `${c.nome} ${c.cognome}`.trim().toLowerCase() === t);
  };

  async function registra() {
    m.err = {};
    Object.keys(errRiga).forEach((k) => delete errRiga[+k]);
    const parti = b.cliente.trim().split(/\s+/).filter(Boolean);
    if (parti.length < 2) m.errore('cliente', 'Scrivi nome e cognome del cliente');
    b.righe.forEach((r, i) => { const n = Number(r.q); if (!Number.isInteger(n) || n < 1) errRiga[i] = 'Scrivi quanti pezzi (almeno 1)'; });
    if (Object.keys(errRiga).length) m.errore('righe', 'x');
    // righe uguali sommate
    const somma = new Map<number, number>();
    b.righe.forEach((r) => somma.set(r.v, (somma.get(r.v) ?? 0) + Number(r.q)));
    const noto = clienteNoto();
    let id = 0;
    const ok = await m.invia(async () => {
      if (!somma.size) throw new AppError('Aggiungi almeno un prodotto.');
      id = await api.creaComanda(noto?.id ?? null,
        noto ? null : { nome: capitalizza(parti[0]), cognome: capitalizza(parti.slice(1).join(' ')), telefono: b.telefono.trim() || undefined },
        [...somma].map(([variante_id, quantita]) => ({ variante_id, quantita })), b.note.trim());
    });
    if (!ok) return;
    cancellaBozza('ordine');
    toast(admin ? 'Ordine registrato' : 'Ordine registrato: Filippo lo conferma e ti indica quando si consegna');
    vai(admin ? `/ordini/${id}` : '/miei', { replace: true });
  }

  const totale = () => b.righe.reduce((a, r) => {
    const p = disp(r.v)?.prezzo_corrente; const q = Number(r.q) || 0;
    if (p == null) a.x = true; else a.e += p * q; return a;
  }, { e: 0, x: false });

  return {
    titolo: 'Nuovo ordine',
    tab: admin ? 'ordini' : 'nuovo',
    genitore: admin ? { path: '/ordini', titolo: 'Ordini' } : undefined,
    async carica() {
      [clienti, cat] = await Promise.all([api.clientiStaff(), catalogo(true)]);
      if (!b.righe.length && cat.length) b.righe.push({ v: (cat.find((c) => c.codice_articolo === 'MIE-ACA-500') ?? cat[0]).variante_id, q: '1' });
    },
    vista() {
      const t = totale();
      const errCl = m.err.cliente;
      const opz = (sel: number) => cat.map((c) => html`<option value=${c.variante_id} ?selected=${c.variante_id === sel}>${nomeBreve(c.prodotto, c.formato)}</option>`);
      return html`
      ${testa('Nuovo ordine', { sub: admin ? 'L\'ordine inserito da te è già tra quelli da confermare: dagli la data quando sei pronto.' : 'Segna chi vuole cosa. Filippo lo conferma e ti indica quando si consegna.' })}
      <div class="cols cols-main">
        <div class="form">
          ${erroreModulo(m)}
          <div class="field ${errCl ? 'err' : ''}">
            <label for="o-cl">Cliente</label>
            <input class="input" id="o-cl" list="o-cl-l" autocomplete="off" placeholder="Anna Bianchi" .value=${live(b.cliente)}
              aria-invalid=${errCl ? 'true' : 'false'}
              @input=${(e: Event) => { b.cliente = (e.target as HTMLInputElement).value; delete m.err.cliente; salva(); aggiorna(); }}>
            <datalist id="o-cl-l">${clienti.map((c) => html`<option value=${`${c.nome} ${c.cognome}`.trim()}></option>`)}</datalist>
            ${errCl ? html`<div class="errmsg" role="alert">${icon('allerta')}<span>${errCl}</span></div>`
              : b.cliente.trim().split(/\s+/).length >= 2 ? html`<div class="hint">${clienteNoto() ? 'Cliente già presente.' : 'Nuovo cliente: verrà aggiunto all\'elenco.'}</div>` : nothing}
          </div>

          ${b.righe.map((r, i) => {
            const d = disp(r.v); const q = Number(r.q) || 0; const e = errRiga[i];
            return html`<div class="formbox">
              <div class="line-item">
                <div class="field"><label for=${`o-p${i}`}>Prodotto</label>
                  <select class="select" id=${`o-p${i}`} @change=${(ev: Event) => { r.v = +(ev.target as HTMLSelectElement).value; salva(); aggiorna(); }}>${opz(r.v)}</select></div>
                <div class="field ${e ? 'err' : ''}"><label for=${`o-q${i}`}>Pezzi</label>
                  <input class="input numero" id=${`o-q${i}`} type="number" inputmode="numeric" min="1" step="1" .value=${live(r.q)}
                    @input=${(ev: Event) => { r.q = (ev.target as HTMLInputElement).value; delete errRiga[i]; salva(); aggiorna(); }}></div>
                <button class="iconbtn" type="button" aria-label="Togli questo prodotto" ?disabled=${b.righe.length === 1}
                  @click=${() => { b.righe.splice(i, 1); salva(); aggiorna(); }}>${icon('x')}</button>
              </div>
              ${e ? html`<div class="errmsg" role="alert" style="margin-top:8px">${icon('allerta')}<span>${e}</span></div>`
                : d ? html`<div class="hint ${q > d.disponibile ? 'warn' : ''}" style="margin-top:8px">${q > d.disponibile
                  ? `Disponibili ${d.disponibile} pz: l'ordine resta valido, Filippo lo confermerà quando c'è la merce.`
                  : `Disponibili ${d.disponibile} pz, ${eur(d.prezzo_corrente)} cad.`}</div>` : nothing}
            </div>`;
          })}
          <button class="btn" type="button" @click=${() => { b.righe.push({ v: cat[0]?.variante_id ?? 0, q: '1' }); salva(); aggiorna(); }}>
            ${icon('piu')} Aggiungi un altro prodotto</button>

          ${conNote ? html`<div class="mt2">
              <div class="field"><label for="o-tel">Telefono del cliente (facoltativo)</label>
                <input class="input" id="o-tel" type="tel" inputmode="tel" .value=${live(b.telefono)} @input=${(e: Event) => { b.telefono = (e.target as HTMLInputElement).value; salva(); }}></div>
              <div class="field"><label for="o-note">Note (facoltative)</label>
                <textarea class="input" id="o-note" placeholder="Es. passa a ritirare sabato" .value=${live(b.note)} @input=${(e: Event) => { b.note = (e.target as HTMLTextAreaElement).value; salva(); }}></textarea></div>
            </div>`
            : html`<div><button class="linkbtn mt" type="button" @click=${() => { conNote = true; aggiorna(); }}>+ Aggiungi telefono o una nota</button></div>`}
        </div>

        <div>
          <div class="kpis compact" style="grid-template-columns:1fr"><div class="kpi"><div class="l">Totale indicativo</div>
            <div class="n">${eur(t.e)}${t.x ? html` <span class="small">+ prezzi da decidere</span>` : nothing}</div></div></div>
          <div class="mt"><button class="btn primary full" type="button" ?disabled=${m.busy} @click=${registra}>${m.busy ? 'Salvataggio…' : 'Registra ordine'}</button></div>
        </div>
      </div>`;
    },
  };
}
