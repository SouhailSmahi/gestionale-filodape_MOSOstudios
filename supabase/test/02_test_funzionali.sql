\set ON_ERROR_STOP 1
set role authenticated;
create or replace function pg_temp.as_user(u text) returns void language sql as
 $$ select set_config('request.jwt.claim.sub', case u when 'admin' then '11111111-1111-1111-1111-111111111111'
                                               when 'staff' then '22222222-2222-2222-2222-222222222222' else '' end, false) $$;
-- verifica che un comando fallisca con un messaggio atteso
create or replace function pg_temp.deve_fallire(nome text, cmd text, atteso text) returns text language plpgsql as $$
begin
  execute cmd;
  return 'FAIL ' || nome || ': nessun errore';
exception when others then
  if sqlerrm ilike '%' || atteso || '%' then return 'ok   ' || nome || ' → ' || sqlerrm;
  else return 'FAIL ' || nome || ' → ' || sqlerrm; end if;
end $$;
create or replace function pg_temp.check(nome text, cond boolean) returns text language sql as
 $$ select case when cond then 'ok   ' else 'FAIL ' end || nome $$;

\pset tuples_only on
\pset format unaligned

-- ---------- STAFF
select pg_temp.as_user('staff');
select pg_temp.check('staff non vede acquisti', (select count(*) from acquisti) = 0);
select pg_temp.check('staff non vede costi vasetti', (select count(*) from v_costo_vasetti) = 0);
select pg_temp.check('staff non vede lotti', (select count(*) from v_lotti) = 0);
select pg_temp.check('staff non legge clienti (tabella)', (select count(*) from clienti) = 0);
select pg_temp.check('staff vede disponibilità', (select count(*) from v_disponibilita_staff) = 15);
select pg_temp.check('staff: disponibilità ACA-500 = 160+150-? dal confezionamento', (select disponibile from v_disponibilita_staff where codice_articolo='MIE-ACA-500') = 310);
select crea_comanda(null, '{"nome":"Mario","cognome":"Bianchi","telefono":"333"}', '[{"variante_id":2,"quantita":3},{"variante_id":8,"quantita":2}]', 'ritira sabato') as comanda_staff \gset
select pg_temp.check('staff vede la propria comanda', (select count(*) from v_mie_comande) = 1);
select pg_temp.check('staff vede il nuovo cliente nella vista ridotta', (select count(*) from v_clienti_staff where cognome='Bianchi') = 1);
select pg_temp.check('prezzo congelato sulla riga', (select prezzo_unitario_applicato from comanda_righe where comanda_id = :comanda_staff and variante_id=2) = 7.00);
select pg_temp.deve_fallire('staff non conferma', 'select conferma_comanda(' || :comanda_staff || ', ''confermata'', current_date)', 'Solo l''amministratore');
select pg_temp.deve_fallire('staff non registra acquisti', 'select registra_acquisto(current_date, null, null, ''[{"articolo_id":1,"quantita":1,"totale":1}]'')', 'Solo l''amministratore');
select pg_temp.deve_fallire('staff non chiude lotti', 'select chiudi_lotto(6, 0)', 'Solo l''amministratore');
select pg_temp.deve_fallire('staff non inserisce movimenti', 'insert into movimenti_prodotto (variante_id, tipo, quantita) values (1, ''carico_iniziale'', 100)', 'row-level security');
update comanda_righe set quantita_ordinata = 4 where comanda_id = :comanda_staff and variante_id = 2;
select pg_temp.check('staff modifica finché in attesa', (select quantita_ordinata from comanda_righe where comanda_id = :comanda_staff and variante_id=2) = 4);

select crea_comanda(null, '{"nome":"Lucia","cognome":"Prova"}', '[{"variante_id":2,"quantita":1}]') as da_annullare \gset
update comande set stato = 'annullata', cliente_id = 1 where id = :da_annullare;
select pg_temp.check('staff annulla la propria comanda', (select stato from comande where id = :da_annullare) = 'annullata');
select pg_temp.check('staff non cambia il cliente', (select cliente_id from comande where id = :da_annullare) <> 1);
select pg_temp.deve_fallire('staff non usa motivo_id', 'select motivo_id(''prodotti'', ''Prova staff'')', 'permission denied');
reset role;
update varianti_prodotto set attivo = false where codice_articolo = 'MIE-CAS-125';
set role authenticated;
select pg_temp.deve_fallire('staff non ordina prodotti archiviati', 'insert into comanda_righe (comanda_id, variante_id, quantita_ordinata) values (' || :comanda_staff || ', (select id from varianti_prodotto where codice_articolo = ''MIE-CAS-125''), 1)', 'non disponibile');
reset role;
update varianti_prodotto set attivo = true where codice_articolo = 'MIE-CAS-125';
set role authenticated;

-- ---------- ADMIN
select pg_temp.as_user('admin');
select pg_temp.check('notifiche: 2 nuovi ordini, modifica e annullamento', (select count(*) from notifiche where categoria in ('ordini','modifiche')) = 4);
select conferma_comanda(:comanda_staff, 'confermata', current_date + 3);
select pg_temp.as_user('staff');
update comanda_righe set quantita_ordinata = 9 where comanda_id = :comanda_staff and variante_id = 2;
select pg_temp.check('staff NON modifica dopo la conferma', (select quantita_ordinata from comanda_righe where comanda_id = :comanda_staff and variante_id=2) is null
                     or (select count(*) from comanda_righe where comanda_id = :comanda_staff and quantita_ordinata = 9) = 0);
select pg_temp.check('staff vede data indicativa', (select data_consegna_indicativa from v_mie_comande where id = :comanda_staff) = current_date + 3);
select pg_temp.as_user('admin');
select registra_consegna(:comanda_staff, (select jsonb_agg(jsonb_build_object('comanda_riga_id', id, 'quantita', case when variante_id=2 then 2 else 2 end)) from comanda_righe where comanda_id = :comanda_staff));
select pg_temp.check('consegna parziale → parzialmente_evasa', (select stato from comande where id = :comanda_staff) = 'parzialmente_evasa');
select pg_temp.deve_fallire('transizione evasa→in_attesa vietata', 'update comande set stato = ''in_attesa_conferma'' where id = ' || :comanda_staff, 'non ammesso');
select pg_temp.deve_fallire('consegna oltre ordinato', 'select registra_consegna(' || :comanda_staff || ', (select jsonb_agg(jsonb_build_object(''comanda_riga_id'', id, ''quantita'', 99)) from comanda_righe where comanda_id = ' || :comanda_staff || '))', 'consegna_oltre_ordinato');
insert into movimenti_pagamento (comanda_id, importo, note) values (:comanda_staff, 20, 'contanti');
select pg_temp.check('saldo aperto', (select saldo from v_saldi_aperti where comanda_id = :comanda_staff) = 2*7 + 2*7 - 20);

-- registri append-only
reset role;
select pg_temp.deve_fallire('ledger non modificabile', 'update movimenti_prodotto set quantita = 1', 'non si modificano');
select pg_temp.deve_fallire('ledger non cancellabile', 'delete from movimenti_miele', 'non si modificano');
select pg_temp.deve_fallire('audit non modificabile', 'delete from audit_log', 'non si modificano');
set role authenticated;
with u as (update movimenti_prodotto set quantita = 1 returning 1) select pg_temp.check('admin via app: update ledger non tocca nulla (RLS)', (select count(*) from u) = 0);

-- produzione: blocchi
select pg_temp.deve_fallire('confeziona oltre il miele del lotto', 'select confeziona(6, ''[{"variante_id":6,"pezzi":80}]'')', 'Miele sfuso insufficiente');
select pg_temp.deve_fallire('confeziona formato di un altro miele', 'select confeziona(6, ''[{"variante_id":2,"pezzi":1}]'')', 'non è un vasetto di questo miele');
select pg_temp.deve_fallire('vasetti 125g insufficienti', 'select confeziona(6, ''[{"variante_id":4,"pezzi":200}]'')', 'Non basta');
select pg_temp.check('nessun residuo dopo errore (atomico)', (select count(*) from lotto_eventi where lotto_id = 6 and tipo='confezionamento') = 0);
select pg_temp.deve_fallire('chiusura senza residuo', 'select chiudi_lotto(6, null)', 'Indica quanti kg');
select pg_temp.deve_fallire('lotto chiuso non riceve eventi', 'select registra_evento_lotto(4, ''spostamento'', now(), 1, 1)', 'chiuso');
select pg_temp.deve_fallire('lotto senza smielatura non si chiude', 'select chiudi_lotto(nuovo_lotto(1), 0)', 'non ha ancora una smielatura');
select nuovo_lotto(1, 2026) as nl \gset
select pg_temp.check('codice lotto progressivo ACA-2026-02', (select codice from lotti where id = :nl) = 'ACA-2026-02');
-- km proposti dalla postazione
select registra_evento_lotto(6, 'spostamento', now(), 2, 1) as ev \gset
select pg_temp.check('km proposti dalla postazione', (select km from lotto_eventi where id = :ev) = 56);

-- costo congelato e "dati cambiati"
update impostazioni set valore_ora = 10;
select pg_temp.check('dati cambiati dopo impostazioni', (select dati_cambiati from v_lotti where codice = 'ACA-2026-01'));
select pg_temp.check('congelato invariato', (select costo_kg_congelato from v_lotti where codice = 'ACA-2026-01') = 2.6122);
select ricalcola_lotto(4);
select pg_temp.check('ricalcola aggiorna', (select not dati_cambiati and costo_kg_congelato > 2.6122 from v_lotti where codice = 'ACA-2026-01'));
update impostazioni set valore_ora = 0;
select ricalcola_tutti_lotti();

-- correzione pesata smielatura → movimento compensativo
update smielatura_bariloni set kg = 35 where kg = 34;
select pg_temp.check('correzione barilone aggiorna sfuso', (select kg_sfuso from v_lotti where id = 6) = 71);

-- acquisti: correzione riga e articolo nuovo al volo + soglia
select registra_acquisto(current_date, null, 'Ferramenta Nuova', '[{"nuovo_articolo":{"nome":"Nutrimento liquido","categoria":"ali","unita":"l"},"quantita":10,"totale":25}]') as acq \gset
select pg_temp.check('articolo nuovo in magazzino apistiche', (select magazzino = 'apistiche' and giacenza = 10 from v_giacenza_articoli where nome = 'Nutrimento liquido'));
update acquisto_righe set quantita = 12 where acquisto_id = :acq;
select pg_temp.check('correzione acquisto → giacenza 12', (select giacenza from v_giacenza_articoli where nome = 'Nutrimento liquido') = 12);
select pg_temp.check('fornitore creato', exists (select 1 from fornitori where nome = 'Ferramenta Nuova'));
select pg_temp.deve_fallire('nome articolo duplicato (maiuscole)', 'insert into articoli (nome, categoria_id) values (''NUTRIMENTO liquido '', 1)', 'duplicate key');
select pg_temp.deve_fallire('postazione duplicata', 'insert into postazioni (nome) values (''colline di buttrio'')', 'duplicate key');
select pg_temp.check('notifica scorta candito', exists (select 1 from notifiche where categoria = 'stock'));

-- rettifiche con motivo nuovo
select rettifica_prodotto(2, -1, 'Regalato al vicino');
select pg_temp.check('motivo nuovo entra in lista', exists (select 1 from motivi_rettifica where magazzino='prodotti' and nome='Regalato al vicino'));
select rettifica_prodotto(2, -1, 'regalato al VICINO');
select pg_temp.check('motivo riusato senza duplicati', (select count(*) from motivi_rettifica where lower(nome)='regalato al vicino') = 1);
select pg_temp.deve_fallire('rettifica senza motivo', 'select rettifica_articolo(1, -1, '' '')', 'motivo');

-- mercato
insert into sessioni_mercato (luogo) values ('Mercato di Udine') returning id as mk \gset
insert into sessione_mercato_righe (sessione_id, variante_id, quantita_prelevata) values (:mk, 8, 10);
select pg_temp.check('staff vede prelevato al mercato', (select prelevata_mercato from v_disponibilita_staff where variante_id = 8) = 10);
select chiudi_sessione_mercato(:mk, '[{"variante_id":8,"quantita_resa":4}]');
select pg_temp.check('fatturato mercato', (select sum(importo) from v_fatturato where canale = 'mercato') = 6 * 7);

-- archiviazione / cancellazione
select pg_temp.deve_fallire('non si cancella una postazione usata', 'delete from postazioni where id = 1', 'foreign key');
insert into postazioni (nome) values ('Prova da cancellare');
delete from postazioni where nome = 'Prova da cancellare';
select pg_temp.check('postazione mai usata cancellata', not exists (select 1 from postazioni where nome = 'Prova da cancellare'));

-- nuovo tipo di miele con distinta proposta
select nuovo_tipo_miele('Tiglio', 'tig') as tig \gset
select pg_temp.check('Tiglio: 3 formati con 3 componenti (niente sigillo)', (select count(*) from distinta_base d join varianti_prodotto v on v.id = d.variante_id where v.codice_articolo like 'MIE-TIG-%') = 9);
select pg_temp.check('Tiglio SKU', exists (select 1 from varianti_prodotto where codice_articolo = 'MIE-TIG-1KG'));

-- home e grafici per utente
insert into grafici_utente (titolo, misura, divisione) values ('Kg per tipo', 'kg_smielati', 'tipo_miele');
select pg_temp.as_user('staff');
select pg_temp.check('grafici privati per utente', (select count(*) from grafici_utente) = 0);
select pg_temp.as_user('admin');
select pg_temp.check('da fare: chiudi MIL-2026-02', exists (select 1 from v_da_fare where testo like '%MIL-2026-02%'));
select pg_temp.check('incassi/costi per anno', (select count(*) from v_incassi_costi_anno) >= 1);

-- ordini raggruppati per cliente: aggiunta, conferma, consegna e incasso in blocco
select pg_temp.as_user('staff');
select crea_comanda(null, '{"nome":"Gino","cognome":"Gruppo"}', '[{"variante_id":2,"quantita":2}]') as ga \gset
select aggiungi_a_comanda(:ga, '[{"variante_id":2,"quantita":1},{"variante_id":8,"quantita":1}]', 'anche millefiori');
select pg_temp.check('aggiunta: pezzi sommati sulla stessa riga', (select quantita_ordinata from comanda_righe where comanda_id = :ga and variante_id = 2) = 3
                     and (select count(*) from comanda_righe where comanda_id = :ga) = 2);
select pg_temp.check('aggiunta: nota accodata', (select note from comande where id = :ga) = 'anche millefiori');
select pg_temp.check('aiutante vede il cliente dell''ordine', (select cliente_id from v_mie_comande where id = :ga) is not null);
select pg_temp.deve_fallire('staff non consegna in blocco', 'select consegna_comande(array[' || :ga || ']::bigint[])', 'Solo l''amministratore');
select pg_temp.as_user('admin');
select crea_comanda((select cliente_id from comande where id = :ga), null, '[{"variante_id":8,"quantita":2}]') as gb \gset
select pg_temp.as_user('staff');
select pg_temp.deve_fallire('staff non aggiunge a ordini altrui', 'select aggiungi_a_comanda(' || :gb || ', ''[{"variante_id":2,"quantita":1}]'')', 'solo ai tuoi');
select pg_temp.as_user('admin');
select conferma_comande(array[:ga, :gb]::bigint[], 'confermata', current_date + 2);
select pg_temp.check('conferma in blocco', (select count(*) from comande where id in (:ga, :gb) and stato = 'confermata' and data_consegna_indicativa = current_date + 2) = 2);
select pg_temp.deve_fallire('niente aggiunte dopo la conferma', 'select aggiungi_a_comanda(' || :ga || ', ''[{"variante_id":2,"quantita":1}]'')', 'già stato confermato');
select coalesce(sum(cr.quantita_ordinata * cr.prezzo_unitario_applicato), 0) as tot_g from comanda_righe cr where cr.comanda_id in (:ga, :gb) \gset
select consegna_comande(array[:ga, :gb]::bigint[], :tot_g + 8);
select pg_temp.check('consegna in blocco: tutto consegnato', (select count(*) from comande where id in (:ga, :gb) and stato = 'evasa') = 2);
select pg_temp.check('incasso diviso: incassato il totale scritto', (select sum(importo) from movimenti_pagamento where comanda_id in (:ga, :gb)) = :tot_g + 8);
select pg_temp.check('incasso diviso: primo ordine saldato', not exists (select 1 from v_saldi_aperti where comanda_id = :ga));
select pg_temp.check('incasso diviso: avanzo come acconto sull''ultimo', (select saldo from v_saldi_aperti where comanda_id = :gb) = -8);
select crea_comanda((select cliente_id from comande where id = :ga), null, '[{"variante_id":4,"quantita":500}]') as gc \gset
select conferma_comande(array[:gc]::bigint[], 'in_produzione', current_date + 9);
select pg_temp.deve_fallire('consegna in blocco senza merce', 'select consegna_comande(array[' || :gc || ']::bigint[])', 'Merce pronta insufficiente');
select pg_temp.check('nessuna consegna parziale dopo il rifiuto', (select quantita_evasa from comanda_righe where comanda_id = :gc) = 0);

-- fatturato per anno: manuale fino al 2025, automatico dal 2026
select pg_temp.as_user('admin');
select imposta_fatturato_storico(2025, 8000, 'indicativo, dai conti di Filippo');
select pg_temp.check('2025 scritto a mano', (select venduto from v_fatturato_anni where anno = 2025 and fonte = 'manuale') = 8000);
select imposta_fatturato_storico(2025, 8200.456, null);
select pg_temp.check('correzione: nuovo valore arrotondato', (select importo from fatturato_storico where anno = 2025) = 8200.46);
select pg_temp.check('correzione registrata con il valore di prima', (select count(*) from fatturato_storico_modifiche where anno = 2025) = 2
                     and (select importo_prima from fatturato_storico_modifiche where anno = 2025 order by id desc limit 1) = 8000);
select pg_temp.deve_fallire('2026 non si scrive a mano', 'select imposta_fatturato_storico(2026, 100)', 'lo calcola l''app');
select pg_temp.deve_fallire('importo negativo rifiutato', 'select imposta_fatturato_storico(2024, -1)', 'negativo');
select pg_temp.deve_fallire('niente scritture dirette', 'insert into fatturato_storico (anno, importo) values (2023, 1)', 'permission denied');
select pg_temp.check('anno in corso calcolato dagli ordini confermati',
  (select venduto_ordini from v_fatturato_anni where fonte = 'automatico' and anno = extract(year from now() at time zone 'Europe/Rome')::int)
  = (select coalesce(sum(cr.quantita_ordinata * coalesce(cr.prezzo_unitario_applicato, 0)), 0) from comande c join comanda_righe cr on cr.comanda_id = c.id
      where c.stato not in ('annullata', 'in_attesa_conferma') and extract(year from c.creata_il at time zone 'Europe/Rome') = extract(year from now() at time zone 'Europe/Rome')));
select venduto as v_prima from v_fatturato_anni where fonte = 'automatico' and anno = extract(year from now() at time zone 'Europe/Rome')::int \gset
select crea_comanda((select id from clienti limit 1), null, '[{"variante_id":2,"quantita":3}]') as fz \gset
select pg_temp.check('ordine da confermare non conta', (select venduto from v_fatturato_anni where fonte = 'automatico' and anno = extract(year from now() at time zone 'Europe/Rome')::int) = :v_prima);
select conferma_comande(array[:fz]::bigint[], 'confermata', current_date + 1);
select pg_temp.check('ordine confermato conta subito, anche senza consegna', (select venduto from v_fatturato_anni where fonte = 'automatico' and anno = extract(year from now() at time zone 'Europe/Rome')::int)
                     = :v_prima + 3 * (select prezzo_unitario_applicato from comanda_righe where comanda_id = :fz));
select pg_temp.as_user('staff');
select pg_temp.check('staff non vede il fatturato', (select count(*) from v_fatturato_anni) = 0 and (select count(*) from fatturato_storico) = 0);
select pg_temp.deve_fallire('staff non modifica il fatturato', 'select imposta_fatturato_storico(2025, 1)', 'Solo l''amministratore');
select pg_temp.as_user('admin');
select imposta_fatturato_storico(2025, null);
select pg_temp.check('valore tolto, modifica registrata', not exists (select 1 from fatturato_storico where anno = 2025)
                     and (select count(*) from fatturato_storico_modifiche where anno = 2025) = 3);

-- movimenti di denaro: incasso, acconto, resto
select pg_temp.as_user('admin');
select crea_comanda((select id from clienti limit 1), null, '[{"variante_id":2,"quantita":2}]') as mi \gset
select conferma_comande(array[:mi]::bigint[], 'confermata', current_date + 1);
select prezzo_unitario_applicato as pz from comanda_righe where comanda_id = :mi \gset
insert into movimenti_pagamento (comanda_id, importo, note) values (:mi, 5, 'prima della consegna');
select pg_temp.check('pagamento prima della consegna = acconto', (select tipo from movimenti_pagamento where comanda_id = :mi order by id desc limit 1) = 'acconto'
                     and (select quota_acconto from movimenti_pagamento where comanda_id = :mi order by id desc limit 1) = 5);
select registra_consegna(:mi, (select jsonb_agg(jsonb_build_object('comanda_riga_id', id, 'quantita', 2)) from comanda_righe where comanda_id = :mi));
insert into movimenti_pagamento (comanda_id, importo, tipo) values (:mi, 2 * :pz - 5 + 3, 'resto');
select pg_temp.check('dopo la consegna: incasso con 3 € di acconto (il tipo lo decide il database)',
  (select tipo from movimenti_pagamento where comanda_id = :mi order by id desc limit 1) = 'incasso_acconto'
  and (select quota_acconto from movimenti_pagamento where comanda_id = :mi order by id desc limit 1) = 3);
insert into movimenti_pagamento (comanda_id, importo) values (:mi, -3);
select pg_temp.check('soldi restituiti = resto', (select tipo from movimenti_pagamento where comanda_id = :mi order by id desc limit 1) = 'resto');
select pg_temp.check('tutti i movimenti hanno un tipo', not exists (select 1 from movimenti_pagamento where tipo is null));

-- esportazione completa e backup in Excel
select pg_temp.check('esportazione: tutte le tabelle, senza i backup', (select count(*) from jsonb_array_elements(esporta_dati()->'tabelle') t where t->>'nome' = 'comande') = 1
                     and not exists (select 1 from jsonb_array_elements(esporta_dati()->'tabelle') t where t->>'nome' in ('backup_excel', 'push_chiavi', 'push_iscrizioni')));
select pg_temp.check('esportazione: riepilogo ordini leggibile', jsonb_array_length(esporta_dati()->'ordini') = (select count(*) from comande));
select pg_temp.deve_fallire('versione interna non chiamabile dall''app', 'select _dati_esportazione()', 'permission denied');
reset role;
insert into backup_excel (nome_file, dimensione, file) values ('prova.xlsx', 3, '\x010203');
insert into push_chiavi (pubblica, privata) values ('PUB', 'PRIV');
set role authenticated;
select pg_temp.check('backup: il titolare vede l''elenco', (select count(*) from backup_excel) = 1);
select pg_temp.deve_fallire('backup: il file non si legge direttamente', 'select file from backup_excel', 'permission denied');
select pg_temp.check('backup: scaricato in base64', scarica_backup((select id from backup_excel limit 1)) = 'AQID');
select pg_temp.check('backup: segnato come scaricato', (select scaricato_il from backup_excel limit 1) is not null);
select pg_temp.check('chiave pubblica per le notifiche', chiave_push_pubblica() = 'PUB');
select pg_temp.deve_fallire('chiave privata non leggibile', 'select privata from push_chiavi', 'permission denied');
select salva_iscrizione_push('https://push.example/abc', 'k1', 'a1', 'iPhone');
select pg_temp.check('iscrizione push del titolare', (select count(*) from push_iscrizioni) = 1);
select pg_temp.as_user('staff');
select pg_temp.deve_fallire('staff non esporta', 'select esporta_dati()', 'Solo l''amministratore');
select pg_temp.deve_fallire('staff non scarica backup', 'select scarica_backup(1)', 'Solo l''amministratore');
select pg_temp.check('staff non vede backup né iscrizioni', (select count(*) from backup_excel) = 0 and (select count(*) from push_iscrizioni) = 0);
select pg_temp.check('staff non ha la chiave push', chiave_push_pubblica() is null);
select pg_temp.deve_fallire('staff non riceve notifiche sul telefono', 'select salva_iscrizione_push(''https://x'', ''k'', ''a'')', 'solo per il titolare');
select pg_temp.as_user('admin');
select togli_iscrizione_push('https://push.example/abc');
select pg_temp.check('iscrizione tolta', (select count(*) from push_iscrizioni) = 0);

-- valore degli ordini dell'anno (Home)
select pg_temp.as_user('admin');
select pg_temp.check('ordini dell''anno: totale = da confermare + da consegnare + consegnato',
  (select totale = da_confermare + da_consegnare + consegnato from v_ordini_anno where anno = extract(year from now() at time zone 'Europe/Rome')::int));
select pg_temp.check('ordini dell''anno: annullati esclusi, da confermare inclusi',
  (select totale from v_ordini_anno where anno = extract(year from now() at time zone 'Europe/Rome')::int)
  = (select sum(cr.quantita_ordinata * coalesce(cr.prezzo_unitario_applicato, 0)) from comande c join comanda_righe cr on cr.comanda_id = c.id
      where c.stato <> 'annullata' and extract(year from c.creata_il at time zone 'Europe/Rome') = extract(year from now() at time zone 'Europe/Rome')));
select pg_temp.as_user('staff');
select pg_temp.check('staff non vede il valore degli ordini', (select count(*) from v_ordini_anno) = 0);
select pg_temp.as_user('admin');

-- soldi ancora da incassare sugli ordini aperti (Home)
select pg_temp.as_user('admin');
select pg_temp.check('da incassare: totale = da confermare + da consegnare + consegnati',
  (select totale = da_confermare + da_consegnare + consegnati from v_ordini_da_incassare));
select totale as dai_prima from v_ordini_da_incassare \gset
select crea_comanda((select id from clienti limit 1), null, '[{"variante_id":2,"quantita":1}]') as dz \gset
select prezzo_unitario_applicato as dzp from comanda_righe where comanda_id = :dz \gset
select pg_temp.check('ordine nuovo da confermare entra nel da incassare', (select totale from v_ordini_da_incassare) = :dai_prima + :dzp);
select conferma_comande(array[:dz]::bigint[], 'confermata', current_date + 1);
insert into movimenti_pagamento (comanda_id, importo) values (:dz, 2);
select pg_temp.check('l''acconto riduce il da incassare', (select totale from v_ordini_da_incassare) = :dai_prima + :dzp - 2);
insert into movimenti_pagamento (comanda_id, importo) values (:dz, :dzp - 2);
select pg_temp.check('pagato del tutto: non conta più (anche se non consegnato)', (select totale from v_ordini_da_incassare) = :dai_prima);
select pg_temp.as_user('staff');
select pg_temp.check('staff non vede il da incassare', (select ordini from v_ordini_da_incassare) = 0);
select pg_temp.as_user('admin');

-- utente disattivato
reset role;
update profili set attivo = false where username = 'anna.menossi';
set role authenticated;
select pg_temp.as_user('staff');
select pg_temp.deve_fallire('staff disattivato non ordina', 'select crea_comanda(1, null, ''[{"variante_id":2,"quantita":1}]'')', 'non attivo');
select pg_temp.check('staff disattivato non vede nulla', (select count(*) from v_disponibilita_staff) = 0);

-- anonimo
reset role;
set role anon;
select pg_temp.deve_fallire('anon niente tabelle', 'select * from clienti', 'permission denied');
select pg_temp.deve_fallire('anon niente funzioni', 'select crea_comanda(1, null, ''[]'')', 'permission denied');

-- ---------- struttura: ogni tabella ha la sicurezza per riga attiva
reset role;
select pg_temp.check('RLS attiva su tutte le tabelle', not exists (select 1 from pg_tables where schemaname = 'public' and not rowsecurity));
