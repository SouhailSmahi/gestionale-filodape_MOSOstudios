/**
 * Backup settimanale in Excel (lo lancia GitHub Actions ogni lunedì mattina).
 * 1. Esporta tutti i dati e crea il file Excel (stesso codice dell'app).
 * 2. Lo salva nel gestionale: Filippo lo trova in Impostazioni → Backup (si tengono gli ultimi 8).
 * 3. Avvisa Filippo: notifica nell'app e, se l'ha attivata, sul telefono.
 *
 * Variabili: SUPABASE_DB_URL (connessione al database), APP_URL (indirizzo dell'app, per le notifiche).
 * Uso: npx tsx strumenti/backup-settimanale.ts
 */
import pg from 'pg';
import webpush from 'web-push';
import { creaExcelBackup, nomeFileBackup, type DatiEsportati } from '../src/lib/backup';

const DA_TENERE = 8;
const dbUrl = process.env.SUPABASE_DB_URL;
const appUrl = (process.env.APP_URL || 'https://gestionale-filodape-mosostudios.pages.dev').replace(/\/$/, '');
if (!dbUrl) { console.error('Manca SUPABASE_DB_URL'); process.exit(1); }

const db = new pg.Client({ connectionString: dbUrl, ssl: dbUrl.includes('localhost') ? undefined : { rejectUnauthorized: false } });
await db.connect();

// 1-2. Excel salvato nel gestionale e notifica in app, in un'unica transazione
const { rows: [r] } = await db.query<{ d: DatiEsportati }>('select _dati_esportazione() as d');
const file = creaExcelBackup(r.d);
const nome = nomeFileBackup(r.d.creato_il);
await db.query('begin');
const { rows: [b] } = await db.query<{ id: number }>(
  'insert into backup_excel (nome_file, dimensione, file) values ($1, $2, $3) returning id', [nome, file.length, Buffer.from(file)]);
await db.query(`delete from backup_excel where id not in (select id from backup_excel order by creato_il desc, id desc limit ${DA_TENERE})`);
await db.query(`insert into notifiche (categoria, titolo, messaggio, tabella_rif, record_rif)
                values ('backup', 'Backup settimanale pronto', 'Scaricalo da Impostazioni → Backup e conservalo sul telefono o sul computer.', 'backup_excel', $1)`, [String(b.id)]);
await db.query('commit');
console.log(`Backup salvato: ${nome}, ${Math.round(file.length / 1024)} KB, ${r.d.tabelle.length} tabelle`);

// 3. Notifica sul telefono (se non riesce, il backup resta comunque salvato)
try {
  let { rows: [k] } = await db.query<{ pubblica: string; privata: string }>('select pubblica, privata from push_chiavi');
  if (!k) {
    const nuove = webpush.generateVAPIDKeys();
    await db.query('insert into push_chiavi (pubblica, privata) values ($1, $2) on conflict do nothing', [nuove.publicKey, nuove.privateKey]);
    ({ rows: [k] } = await db.query('select pubblica, privata from push_chiavi'));
    console.log('Chiavi per le notifiche create');
  }
  webpush.setVapidDetails(appUrl, k.pubblica, k.privata);
  const { rows: iscr } = await db.query<{ id: number; endpoint: string; p256dh: string; auth: string }>(
    `select i.id, i.endpoint, i.p256dh, i.auth from push_iscrizioni i join profili p on p.id = i.utente_id
      where p.ruolo = 'admin' and p.attivo`);
  const messaggio = JSON.stringify({ titolo: 'Backup settimanale pronto', testo: 'Tocca per scaricarlo e conservarlo.', url: '/impostazioni#backup' });
  let inviate = 0;
  for (const s of iscr) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, messaggio, { TTL: 3 * 24 * 3600 });
      inviate++;
    } catch (e) {
      const codice = (e as { statusCode?: number }).statusCode;
      if (codice === 404 || codice === 410) await db.query('delete from push_iscrizioni where id = $1', [s.id]);   // dispositivo non più valido
      console.warn(`Notifica non inviata (${codice ?? 'errore'})`);
    }
  }
  console.log(`Notifiche sul telefono: ${inviate} su ${iscr.length}`);
} catch (e) {
  console.warn('Notifiche sul telefono non inviate:', (e as Error).message);
}
await db.end();
