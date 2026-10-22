/**
 * Ripristino del gestionale da un backup Excel (filodape-backup-AAAA-MM-GG.xlsx).
 * Da usare solo se il backup notturno del database non è disponibile.
 *
 * Prima: un database con tutte le migrazioni di supabase/migrations già eseguite (vedi docs/RILASCIO.md).
 * Uso:
 *   SUPABASE_DB_URL=... npx tsx strumenti/ripristina-da-excel.ts backup.xlsx [--utenti mappa.json] [--sovrascrivi]
 *
 * --utenti mappa.json   {"vecchio-uuid": "nuovo-uuid", ...}: se gli accessi sono stati ricreati
 *                       (Supabase → Authentication), i loro nuovi identificativi sostituiscono i vecchi ovunque.
 * --sovrascrivi         svuota le tabelle anche se contengono già dati (altrimenti si ferma).
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { leggiExcel, type Cella } from '../src/lib/excel';

const args = process.argv.slice(2);
const percorso = args.find((a) => !a.startsWith('--') && a.endsWith('.xlsx'));
const iMappa = args.indexOf('--utenti');
const mappa: Record<string, string> = iMappa >= 0 ? JSON.parse(readFileSync(args[iMappa + 1], 'utf8')) : {};
const sovrascrivi = args.includes('--sovrascrivi');
const dbUrl = process.env.SUPABASE_DB_URL;
if (!percorso || !dbUrl) { console.error('Uso: SUPABASE_DB_URL=... npx tsx strumenti/ripristina-da-excel.ts backup.xlsx [--utenti mappa.json] [--sovrascrivi]'); process.exit(1); }

const ESCLUSE = new Set(['backup_excel', 'push_chiavi', 'push_iscrizioni']);
const fogli = leggiExcel(new Uint8Array(readFileSync(percorso)));
const db = new pg.Client({ connectionString: dbUrl, ssl: dbUrl.includes('localhost') ? undefined : { rejectUnauthorized: false } });
await db.connect();

interface Col { nome: string; tipo: string; identita: boolean }
const { rows: colonne } = await db.query<{ tabella: string; nome: string; tipo: string; identita: boolean }>(`
  select c.relname as tabella, a.attname as nome, format_type(a.atttypid, a.atttypmod) as tipo, a.attidentity <> '' as identita
    from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''`);
const schema = new Map<string, Col[]>();
colonne.forEach((c) => schema.set(c.tabella, [...(schema.get(c.tabella) ?? []), c]));

const daRipristinare = fogli.filter((f) => schema.has(f.nome) && !ESCLUSE.has(f.nome));
if (!daRipristinare.length) { console.error('Nel file non ci sono fogli con i nomi delle tabelle: è un backup del gestionale?'); process.exit(1); }
const ignorati = fogli.filter((f) => !schema.has(f.nome) && !['Leggimi', 'Ordini', 'Giacenze'].includes(f.nome)).map((f) => f.nome);
if (ignorati.length) console.warn(`Fogli ignorati (non sono tabelle di questo database): ${ignorati.join(', ')}`);

// valore della cella → testo per PostgreSQL
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const pgArray = (a: unknown[]): string => `{${a.map((x) => x == null ? 'NULL' : Array.isArray(x) ? pgArray(x) : `"${String(x).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`;
function converti(v: Cella, tipo: string): string | null {
  if (v == null) return null;
  let s = typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v);
  if (Object.keys(mappa).length) s = s.replace(UUID, (u) => mappa[u.toLowerCase()] ?? u);
  if (tipo.endsWith('[]') && s.startsWith('[')) s = pgArray(JSON.parse(s));
  return s;
}

const piene: string[] = [];
for (const f of daRipristinare) {
  const { rows: [x] } = await db.query(`select exists (select 1 from public.${pg.escapeIdentifier(f.nome)}) as c`);
  if (x.c) piene.push(f.nome);
}
// le migrazioni caricano già catalogo e impostazioni di partenza: conta solo il lavoro vero
const conDati = piene.filter((t) => ['clienti', 'comande', 'movimenti_prodotto', 'movimenti_pagamento', 'lotti', 'acquisti', 'sessioni_mercato'].includes(t));
if (conDati.length && !sovrascrivi) {
  console.error(`Il database contiene già dati (${conDati.join(', ')}). Per svuotarlo e ripristinare aggiungi --sovrascrivi.`);
  process.exit(1);
}

await db.query('begin');
try {
  // niente controlli e trigger durante il caricamento: i dati arrivano già coerenti dal backup
  await db.query("set local session_replication_role = 'replica'");
  await db.query(`truncate ${daRipristinare.map((f) => `public.${pg.escapeIdentifier(f.nome)}`).join(', ')} restart identity cascade`);
  for (const f of daRipristinare) {
    const cols = schema.get(f.nome)!.filter((c) => f.colonne.includes(c.nome));
    const idx = cols.map((c) => f.colonne.indexOf(c.nome));
    const mancanti = schema.get(f.nome)!.filter((c) => !f.colonne.includes(c.nome)).map((c) => c.nome);
    if (mancanti.length) console.warn(`${f.nome}: colonne non presenti nel backup, restano vuote o predefinite: ${mancanti.join(', ')}`);
    const righe = f.righe.filter((r) => r.some((v) => v != null));
    for (let i = 0; i < righe.length; i += 300) {
      const blocco = righe.slice(i, i + 300);
      const valori: (string | null)[] = [];
      const tuple = blocco.map((r) => `(${cols.map((c, k) => { valori.push(converti(r[idx[k]] ?? null, c.tipo)); return `$${valori.length}::${c.tipo}`; }).join(', ')})`);
      await db.query(`insert into public.${pg.escapeIdentifier(f.nome)} (${cols.map((c) => pg.escapeIdentifier(c.nome)).join(', ')})
                      overriding system value values ${tuple.join(', ')}`, valori);
    }
    for (const c of cols.filter((c) => c.identita)) {
      await db.query(`select setval(pg_get_serial_sequence($1, $2), coalesce((select max(${pg.escapeIdentifier(c.nome)}) from public.${pg.escapeIdentifier(f.nome)}), 1),
                      (select count(*) > 0 from public.${pg.escapeIdentifier(f.nome)}))`, [`public.${f.nome}`, c.nome]);
    }
    console.log(`${f.nome}: ${righe.length} righe`);
  }
  await db.query('commit');
  console.log(`Ripristino completato: ${daRipristinare.length} tabelle.`);
} catch (e) {
  await db.query('rollback');
  console.error('Ripristino annullato, il database non è stato toccato:', (e as Error).message);
  process.exitCode = 1;
}
await db.end();
