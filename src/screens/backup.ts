/** Impostazioni → Backup: copie settimanali in Excel, copia immediata e notifiche sul telefono. */
import { html, nothing, type TemplateResult } from 'lit-html';
import { aggiorna, ricarica } from '../app';
import * as api from '../lib/api';
import { creaExcelBackup, nomeFileBackup } from '../lib/backup';
import { messaggioErrore } from '../lib/errors';
import { fdt } from '../lib/format';
import { statoPush, attivaPush, disattivaPush, type StatoPush } from '../lib/push';
import { badge, toast } from '../ui/kit';

type Backup = Awaited<ReturnType<typeof api.elencoBackup>>[number];
export interface StatoBackup { elenco: Backup[]; push: StatoPush; busy: string }
export const statoBackup = (): StatoBackup => ({ elenco: [], push: 'spente', busy: '' });

export async function caricaBackup(s: StatoBackup) {
  [s.elenco, s.push] = await Promise.all([api.elencoBackup(), statoPush()]);
}

const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;

function salvaFile(dati: Uint8Array, nome: string) {
  const blob = new Blob([dati as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: nome });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function lavora(s: StatoBackup, chiave: string, fn: () => Promise<void>) {
  if (s.busy) return;
  s.busy = chiave; aggiorna();
  try { await fn(); } catch (e) { toast(messaggioErrore(e), true); } finally { s.busy = ''; aggiorna(); }
}

const TESTO_PUSH: Record<StatoPush, string> = {
  attive: 'Attive su questo dispositivo: ogni lunedì ti arriva l\'avviso del backup.',
  spente: 'Spente su questo dispositivo.',
  bloccate: 'Bloccate: le hai negate. Riattivale dalle impostazioni del telefono (Notifiche → Filodape) e torna qui.',
  da_installare: 'Su iPhone e iPad arrivano solo con l\'app aggiunta alla schermata Home: apri Filodape dall\'icona e torna qui.',
  non_supportate: 'Questo browser non riceve notifiche: l\'avviso lo trovi comunque nella campanella.',
  non_pronte: 'Si possono attivare dopo il primo backup automatico (lunedì mattina).',
};

export function sezioneBackup(s: StatoBackup): TemplateResult {
  const ultimo = s.elenco[0];
  return html`<section class="section" id="backup">
    <h2>Backup</h2>
    <p class="sub" style="margin-bottom:var(--space-4)">Ogni lunedì mattina il gestionale prepara una copia completa in Excel e ti avvisa.
      Scaricala e tienila sul telefono o sul computer: se dovesse succedere qualcosa, da quel file si ripristina tutto.</p>
    <div class="cols">
      <div class="card">
        <h3>Copie settimanali</h3>
        ${s.elenco.length ? html`<div class="list mt">${s.elenco.map((b) => html`<div class="item">
            <div class="body"><div class="t">${fdt(b.creato_il)}</div>
              <div class="m">${kb(b.dimensione)} · ${b.scaricato_il ? badge('scaricato', 'ok', 'spunta') : badge('da scaricare', 'soft', 'orologio')}</div></div>
            <button class="btn sm" ?disabled=${!!s.busy} @click=${() => lavora(s, `b${b.id}`, async () => {
              const b64 = await api.scaricaBackup(b.id);
              salvaFile(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), b.nome_file);
              toast('Backup scaricato'); await ricarica();
            })}>${s.busy === `b${b.id}` ? 'Attendi…' : 'Scarica'}</button></div>`)}</div>
          <p class="small mt">Si tengono le ultime ${8} copie: le più vecchie si cancellano da sole.</p>`
        : html`<p class="small mt">Ancora nessuna copia: la prima arriva lunedì mattina. Intanto puoi scaricarne una adesso.</p>`}
        <div class="btns">
          <button class="btn ${ultimo && !ultimo.scaricato_il ? '' : 'primary'}" ?disabled=${!!s.busy} @click=${() => lavora(s, 'ora', async () => {
            const d = await api.esportaDati();
            salvaFile(creaExcelBackup(d), nomeFileBackup(d.creato_il));
            toast('Copia completa scaricata');
          })}>${s.busy === 'ora' ? 'Preparo il file…' : 'Scarica una copia adesso'}</button>
        </div>
      </div>
      <div class="card">
        <h3>Avviso sul telefono</h3>
        <p class="mt">${TESTO_PUSH[s.push]}</p>
        ${s.push === 'spente' || s.push === 'attive' ? html`<div class="btns">
          ${s.push === 'spente'
            ? html`<button class="btn primary" ?disabled=${!!s.busy} @click=${() => lavora(s, 'push', async () => {
                s.push = await attivaPush();
                toast(s.push === 'attive' ? 'Notifiche attivate su questo dispositivo' : TESTO_PUSH[s.push], s.push !== 'attive');
              })}>${s.busy === 'push' ? 'Attivo…' : 'Attiva le notifiche'}</button>`
            : html`<button class="btn quiet" ?disabled=${!!s.busy} @click=${() => lavora(s, 'push', async () => { s.push = await disattivaPush(); toast('Notifiche spente su questo dispositivo'); })}>Spegni su questo dispositivo</button>`}
        </div>` : nothing}
        <p class="small mt">Vale per il dispositivo che stai usando: per riceverle anche sul tablet o sul computer, attivale anche lì.</p>
      </div>
    </div>
  </section>`;
}
