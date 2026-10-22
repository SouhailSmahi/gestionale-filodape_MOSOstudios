-- Incassi chiari, backup settimanale in Excel e notifiche sul telefono (ottobre 2026).
--
-- 1. Ogni movimento di denaro di un ordine dice cos'è: incasso, acconto o resto.
--    Lo decide il database al momento della registrazione, confrontando l'importo con
--    la merce già consegnata e non ancora pagata.
-- 2. Esportazione completa dei dati (per l'Excel di backup, da cui si può anche ripristinare).
-- 3. Backup settimanali conservati nel gestionale (gli ultimi 8) e notifiche push al titolare.

-- ============================================================================
-- 1. TIPO DEI MOVIMENTI DI DENARO
-- ============================================================================
alter table movimenti_pagamento
    add column tipo text,
    add column quota_acconto numeric(10,2) not null default 0;

-- Incasso: paga merce già consegnata. Acconto: paga merce non ancora consegnata.
-- Incasso e acconto: una parte e l'altra (quota_acconto dice quanto è acconto). Resto: soldi restituiti.
create or replace function fn_tipo_movimento_pagamento() returns trigger
language plpgsql security definer set search_path = public as $$
declare dovuto numeric; pagato numeric; scoperto numeric;
begin
    if new.importo < 0 then
        new.tipo := 'resto'; new.quota_acconto := 0;
        return new;
    end if;
    select coalesce(sum(cr.quantita_evasa * coalesce(cr.prezzo_unitario_applicato, 0)), 0) into dovuto
      from comanda_righe cr where cr.comanda_id = new.comanda_id;
    select coalesce(sum(importo), 0) into pagato from movimenti_pagamento where comanda_id = new.comanda_id;
    scoperto := greatest(dovuto - pagato, 0);
    new.quota_acconto := greatest(new.importo - scoperto, 0);
    new.tipo := case when new.quota_acconto = 0 then 'incasso'
                     when new.quota_acconto = new.importo then 'acconto'
                     else 'incasso_acconto' end;
    return new;
end $$;
create trigger trg_tipo_movimento_pagamento before insert on movimenti_pagamento
    for each row execute function fn_tipo_movimento_pagamento();
revoke execute on function fn_tipo_movimento_pagamento() from public, anon, authenticated;

-- Movimenti già registrati: si ricostruisce la storia di ogni ordine in ordine di tempo
-- (a parità di orario, prima la consegna e poi il pagamento).
alter table movimenti_pagamento disable trigger trg_solo_inserimento;
with eventi as (
    select mp.id, mp.comanda_id, mp.importo,
           coalesce((select sum(csr.quantita * coalesce(cr.prezzo_unitario_applicato, 0))
                       from consegne cs join consegna_righe csr on csr.consegna_id = cs.id
                       join comanda_righe cr on cr.id = csr.comanda_riga_id
                      where cs.comanda_id = mp.comanda_id and cs.data_consegna <= mp.data_movimento), 0) as dovuto,
           coalesce(sum(mp.importo) over (partition by mp.comanda_id order by mp.data_movimento, mp.id
                                          rows between unbounded preceding and 1 preceding), 0) as pagato
      from movimenti_pagamento mp
), calcolo as (
    select id, importo, greatest(importo - greatest(dovuto - pagato, 0), 0) as acconto from eventi
)
update movimenti_pagamento mp
   set quota_acconto = case when c.importo < 0 then 0 else c.acconto end,
       tipo = case when c.importo < 0 then 'resto'
                   when c.acconto = 0 then 'incasso'
                   when c.acconto = c.importo then 'acconto'
                   else 'incasso_acconto' end
  from calcolo c where c.id = mp.id;
alter table movimenti_pagamento enable trigger trg_solo_inserimento;

alter table movimenti_pagamento
    alter column tipo set not null,
    add constraint movimenti_pagamento_tipo check (tipo in ('incasso', 'acconto', 'incasso_acconto', 'resto'));

-- ============================================================================
-- 2. ESPORTAZIONE COMPLETA DEI DATI
-- ============================================================================
-- Tutte le tabelle con colonne e righe, più due riepiloghi leggibili.
-- Questa versione interna la usa il backup automatico (utente proprietario del database).
create or replace function _dati_esportazione() returns jsonb
language plpgsql security definer set search_path = public as $$
declare t record; righe jsonb; colonne jsonb; elenco text; tabelle jsonb := '[]';
begin
    for t in select c.relname as nome
               from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relkind = 'r'
                and c.relname not in ('backup_excel', 'push_iscrizioni', 'push_chiavi')
              order by c.relname loop
        select jsonb_agg(a.attname order by a.attnum) into colonne
          from pg_attribute a where a.attrelid = format('public.%I', t.nome)::regclass and a.attnum > 0 and not a.attisdropped;
        -- json e numeri senza precisione fissa come testo: nel file restano identici al centesimo (e oltre)
        select string_agg(case when a.atttypid in ('json'::regtype, 'jsonb'::regtype)
                                 or (a.atttypid = 'numeric'::regtype and a.atttypmod = -1)
                               then format('%I::text as %I', a.attname, a.attname) else format('%I', a.attname) end, ', ' order by a.attnum)
          into elenco
          from pg_attribute a where a.attrelid = format('public.%I', t.nome)::regclass and a.attnum > 0 and not a.attisdropped;
        execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from (select %s from public.%I order by 1) x', elenco, t.nome) into righe;
        tabelle := tabelle || jsonb_build_object('nome', t.nome, 'colonne', colonne, 'righe', righe);
    end loop;
    return jsonb_build_object(
        'creato_il', now(),
        'tabelle', tabelle,
        'ordini', (select coalesce(jsonb_agg(x order by x."Data ordine", x."N."), '[]') from (
            select c.id as "N.", (c.creata_il at time zone 'Europe/Rome')::date as "Data ordine",
                   trim(cl.nome || ' ' || cl.cognome) as "Cliente", c.stato::text as "Stato",
                   (select string_agg(v.codice_articolo || ' × ' || cr.quantita_ordinata, ', ' order by v.codice_articolo)
                      from comanda_righe cr join varianti_prodotto v on v.id = cr.variante_id where cr.comanda_id = c.id) as "Prodotti",
                   (select sum(cr.quantita_ordinata * coalesce(cr.prezzo_unitario_applicato, 0)) from comanda_righe cr where cr.comanda_id = c.id) as "Totale €",
                   (select sum(cr.quantita_evasa * coalesce(cr.prezzo_unitario_applicato, 0)) from comanda_righe cr where cr.comanda_id = c.id) as "Consegnato €",
                   coalesce((select sum(importo) from movimenti_pagamento mp where mp.comanda_id = c.id), 0) as "Incassato €",
                   c.note as "Note"
              from comande c join clienti cl on cl.id = c.cliente_id) x),
        'giacenze', (select coalesce(jsonb_agg(x order by x."Codice"), '[]') from (
            select v.codice_articolo as "Codice", p.nome as "Prodotto", v.formato as "Formato",
                   coalesce((select sum(quantita) from movimenti_prodotto m where m.variante_id = v.id), 0) as "Pezzi pronti"
              from varianti_prodotto v join prodotti p on p.id = v.prodotto_id) x)
    );
end $$;
revoke execute on function _dati_esportazione() from public, anon, authenticated;

-- Versione per l'app: solo il titolare
create or replace function esporta_dati() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
    if not is_admin() then raise exception 'Solo l''amministratore può esportare i dati'; end if;
    return _dati_esportazione();
end $$;
revoke execute on function esporta_dati() from public, anon;
grant execute on function esporta_dati() to authenticated;

-- ============================================================================
-- 3. BACKUP SETTIMANALI E NOTIFICHE PUSH
-- ============================================================================
-- I file li scrive il backup automatico (GitHub Actions, utente proprietario); l'app li elenca e li scarica.
create table backup_excel (
    id           bigint generated always as identity primary key,
    creato_il    timestamptz not null default now(),
    nome_file    text not null,
    dimensione   int not null,
    file         bytea not null,
    scaricato_il timestamptz
);
alter table backup_excel enable row level security;
create policy admin_legge on backup_excel for select to authenticated using (is_admin());
-- dall'app si vede l'elenco, il file si scarica solo con scarica_backup()
revoke all on backup_excel from anon, authenticated;
grant select (id, creato_il, nome_file, dimensione, scaricato_il) on backup_excel to authenticated;

-- Scarica un backup (in base64) e segna che è stato scaricato
create or replace function scarica_backup(p_id bigint) returns text
language plpgsql security definer set search_path = public as $$
declare f bytea;
begin
    if not is_admin() then raise exception 'Solo l''amministratore può scaricare i backup'; end if;
    update backup_excel set scaricato_il = coalesce(scaricato_il, now()) where id = p_id returning file into f;
    if f is null then raise exception 'Backup non trovato: ricarica la pagina'; end if;
    return encode(f, 'base64');
end $$;
revoke execute on function scarica_backup(bigint) from public, anon;
grant execute on function scarica_backup(bigint) to authenticated;

-- Chiavi per le notifiche push (le crea il backup automatico al primo giro). La privata non esce dal database.
create table push_chiavi (
    id         boolean primary key default true check (id),
    pubblica   text not null,
    privata    text not null,
    creata_il  timestamptz not null default now()
);
alter table push_chiavi enable row level security;   -- nessuna regola: dall'app non si legge
revoke all on push_chiavi from anon, authenticated;

create or replace function chiave_push_pubblica() returns text
language sql stable security definer set search_path = public as $$
    select pubblica from push_chiavi where is_admin()
$$;
revoke execute on function chiave_push_pubblica() from public, anon;
grant execute on function chiave_push_pubblica() to authenticated;

-- Dispositivi del titolare che ricevono le notifiche
create table push_iscrizioni (
    id          bigint generated always as identity primary key,
    utente_id   uuid not null references profili(id) default auth.uid(),
    endpoint    text not null unique,
    p256dh      text not null,
    auth        text not null,
    dispositivo text,
    creata_il   timestamptz not null default now()
);
alter table push_iscrizioni enable row level security;
create policy proprie_iscrizioni on push_iscrizioni for select to authenticated using (utente_id = auth.uid() and is_admin());
revoke all on push_iscrizioni from anon;
revoke all on push_iscrizioni from authenticated;
grant select on push_iscrizioni to authenticated;   -- si scrive solo con le due funzioni qui sotto

create or replace function salva_iscrizione_push(p_endpoint text, p_p256dh text, p_auth text, p_dispositivo text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
    if not is_admin() then raise exception 'Le notifiche sul telefono sono solo per il titolare'; end if;
    if coalesce(p_endpoint, '') = '' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
        raise exception 'Iscrizione alle notifiche non valida: riprova';
    end if;
    insert into push_iscrizioni (utente_id, endpoint, p256dh, auth, dispositivo)
    values (auth.uid(), p_endpoint, p_p256dh, p_auth, nullif(trim(p_dispositivo), ''))
    on conflict (endpoint) do update set utente_id = excluded.utente_id, p256dh = excluded.p256dh,
        auth = excluded.auth, dispositivo = excluded.dispositivo;
end $$;

create or replace function togli_iscrizione_push(p_endpoint text) returns void
language plpgsql security definer set search_path = public as $$
begin
    delete from push_iscrizioni where endpoint = p_endpoint and utente_id = auth.uid();
end $$;
revoke execute on function salva_iscrizione_push(text, text, text, text), togli_iscrizione_push(text) from public, anon;
grant execute on function salva_iscrizione_push(text, text, text, text), togli_iscrizione_push(text) to authenticated;

-- Categoria delle notifiche in app per i backup
alter type categoria_notifica add value if not exists 'backup';
