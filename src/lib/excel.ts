/**
 * Excel (.xlsx) minimo, senza librerie pesanti: un file .xlsx è uno zip di file XML.
 * Usato sia dall'app (scarica una copia adesso) sia dal backup automatico (Node, GitHub Actions)
 * e, in lettura, dallo script di ripristino.
 */
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';

export type Cella = string | number | boolean | null | undefined;
export interface Foglio { nome: string; colonne: string[]; righe: Cella[][]; larghezze?: number[] }

const xml = (s: string) => s
  // caratteri non ammessi in XML (tranne tab, a capo)
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function colonna(i: number) {
  let s = ''; i += 1;
  while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

/** Nome valido per un foglio Excel: max 31 caratteri, senza : \ / ? * [ ] */
export const nomeFoglio = (n: string) => n.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31);

function cella(ref: string, v: Cella, stile = 0): string {
  const s = stile ? ` s="${stile}"` : '';
  if (v == null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? `<c r="${ref}"${s}><v>${v}</v></c>` : '';
  if (typeof v === 'boolean') return `<c r="${ref}"${s} t="b"><v>${v ? 1 : 0}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
}

function xmlFoglio(f: Foglio): string {
  const larg = f.colonne.map((c, i) => f.larghezze?.[i]
    ?? Math.min(60, Math.max(8, c.length + 2, ...f.righe.slice(0, 200).map((r) => String(r[i] ?? '').length + 2))));
  const righe = [
    `<row r="1">${f.colonne.map((c, i) => cella(`${colonna(i)}1`, c, 1)).join('')}</row>`,
    ...f.righe.map((r, k) => `<row r="${k + 2}">${r.map((v, i) => cella(`${colonna(i)}${k + 2}`, v)).join('')}</row>`),
  ];
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    + `<cols>${larg.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    + `<sheetData>${righe.join('')}</sheetData></worksheet>`;
}

/** Crea il file .xlsx: la prima riga di ogni foglio è l'intestazione (in grassetto, sempre visibile). */
export function creaExcel(fogli: Foglio[]): Uint8Array {
  const n = fogli.length;
  const file: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + fogli.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
      + '</Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '</Relationships>'),
    'xl/workbook.xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
      + fogli.map((f, i) => `<sheet name="${xml(nomeFoglio(f.nome))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
      + '</sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + fogli.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
      + '</Relationships>'),
    'xl/styles.xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
      + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
      + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
      + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>'
      + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
      + '</styleSheet>'),
  };
  fogli.forEach((f, i) => { file[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(xmlFoglio(f)); });
  return zipSync(file, { level: 6 });
}

// ---------------------------------------------------------------- lettura (per il ripristino)

const testo = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&');
const unisciT = (s: string) => [...s.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => testo(m[1])).join('');
const indiceColonna = (ref: string) => [...ref.replace(/\d+/g, '')].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** Legge un .xlsx (anche se riaperto e salvato con Excel o Numbers). Celle vuote = null. */
export function leggiExcel(dati: Uint8Array): Foglio[] {
  const z = unzipSync(dati);
  const s = (p: string) => (z[p] ? strFromU8(z[p]) : '');
  const condivise = [...s('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unisciT(m[1]));
  const rels = new Map([...s('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map((m) => {
    const id = /Id="([^"]+)"/.exec(m[0])?.[1] ?? '', t = /Target="([^"]+)"/.exec(m[0])?.[1] ?? '';
    return [id, t.replace(/^\/?xl\//, '').replace(/^\//, '')];
  }));
  return [...s('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)].map((m) => {
    const nome = testo(/name="([^"]*)"/.exec(m[0])?.[1] ?? '');
    const rid = /r:id="([^"]+)"/.exec(m[0])?.[1] ?? '';
    const contenuto = s(`xl/${rels.get(rid)}`);
    const righe: Cella[][] = [];
    for (const r of contenuto.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g)) {
      const riga: Cella[] = [];
      for (const c of (r[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attr = c[1], corpo = c[2] ?? '';
        const ref = /r="([A-Z]+)\d+"/.exec(attr)?.[1];
        const i = ref ? indiceColonna(ref) : riga.length;
        const t = /t="([^"]+)"/.exec(attr)?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(corpo)?.[1];
        let val: Cella = null;
        if (t === 'inlineStr') val = unisciT(corpo);
        else if (t === 's') val = condivise[Number(v)] ?? '';
        else if (t === 'str') val = v != null ? testo(v) : '';
        else if (t === 'b') val = v === '1';
        else if (v != null) val = Number(v);
        riga[i] = val;
      }
      righe.push(Array.from(riga, (x) => (x === undefined ? null : x)));
    }
    const [testa = [], ...resto] = righe;
    return { nome, colonne: testa.map((x) => String(x ?? '')), righe: resto };
  });
}
