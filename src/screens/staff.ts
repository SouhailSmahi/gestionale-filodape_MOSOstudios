/** Schermate degli aiutanti: i propri ordini e la disponibilità. */
import { html, nothing } from 'lit-html';
import type { Pagina } from '../app';
import { ricarica } from '../app';
import * as api from '../lib/api';
import { catalogo, nomeBreve, nomeVariante, gruppo } from '../lib/catalogo';
import { eur, fd, fdl } from '../lib/format';
import { messaggioErrore } from '../lib/errors';
import { testa, badgeStato, chiedi, toast, riga, lista } from '../ui/kit';
import type { Disponibilita, MiaComanda } from '../lib/types';

const APERTI = ['in_attesa_conferma', 'confermata', 'in_produzione', 'parzialmente_evasa'];

/** Ordini dello stesso cliente in una scheda sola: prima i clienti con ordini aperti, poi i più recenti. */
function raggruppa(ordini: MiaComanda[]): MiaComanda[][] {
  const m = new Map<number, MiaComanda[]>();
  [...ordini].sort((a, b) => b.creata_il.localeCompare(a.creata_il)).forEach((o) => m.set(o.cliente_id, [...(m.get(o.cliente_id) ?? []), o]));
  const aperto = (g: MiaComanda[]) => g.some((o) => APERTI.includes(o.stato));
  return [...m.values()].sort((a, b) => Number(aperto(b)) - Number(aperto(a)) || b[0].creata_il.localeCompare(a[0].creata_il));
}

export function mieiOrdini(): Pagina {
  let ordini: MiaComanda[] = [];
  let righe: Awaited<ReturnType<typeof api.righeComande>> = [];
  return {
    titolo: 'I miei ordini', tab: 'miei',
    async carica() {
      await catalogo();
      const tutti = await api.mieComande();
      const limite = Date.now() - 60 * 864e5;
      ordini = tutti.filter((o) => APERTI.includes(o.stato) || new Date(o.creata_il).getTime() > limite);
      righe = await api.righeComande(ordini.map((o) => o.id));
    },
    vista() {
      return html`${testa('I miei ordini', { sub: 'Lo stato si aggiorna quando Filippo conferma o consegna. Qui vedi gli ordini aperti e quelli degli ultimi due mesi.' })}
      ${ordini.length ? html`<div class="cols">${raggruppa(ordini).map((g) => html`<div class="card">
        <div class="card-head"><h3>${g[0].cliente}</h3>${g.length > 1 ? html`<span class="pill">${g.length} ordini</span>` : badgeStato(g[0].stato)}</div>
        ${g.map((o, i) => {
          const rr = righe.filter((r) => r.comanda_id === o.id);
          return html`<div class=${i ? 'mt2' : ''} style=${i ? 'border-top:var(--border-w) solid var(--color-border);padding-top:var(--space-3)' : ''}>
          ${g.length > 1 ? html`<div style="margin-bottom:var(--space-2)">${badgeStato(o.stato)}</div>` : nothing}
          <div>${rr.map((r) => `${nomeVariante(r.variante_id)} × ${r.quantita_ordinata}`).join(', ')}</div>
          ${o.data_consegna_indicativa && !['annullata', 'evasa'].includes(o.stato)
            ? html`<div class="mt">Consegna indicativa: <b>${fdl(o.data_consegna_indicativa)}</b></div>` : nothing}
          ${o.note ? html`<div class="small mt">Nota: ${o.note}</div>` : nothing}
          <div class="row mt wrap"><span class="small">Inserito il ${fd(o.creata_il)}</span>
            ${o.stato === 'in_attesa_conferma' ? html`<button class="btn quiet sm" @click=${async () => {
              if (!(await chiedi('Annullare l\'ordine?', `L'ordine di ${o.cliente} non sarà più da confermare. Filippo riceve un avviso.`, 'Annulla ordine', true, 'Indietro'))) return;
              try { await api.annullaComanda(o.id); toast('Ordine annullato'); ricarica(); } catch (e) { toast(messaggioErrore(e), true); }
            }}>Annulla ordine</button>` : nothing}</div></div>`;
        })}
      </div>`)}</div>`
      : html`<div class="empty">Non hai ancora inserito ordini.<div><a class="btn primary" href="/nuovo">Inserisci il primo</a></div></div>`}`;
    },
  };
}

export function disponibilita(): Pagina {
  let cat: Disponibilita[] = [];
  return {
    titolo: 'Disponibilità', tab: 'disponibilita',
    async carica() { cat = await catalogo(true); },
    vista() {
      const gruppi = new Map<string, Disponibilita[]>();
      cat.forEach((c) => { const k = gruppo(c.prodotto); gruppi.set(k, [...(gruppi.get(k) ?? []), c]); });
      return html`${testa('Disponibilità', { sub: 'Vasetti e prodotti pronti da vendere adesso.' })}
      <div class="cols">${[...gruppi].map(([g, vv]) => html`<section><h2 style="margin-bottom:var(--space-3)">${g}</h2>
        ${lista(vv.map((v) => riga({
          t: nomeBreve(v.prodotto, v.formato),
          m: `${eur(v.prezzo_corrente)}${v.prelevata_mercato ? `, ${v.prelevata_mercato} pz al mercato` : ''}`,
          v: html`<span class=${v.disponibile ? '' : 'danger-text'}>${v.disponibile} pz</span>${v.disponibile ? nothing : html`<small>esaurito</small>`}`,
        })))}</section>`)}</div>`;
    },
  };
}
