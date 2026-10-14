-- ============================================================================
-- FILODAPE — Gestionale  ·  Schema DB v03.1  (caso studio MOSO Studios)
-- Target: Supabase (PostgreSQL 15+)  ·  Testato su PostgreSQL 16
-- Migrazione iniziale: si esegue UNA volta su un progetto Supabase vuoto.
-- ----------------------------------------------------------------------------
-- Rispetto alla v02
--   • Produzione a lotti (ACA-2026-01): spostamenti, smielatura a bariloni,
--     confezionamento, chiusura con residuo, calo e uso personale
--   • Quattro magazzini a registro: miele sfuso (kg per lotto), materiali di
--     consumo, materie apistiche, prodotti finiti
--   • Acquisti come scontrini (fornitori, articoli, confezioni), costo medio
--   • Mezzi (dedicato / personale / terzi) e costo dei viaggi
--   • Attività di stagione (nutrizione, trattamenti) su tutte o alcune postazioni
--   • Attrezzatura (cespiti) con costo d'uso annuo e contributi
--   • Calcolatore: costo al kg per lotto e per vasetto, congelato alla chiusura
--   • Anagrafiche con archiviazione, motivi di rettifica estendibili
--   • Home personalizzabile e grafici salvati per utente
--   • Correzioni: registri append-only, transizioni di stato controllate,
--     fuso Europe/Rome, viste admin security_invoker, clienti ridotti per lo staff
-- Convenzioni
--   • Le regole stanno qui: l'app chiama tabelle (RLS) o funzioni rpc().
--   • Ogni giacenza = somma dei movimenti; i movimenti non si modificano mai.
--   • "Archiviato" = sparisce dai menu, resta nello storico.
-- ============================================================================

create extension if not exists pgcrypto;

do $$ begin
    execute format('alter database %I set timezone = %L', current_database(), 'Europe/Rome');
exception when insufficient_privilege then
    raise notice 'Fuso orario del database non impostato (permessi): le date restano corrette, sono salvate con il fuso.';
end $$;
set timezone = 'Europe/Rome';

-- ============================================================================
-- 0. TIPI
-- ============================================================================
create type ruolo_utente           as enum ('admin', 'staff');
create type stato_comanda          as enum ('in_attesa_conferma', 'confermata', 'in_produzione',
                                            'parzialmente_evasa', 'evasa', 'annullata');
create type tipo_cliente           as enum ('privato', 'azienda');
create type stato_sessione_mercato as enum ('aperta', 'chiusa');
create type categoria_notifica     as enum ('ordini', 'stock', 'prezzi', 'modifiche', 'produzione');
create type magazzino_articolo     as enum ('materiali', 'apistiche');
create type magazzino_rettifica    as enum ('prodotti', 'articoli', 'miele');
create type unita_misura           as enum ('kg', 'l', 'pz');
create type tipo_mezzo             as enum ('dedicato', 'personale', 'terzi');
create type tipo_mov_prodotto      as enum ('carico_iniziale', 'carico_produzione', 'scarico_consegna',
                                            'prelievo_mercato', 'reso_mercato', 'rettifica');
create type tipo_mov_articolo      as enum ('acquisto', 'confezionamento', 'uso_personale', 'attivita', 'rettifica');
create type tipo_mov_miele         as enum ('smielatura', 'confezionamento', 'uso_personale', 'calo', 'rettifica');
create type stato_lotto            as enum ('aperto', 'chiuso');
create type tipo_evento_lotto      as enum ('spostamento', 'smielatura', 'confezionamento', 'chiusura');
create type tipo_attivita          as enum ('nutrizione', 'trattamento');
create type stato_cespite          as enum ('in_uso', 'dismesso');


-- ============================================================================
-- 1. UTENTI E IMPOSTAZIONI
--    Login "nome.cognome" → email tecnica nome.cognome@<dominio_login>.
-- ============================================================================
create table profili (
    id          uuid primary key references auth.users(id) on delete cascade,
    username    text not null unique check (username ~ '^[a-z0-9]+(\.[a-z0-9]+)+$'),
    nome        text not null,
    cognome     text not null,
    ruolo       ruolo_utente not null default 'staff',
    attivo      boolean not null default true,
    creato_il   timestamptz not null default now()
);

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
    select exists (select 1 from profili where id = auth.uid() and ruolo = 'admin' and attivo);
$$;

create or replace function is_utente_attivo() returns boolean
language sql stable security definer set search_path = public as $$
    select exists (select 1 from profili where id = auth.uid() and attivo);
$$;

-- Una sola riga. Pensata anche per il white-label (nome azienda, dominio login).
create table impostazioni (
    id                boolean primary key default true check (id),
    nome_azienda      text not null default 'Filodape',
    dominio_login     text not null default 'utenti.filodape.it',
    valore_ora        numeric(8,2) not null default 0 check (valore_ora >= 0),   -- € per ora di lavoro nel costo
    costo_netto       boolean not null default true,     -- cespiti al netto del contributo
    tariffa_auto_km   numeric(6,3) not null default 0.15 -- proposta per nuovi mezzi "personale"
);
insert into impostazioni default values;


-- ============================================================================
-- 2. ANAGRAFICHE
--    Tutte con "archiviato" e nome univoco senza distinzione di maiuscole.
-- ============================================================================
create table clienti (
    id          bigint generated always as identity primary key,
    tipo        tipo_cliente not null default 'privato',
    nome        text not null,
    cognome     text not null default '',
    telefono    text,
    note        text,
    archiviato  boolean not null default false,
    creato_da   uuid default auth.uid() references profili(id),
    creato_il   timestamptz not null default now()
);

create table fornitori (
    id           int generated always as identity primary key,
    nome         text not null,
    telefono     text,
    partita_iva  text,
    note         text,
    archiviato   boolean not null default false
);
create unique index ux_fornitori_nome on fornitori (lower(trim(nome)));

create table postazioni (
    id          int generated always as identity primary key,
    nome        text not null,
    localita    text,
    km_abituali numeric(7,1) check (km_abituali >= 0),   -- andata e ritorno
    arnie       int check (arnie >= 0),
    note        text,
    archiviato  boolean not null default false
);
create unique index ux_postazioni_nome on postazioni (lower(trim(nome)));

create table mezzi (
    id          int generated always as identity primary key,
    nome        text not null,
    tipo        tipo_mezzo not null,
    tariffa_km  numeric(6,3) check (tariffa_km >= 0),
    note        text,
    archiviato  boolean not null default false,
    constraint personale_senza_tariffa check (tipo <> 'personale' or tariffa_km is not null)
);
create unique index ux_mezzi_nome on mezzi (lower(trim(nome)));

create table motivi_rettifica (
    id          int generated always as identity primary key,
    magazzino   magazzino_rettifica not null,
    nome        text not null,
    archiviato  boolean not null default false
);
create unique index ux_motivi on motivi_rettifica (magazzino, lower(trim(nome)));

-- Restituisce il motivo esistente o lo crea ("Altro: scrivi il motivo" entra nella lista)
create or replace function motivo_id(p_magazzino magazzino_rettifica, p_nome text) returns int
language plpgsql security definer set search_path = public as $$
declare v int;
begin
    if coalesce(trim(p_nome), '') = '' then raise exception 'Indica il motivo della rettifica'; end if;
    select id into v from motivi_rettifica where magazzino = p_magazzino and lower(trim(nome)) = lower(trim(p_nome));
    if v is null then
        insert into motivi_rettifica (magazzino, nome) values (p_magazzino, trim(p_nome)) returning id into v;
    end if;
    return v;
end $$;


-- ============================================================================
-- 3. CATALOGO DI VENDITA
-- ============================================================================
create table tipi_miele (
    id          int generated always as identity primary key,
    nome        text not null,
    sigla       text not null unique check (sigla ~ '^[A-Z]{3}$'),   -- usata nei codici lotto e SKU
    archiviato  boolean not null default false
);
create unique index ux_tipi_miele_nome on tipi_miele (lower(trim(nome)));

create table categorie_prodotto (
    id    int generated always as identity primary key,
    nome  text not null unique
);

create table prodotti (
    id             int generated always as identity primary key,
    categoria_id   int not null references categorie_prodotto(id),
    nome           text not null,
    tipo_miele_id  int unique references tipi_miele(id),   -- valorizzato solo per i mieli
    attivo         boolean not null default true
);
create unique index ux_prodotti_nome on prodotti (lower(trim(nome)));

create table varianti_prodotto (
    id               int generated always as identity primary key,
    prodotto_id      int not null references prodotti(id),
    formato          text,                     -- '125g' | '500g' | '1kg' | NULL se formato unico
    peso_kg          numeric(6,3),             -- miele contenuto: serve a costi e kg venduti
    codice_articolo  text not null unique,     -- SKU: MIE-ACA-500, CAN-PAL, ...
    attivo           boolean not null default true,
    unique nulls not distinct (prodotto_id, formato)
);

create table prezzi_storico (
    id           bigint generated always as identity primary key,
    variante_id  int not null references varianti_prodotto(id),
    prezzo       numeric(10,2) not null check (prezzo >= 0),
    valido_dal   timestamptz not null default now(),
    valido_al    timestamptz,
    creato_da    uuid default auth.uid() references profili(id),
    check (valido_al is null or valido_al >= valido_dal)
);
create unique index ux_prezzo_corrente on prezzi_storico (variante_id) where valido_al is null;

create or replace function imposta_prezzo(p_variante int, p_prezzo numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
    if not is_admin() then raise exception 'Solo l''amministratore può modificare i prezzi'; end if;
    update prezzi_storico set valido_al = now() where variante_id = p_variante and valido_al is null;
    if p_prezzo is not null then      -- NULL = torna "prezzo X"
        insert into prezzi_storico (variante_id, prezzo) values (p_variante, p_prezzo);
    end if;
end $$;


-- ============================================================================
-- 4. ARTICOLI (tutto ciò che si compra) E DISTINTA BASE
-- ============================================================================
create table categorie_articolo (
    id                 int generated always as identity primary key,
    codice             text not null unique,     -- conf, ali, trat, attr, carb, mezzi, altro
    nome               text not null,
    magazzino_default  magazzino_articolo        -- proposto per i nuovi articoli
);

create table articoli (
    id             int generated always as identity primary key,
    nome           text not null,
    categoria_id   int not null references categorie_articolo(id),
    magazzino      magazzino_articolo,           -- NULL = solo spesa (carburante, assicurazione…)
    unita          unita_misura not null default 'pz',
    scorta_minima  numeric(12,3) check (scorta_minima >= 0),
    codice         text unique,                  -- VAS-500G, TAP-1KG, SIG-ACA…
    archiviato     boolean not null default false
);
create unique index ux_articoli_nome on articoli (lower(trim(nome)));

create table articoli_confezioni (
    id           int generated always as identity primary key,
    articolo_id  int not null references articoli(id) on delete cascade,
    nome         text not null,                  -- 'sacco', 'cartone'
    quantita     numeric(12,3) not null check (quantita > 0)   -- in unità base dell'articolo
);
create unique index ux_confezioni on articoli_confezioni (articolo_id, lower(trim(nome)));

create table distinta_base (
    variante_id  int not null references varianti_prodotto(id) on delete cascade,
    articolo_id  int not null references articoli(id),
    quantita     numeric(10,3) not null default 1 check (quantita > 0),
    primary key (variante_id, articolo_id)
);

-- Propone la distinta di un vasetto: vasetto, tappo, etichetta del formato + sigillo del tipo.
-- Si basa sui codici articolo (VAS-500G, TAP-500G, ETI-500G, SIG-ACA). Filippo poi la corregge.
create or replace function proponi_distinta(p_variante int) returns int
language plpgsql security definer set search_path = public as $$
declare v_fmt text; v_sigla text; n int;
begin
    if not is_admin() then raise exception 'Operazione riservata all''amministratore'; end if;
    select upper(v.formato), t.sigla into v_fmt, v_sigla
      from varianti_prodotto v join prodotti p on p.id = v.prodotto_id
      left join tipi_miele t on t.id = p.tipo_miele_id
     where v.id = p_variante;
    if v_fmt is null then return 0; end if;
    insert into distinta_base (variante_id, articolo_id)
    select p_variante, a.id from articoli a
     where not a.archiviato
       and a.codice in ('VAS-' || v_fmt, 'TAP-' || v_fmt, 'ETI-' || v_fmt, 'SIG-' || coalesce(v_sigla, '---'))
    on conflict do nothing;
    get diagnostics n = row_count;
    return n;
end $$;

-- Nuovo tipo di miele: tipo + prodotto + un vasetto per ogni formato già in uso, con distinta proposta
create or replace function nuovo_tipo_miele(p_nome text, p_sigla text) returns int
language plpgsql security definer set search_path = public as $$
declare v_tipo int; v_prod int; v_var int; f record;
begin
    if not is_admin() then raise exception 'Operazione riservata all''amministratore'; end if;
    insert into tipi_miele (nome, sigla) values (trim(p_nome), upper(trim(p_sigla))) returning id into v_tipo;
    insert into prodotti (categoria_id, nome, tipo_miele_id)
    values ((select id from categorie_prodotto where nome = 'Miele'), 'Miele ' || trim(p_nome), v_tipo)
    returning id into v_prod;
    for f in select distinct v.formato, v.peso_kg
               from varianti_prodotto v join prodotti p on p.id = v.prodotto_id
              where p.tipo_miele_id is not null and v.formato is not null and v.attivo
              order by v.peso_kg loop
        insert into varianti_prodotto (prodotto_id, formato, peso_kg, codice_articolo)
        values (v_prod, f.formato, f.peso_kg, 'MIE-' || upper(trim(p_sigla)) || '-' ||
                case when f.formato ilike '%kg' then upper(f.formato) else replace(f.formato, 'g', '') end)
        returning id into v_var;
        perform proponi_distinta(v_var);
    end loop;
    return v_tipo;
end $$;


-- ============================================================================
-- 5. ACQUISTI (scontrini) E ATTREZZATURA
--    IVA compresa: in regime forfettario non si recupera.
-- ============================================================================
create table acquisti (
    id            bigint generated always as identity primary key,
    data          date not null default current_date,
    fornitore_id  int references fornitori(id),
    note          text,
    creato_da     uuid default auth.uid() references profili(id),
    creato_il     timestamptz not null default now()
);

create table acquisto_righe (
    id               bigint generated always as identity primary key,
    acquisto_id      bigint not null references acquisti(id) on delete cascade,
    articolo_id      int not null references articoli(id),
    quantita         numeric(12,3) not null check (quantita > 0),   -- sempre in unità base
    totale           numeric(10,2) not null check (totale >= 0),    -- pagato, IVA compresa
    mezzo_id         int references mezzi(id),                      -- righe di carburante
    contachilometri  int check (contachilometri > 0)
);
create index ix_acquisto_righe_articolo on acquisto_righe (articolo_id);

create table categorie_cespite (
    id                  int generated always as identity primary key,
    nome                text not null unique,
    vita_utile_default  int not null check (vita_utile_default > 0)
);

create table cespiti (
    id                bigint generated always as identity primary key,
    nome              text not null,
    categoria_id      int not null references categorie_cespite(id),
    quantita          int not null default 1 check (quantita > 0),
    anno_acquisto     int not null check (anno_acquisto between 1950 and 2100),
    prezzo            numeric(10,2) not null check (prezzo >= 0),      -- totale pagato
    contributo        numeric(10,2) not null default 0 check (contributo >= 0),
    vita_utile        int not null check (vita_utile > 0),
    stato             stato_cespite not null default 'in_uso',
    data_dismissione  date,
    acquisto_riga_id  bigint unique references acquisto_righe(id) on delete set null,
    note              text,
    check (contributo <= prezzo),
    check ((stato = 'dismesso') = (data_dismissione is not null))
);


-- ============================================================================
-- 6. PRODUZIONE A LOTTI
-- ============================================================================
create table lotti (
    id                  bigint generated always as identity primary key,
    codice              text not null unique,           -- ACA-2026-01 (generato)
    tipo_miele_id       int not null references tipi_miele(id),
    anno                int not null,
    progressivo         int not null,
    stato               stato_lotto not null default 'aperto',
    ricordami_chiusura  boolean not null default false, -- "ricordamelo dopo": resta tra le cose da fare
    note                text,
    creato_da           uuid default auth.uid() references profili(id),
    creato_il           timestamptz not null default now(),
    -- chiusura
    data_chiusura       date,
    kg_rimasto          numeric(10,3),
    kg_calo             numeric(10,3),                  -- teorico − rimasto (negativo = eccedenza)
    kg_uso_personale    numeric(10,3),
    -- costo congelato (scritto da chiudi_lotto / ricalcola_lotto)
    costo_totale        numeric(12,2),
    kg_vendibili        numeric(10,3),
    costo_kg            numeric(10,4),
    costo_dettaglio     jsonb,
    costo_calcolato_il  timestamptz,
    unique (tipo_miele_id, anno, progressivo),
    check (stato = 'aperto' or (data_chiusura is not null and kg_rimasto is not null))
);

create table lotti_costo_vasetti (
    lotto_id          bigint not null references lotti(id) on delete cascade,
    variante_id       int not null references varianti_prodotto(id),
    costo_confezione  numeric(10,4) not null,
    costo_miele       numeric(10,4) not null,
    costo_totale      numeric(10,4) not null,
    primary key (lotto_id, variante_id)
);

create table lotto_eventi (
    id             bigint generated always as identity primary key,
    lotto_id       bigint not null references lotti(id),
    tipo           tipo_evento_lotto not null,
    data           timestamptz not null default now(),    -- modificabile
    postazione_id  int references postazioni(id),
    mezzo_id       int references mezzi(id),              -- facoltativo su smielatura/confezionamento
    km             numeric(7,1) check (km >= 0),
    minuti         int check (minuti >= 0),
    arnie          int check (arnie >= 0),
    costo_terzi    numeric(10,2) check (costo_terzi >= 0), -- viaggio con mezzo di altri
    note           text,
    creato_da      uuid default auth.uid() references profili(id),
    creato_il      timestamptz not null default now(),
    constraint spostamento_senza_postazione check (tipo <> 'spostamento' or (postazione_id is not null and mezzo_id is not null))
);
create index ix_lotto_eventi_lotto on lotto_eventi (lotto_id);

create table smielatura_bariloni (
    id         bigint generated always as identity primary key,
    evento_id  bigint not null references lotto_eventi(id),
    kg         numeric(8,3) not null check (kg > 0)
);

create table confezionamento_righe (
    id             bigint generated always as identity primary key,
    evento_id      bigint not null references lotto_eventi(id),
    variante_id    int not null references varianti_prodotto(id),
    pezzi          int not null check (pezzi > 0),
    uso_personale  boolean not null default false
);

create table attivita_stagione (
    id           bigint generated always as identity primary key,
    tipo         tipo_attivita not null,
    data         date not null default current_date,
    articolo_id  int not null references articoli(id),
    quantita     numeric(12,3) not null check (quantita > 0),   -- unità base
    minuti       int check (minuti >= 0),
    note         text,
    creato_da    uuid default auth.uid() references profili(id),
    creato_il    timestamptz not null default now()
);

-- Nessuna riga = tutte le postazioni
create table attivita_postazioni (
    attivita_id    bigint not null references attivita_stagione(id) on delete cascade,
    postazione_id  int not null references postazioni(id),
    primary key (attivita_id, postazione_id)
);


-- ============================================================================
-- 7. COMANDE, CONSEGNE, PAGAMENTI
-- ============================================================================
create table comande (
    id                        bigint generated always as identity primary key,
    cliente_id                bigint not null references clienti(id),
    stato                     stato_comanda not null default 'in_attesa_conferma',
    data_consegna_indicativa  date,
    confermata_da             uuid references profili(id),
    confermata_il             timestamptz,
    note                      text,
    creata_da                 uuid default auth.uid() references profili(id),
    creata_il                 timestamptz not null default now(),
    constraint conferma_senza_data check (stato in ('in_attesa_conferma', 'annullata') or data_consegna_indicativa is not null)
);

create table comanda_righe (
    id                         bigint generated always as identity primary key,
    comanda_id                 bigint not null references comande(id) on delete cascade,
    variante_id                int not null references varianti_prodotto(id),
    quantita_ordinata          int not null check (quantita_ordinata > 0),
    quantita_evasa             int not null default 0,
    prezzo_unitario_applicato  numeric(10,2),
    constraint consegna_oltre_ordinato check (quantita_evasa >= 0 and quantita_evasa <= quantita_ordinata)
);

create table consegne (
    id              bigint generated always as identity primary key,
    comanda_id      bigint not null references comande(id),
    data_consegna   timestamptz not null default now(),
    eseguita_da     uuid default auth.uid() references profili(id),
    note            text
);

create table consegna_righe (
    id               bigint generated always as identity primary key,
    consegna_id      bigint not null references consegne(id),
    comanda_riga_id  bigint not null references comanda_righe(id),
    quantita         int not null check (quantita > 0)
);

create table movimenti_pagamento (
    id              bigint generated always as identity primary key,
    comanda_id      bigint not null references comande(id),
    importo         numeric(10,2) not null check (importo <> 0),   -- + incasso, − resto o storno
    data_movimento  timestamptz not null default now(),
    note            text,
    creato_da       uuid default auth.uid() references profili(id)
);


-- ============================================================================
-- 8. MERCATO
-- ============================================================================
create table sessioni_mercato (
    id          bigint generated always as identity primary key,
    luogo       text not null,
    data        date not null default current_date,
    stato       stato_sessione_mercato not null default 'aperta',
    aperta_da   uuid default auth.uid() references profili(id),
    chiusa_il   timestamptz,
    note        text
);

create table sessione_mercato_righe (
    id                         bigint generated always as identity primary key,
    sessione_id                bigint not null references sessioni_mercato(id),
    variante_id                int not null references varianti_prodotto(id),
    quantita_prelevata         int not null check (quantita_prelevata > 0),
    quantita_resa              int,
    prezzo_unitario_applicato  numeric(10,2),
    unique (sessione_id, variante_id),
    constraint resa_oltre_prelevato check (quantita_resa is null or (quantita_resa >= 0 and quantita_resa <= quantita_prelevata))
);


-- ============================================================================
-- 9. REGISTRI DI MAGAZZINO (append-only: la giacenza è la somma)
-- ============================================================================
create table movimenti_prodotto (
    id                   bigint generated always as identity primary key,
    variante_id          int not null references varianti_prodotto(id),
    tipo                 tipo_mov_prodotto not null,
    quantita             int not null check (quantita <> 0),
    motivo_id            int references motivi_rettifica(id),
    note                 text,
    lotto_id             bigint references lotti(id),
    consegna_riga_id     bigint references consegna_righe(id),
    sessione_mercato_id  bigint references sessioni_mercato(id),
    creato_da            uuid default auth.uid() references profili(id),
    creato_il            timestamptz not null default now(),
    constraint rettifica_senza_motivo check (tipo <> 'rettifica' or motivo_id is not null),
    check ( (tipo in ('carico_iniziale', 'carico_produzione', 'reso_mercato') and quantita > 0)
         or (tipo in ('scarico_consegna', 'prelievo_mercato')                  and quantita < 0)
         or  tipo = 'rettifica')
);
create index ix_mov_prodotto on movimenti_prodotto (variante_id);

create table movimenti_articoli (
    id                 bigint generated always as identity primary key,
    articolo_id        int not null references articoli(id),
    tipo               tipo_mov_articolo not null,
    quantita           numeric(12,3) not null check (quantita <> 0),
    motivo_id          int references motivi_rettifica(id),
    note               text,
    acquisto_riga_rif  bigint,          -- riferimento senza FK: la riga d'acquisto può essere corretta
    lotto_id           bigint references lotti(id),
    attivita_id        bigint references attivita_stagione(id),
    creato_da          uuid default auth.uid() references profili(id),
    creato_il          timestamptz not null default now(),
    constraint rettifica_articolo_senza_motivo check (tipo <> 'rettifica' or motivo_id is not null),
    check ( tipo in ('acquisto', 'rettifica')
         or (tipo in ('confezionamento', 'uso_personale', 'attivita') and quantita < 0))
);
create index ix_mov_articoli on movimenti_articoli (articolo_id);

create table movimenti_miele (
    id          bigint generated always as identity primary key,
    lotto_id    bigint not null references lotti(id),
    tipo        tipo_mov_miele not null,
    kg          numeric(10,3) not null check (kg <> 0),
    evento_id   bigint references lotto_eventi(id),
    motivo_id   int references motivi_rettifica(id),
    note        text,
    creato_da   uuid default auth.uid() references profili(id),
    creato_il   timestamptz not null default now(),
    constraint rettifica_miele_senza_motivo check (tipo <> 'rettifica' or motivo_id is not null),
    check ( tipo in ('smielatura', 'calo', 'rettifica')
         or (tipo in ('confezionamento', 'uso_personale') and kg < 0))
);
create index ix_mov_miele on movimenti_miele (lotto_id);


-- ============================================================================
-- 10. NOTIFICHE, AUDIT, PREFERENZE
-- ============================================================================
create table notifiche (
    id           bigint generated always as identity primary key,
    categoria    categoria_notifica not null,
    titolo       text not null,
    messaggio    text,
    tabella_rif  text,
    record_rif   text,
    generata_da  uuid references profili(id),
    creata_il    timestamptz not null default now(),
    letta_il     timestamptz,
    letta_da     uuid references profili(id)
);
create index ix_notifiche_da_leggere on notifiche (categoria) where letta_il is null;

create table audit_log (
    id         bigint generated always as identity primary key,
    tabella    text not null,
    record_id  text,
    azione     text not null,
    utente_id  uuid,
    prima      jsonb,
    dopo       jsonb,
    creato_il  timestamptz not null default now()
);

create table preferenze_home (
    utente_id  uuid primary key default auth.uid() references profili(id) on delete cascade,
    riquadri   text[] not null default array['todo', 'kpi', 'produzione']   -- in ordine
);

create table grafici_utente (
    id          bigint generated always as identity primary key,
    utente_id   uuid not null default auth.uid() references profili(id) on delete cascade,
    titolo      text not null,
    misura      text not null check (misura in ('incassi', 'pezzi', 'kg_smielati', 'spese', 'costo_kg')),
    divisione   text not null check (divisione in ('mese', 'anno', 'tipo_miele', 'formato', 'canale', 'categoria', 'lotto')),
    periodo     jsonb not null default '{"anni": 1}',    -- es. {"anni": 2} oppure {"dal": "2025-01-01", "al": "2026-12-31"}
    in_home     boolean not null default false,
    creato_il   timestamptz not null default now()
);


-- ============================================================================
-- 11. LOGICA DI BASE: registri, blocchi, transizioni
-- ============================================================================

-- 11.1 Registri e audit sono append-only (correzioni = nuovi movimenti)
create or replace function fn_solo_inserimento() returns trigger
language plpgsql as $$
begin
    raise exception 'I movimenti di % non si modificano né si cancellano: registra una rettifica', tg_table_name;
end $$;

do $$
declare t text;
begin
    foreach t in array array['movimenti_prodotto', 'movimenti_articoli', 'movimenti_miele',
                             'movimenti_pagamento', 'audit_log', 'consegne', 'consegna_righe'] loop
        execute format('create trigger trg_solo_inserimento before update or delete on %I
                        for each row execute function fn_solo_inserimento()', t);
    end loop;
end $$;

-- 11.2 Blocco giacenze negative (con lock sulla riga anagrafica contro le doppie vendite)
create or replace function fn_blocca_giacenza_prodotto() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_giacenza int; v_sku text;
begin
    if new.quantita < 0 then
        select codice_articolo into v_sku from varianti_prodotto where id = new.variante_id for update;
        select coalesce(sum(quantita), 0) into v_giacenza from movimenti_prodotto where variante_id = new.variante_id;
        if v_giacenza + new.quantita < 0 then
            raise exception 'Quantità esaurita per %: disponibili % pz, richiesti % pz', v_sku, v_giacenza, -new.quantita;
        end if;
    end if;
    return new;
end $$;
create trigger trg_blocca_giacenza_prodotto before insert on movimenti_prodotto
    for each row execute function fn_blocca_giacenza_prodotto();

create or replace function fn_blocca_giacenza_articolo() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_giacenza numeric; a articoli%rowtype;
begin
    if new.quantita < 0 then
        select * into a from articoli where id = new.articolo_id for update;
        select coalesce(sum(quantita), 0) into v_giacenza from movimenti_articoli where articolo_id = new.articolo_id;
        if v_giacenza + new.quantita < 0 then
            raise exception 'Non basta %: disponibili % %, servono % %',
                a.nome, round(v_giacenza, 3), a.unita, round(-new.quantita, 3), a.unita;
        end if;
    end if;
    return new;
end $$;
create trigger trg_blocca_giacenza_articolo before insert on movimenti_articoli
    for each row execute function fn_blocca_giacenza_articolo();

create or replace function fn_blocca_giacenza_miele() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_giacenza numeric; v_codice text;
begin
    if new.kg < 0 then
        select codice into v_codice from lotti where id = new.lotto_id for update;
        select coalesce(sum(kg), 0) into v_giacenza from movimenti_miele where lotto_id = new.lotto_id;
        if v_giacenza + new.kg < -0.0005 then
            raise exception 'Miele sfuso insufficiente nel lotto %: disponibili % kg, servono % kg',
                v_codice, round(v_giacenza, 3), round(-new.kg, 3);
        end if;
    end if;
    return new;
end $$;
create trigger trg_blocca_giacenza_miele before insert on movimenti_miele
    for each row execute function fn_blocca_giacenza_miele();

-- 11.3 Comande: campi riservati all'admin e transizioni di stato ammesse
create or replace function fn_protezione_comande() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if not is_admin() then
        if tg_op = 'INSERT' then
            new.stato := 'in_attesa_conferma';
            new.data_consegna_indicativa := null;
            new.confermata_da := null;
            new.confermata_il := null;
            new.creata_da := auth.uid();
        else
            new.data_consegna_indicativa := old.data_consegna_indicativa;
            new.confermata_da := old.confermata_da;
            new.confermata_il := old.confermata_il;
            new.creata_da := old.creata_da;
        end if;
    end if;
    if tg_op = 'UPDATE' and new.stato <> old.stato and not (
           (old.stato = 'in_attesa_conferma' and new.stato in ('confermata', 'in_produzione', 'annullata'))
        or (old.stato = 'confermata'         and new.stato in ('in_produzione', 'parzialmente_evasa', 'evasa', 'annullata'))
        or (old.stato = 'in_produzione'      and new.stato in ('confermata', 'parzialmente_evasa', 'evasa', 'annullata'))
        or (old.stato = 'parzialmente_evasa' and new.stato = 'evasa')) then
        raise exception 'Passaggio di stato non ammesso: da % a %', old.stato, new.stato;
    end if;
    return new;
end $$;
create trigger trg_protezione_comande before insert or update on comande
    for each row execute function fn_protezione_comande();

create or replace function fn_prezzo_riga_comanda() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if tg_op = 'UPDATE' and not is_admin() then
        new.quantita_evasa := old.quantita_evasa;
        if new.variante_id = old.variante_id then
            new.prezzo_unitario_applicato := old.prezzo_unitario_applicato;
            return new;
        end if;
    end if;
    if tg_op = 'INSERT' and not is_admin() then
        new.quantita_evasa := 0;
    end if;
    if new.prezzo_unitario_applicato is null or not is_admin() then
        select prezzo into new.prezzo_unitario_applicato
          from prezzi_storico where variante_id = new.variante_id and valido_al is null;
    end if;
    return new;
end $$;
create trigger trg_prezzo_riga_comanda before insert or update on comanda_righe
    for each row execute function fn_prezzo_riga_comanda();


-- ============================================================================
-- 12. FUNZIONI OPERATIVE (rpc)
-- ============================================================================

-- 12.1 Nuovo ordine in un'unica chiamata (staff e admin)
-- p_cliente: id esistente, oppure NULL con p_nuovo_cliente = {"nome":"..","cognome":"..","telefono":".."}
-- p_righe  : [{"variante_id": 2, "quantita": 3}, ...]
create or replace function crea_comanda(p_cliente bigint, p_nuovo_cliente jsonb, p_righe jsonb, p_note text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_cliente bigint := p_cliente; v_comanda bigint; r record;
begin
    if not is_utente_attivo() then raise exception 'Utente non attivo'; end if;
    if jsonb_array_length(coalesce(p_righe, '[]')) = 0 then raise exception 'Aggiungi almeno un prodotto'; end if;
    if v_cliente is null then
        if coalesce(trim(p_nuovo_cliente->>'nome'), '') = '' then raise exception 'Indica il nome del cliente'; end if;
        insert into clienti (nome, cognome, telefono)
        values (trim(p_nuovo_cliente->>'nome'), coalesce(trim(p_nuovo_cliente->>'cognome'), ''),
                nullif(trim(p_nuovo_cliente->>'telefono'), ''))
        returning id into v_cliente;
    elsif not exists (select 1 from clienti where id = v_cliente and not archiviato) then
        raise exception 'Cliente non trovato';
    end if;
    insert into comande (cliente_id, note) values (v_cliente, p_note) returning id into v_comanda;
    for r in select (e->>'variante_id')::int as variante_id, (e->>'quantita')::int as qta
               from jsonb_array_elements(p_righe) e loop
        if not exists (select 1 from varianti_prodotto where id = r.variante_id and attivo) then
            raise exception 'Prodotto non disponibile a catalogo';
        end if;
        insert into comanda_righe (comanda_id, variante_id, quantita_ordinata) values (v_comanda, r.variante_id, r.qta);
    end loop;
    return v_comanda;
end $$;

-- 12.2 Conferma (solo admin): data indicativa obbligatoria
create or replace function conferma_comanda(p_comanda bigint, p_stato stato_comanda, p_data date)
returns void language plpgsql security definer set search_path = public as $$
begin
    if not is_admin() then raise exception 'Solo l''amministratore può confermare le comande'; end if;
    if p_stato not in ('confermata', 'in_produzione') then
        raise exception 'Stato non valido: usa confermata oppure in_produzione';
    end if;
    if p_data is null then raise exception 'Inserisci la data di consegna indicativa'; end if;
    update comande
       set stato = p_stato, data_consegna_indicativa = p_data,
           confermata_da = auth.uid(), confermata_il = coalesce(confermata_il, now())
     where id = p_comanda and stato in ('in_attesa_conferma', 'confermata', 'in_produzione');
    if not found then raise exception 'La comanda % non è confermabile nel suo stato attuale', p_comanda; end if;
end $$;

-- 12.3 Consegna: evaso, scarico magazzino, stato comanda
create or replace function fn_registra_consegna_riga() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_variante int; v_comanda bigint; v_stato stato_comanda;
begin
    select cr.variante_id, cr.comanda_id, c.stato into v_variante, v_comanda, v_stato
      from comanda_righe cr join comande c on c.id = cr.comanda_id
     where cr.id = new.comanda_riga_id;
    if v_stato not in ('confermata', 'in_produzione', 'parzialmente_evasa') then
        raise exception 'La comanda % deve essere confermata prima della consegna (stato: %)', v_comanda, v_stato;
    end if;
    update comanda_righe set quantita_evasa = quantita_evasa + new.quantita where id = new.comanda_riga_id;
    insert into movimenti_prodotto (variante_id, tipo, quantita, consegna_riga_id)
    values (v_variante, 'scarico_consegna', -new.quantita, new.id);
    update comande set stato = case
        when exists (select 1 from comanda_righe where comanda_id = v_comanda and quantita_evasa < quantita_ordinata)
        then 'parzialmente_evasa'::stato_comanda else 'evasa'::stato_comanda end
     where id = v_comanda and stato <> case
        when exists (select 1 from comanda_righe where comanda_id = v_comanda and quantita_evasa < quantita_ordinata)
        then 'parzialmente_evasa'::stato_comanda else 'evasa'::stato_comanda end;
    return new;
end $$;
create trigger trg_registra_consegna_riga after insert on consegna_righe
    for each row execute function fn_registra_consegna_riga();

-- p_righe = [{"comanda_riga_id": 1, "quantita": 20}, ...]
create or replace function registra_consegna(p_comanda bigint, p_righe jsonb, p_note text default null,
                                             p_data timestamptz default now())
returns bigint language plpgsql security definer set search_path = public as $$
declare v_consegna bigint; r record;
begin
    if not is_admin() then raise exception 'Solo l''amministratore registra le consegne'; end if;
    insert into consegne (comanda_id, note, data_consegna) values (p_comanda, p_note, p_data) returning id into v_consegna;
    for r in select (e->>'comanda_riga_id')::bigint as riga, (e->>'quantita')::int as qta
               from jsonb_array_elements(p_righe) e loop
        if coalesce(r.qta, 0) <= 0 then continue; end if;
        if not exists (select 1 from comanda_righe where id = r.riga and comanda_id = p_comanda) then
            raise exception 'La riga % non appartiene alla comanda %', r.riga, p_comanda;
        end if;
        insert into consegna_righe (consegna_id, comanda_riga_id, quantita) values (v_consegna, r.riga, r.qta);
    end loop;
    return v_consegna;
end $$;

-- 12.4 Mercato: prelievo all'inserimento della riga, rientro alla chiusura
create or replace function fn_prelievo_mercato() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if (select stato from sessioni_mercato where id = new.sessione_id) <> 'aperta' then
        raise exception 'La sessione di mercato è già chiusa';
    end if;
    select prezzo into new.prezzo_unitario_applicato
      from prezzi_storico where variante_id = new.variante_id and valido_al is null;
    insert into movimenti_prodotto (variante_id, tipo, quantita, sessione_mercato_id)
    values (new.variante_id, 'prelievo_mercato', -new.quantita_prelevata, new.sessione_id);
    return new;
end $$;
create trigger trg_prelievo_mercato before insert on sessione_mercato_righe
    for each row execute function fn_prelievo_mercato();

-- p_rese = [{"variante_id": 1, "quantita_resa": 5}, ...] — il residuo di OGNI prodotto portato (anche 0)
create or replace function chiudi_sessione_mercato(p_sessione bigint, p_rese jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
    if not is_admin() then raise exception 'Solo l''amministratore gestisce il mercato'; end if;
    if (select stato from sessioni_mercato where id = p_sessione) is distinct from 'aperta' then
        raise exception 'Sessione inesistente o già chiusa';
    end if;
    for r in select (e->>'variante_id')::int as variante_id, (e->>'quantita_resa')::int as resa
               from jsonb_array_elements(p_rese) e loop
        update sessione_mercato_righe set quantita_resa = r.resa
         where sessione_id = p_sessione and variante_id = r.variante_id;
        if not found then raise exception 'Il prodotto % non era stato prelevato per questo mercato', r.variante_id; end if;
    end loop;
    if exists (select 1 from sessione_mercato_righe where sessione_id = p_sessione and quantita_resa is null) then
        raise exception 'Inserisci il residuo di tutti i prodotti portati al mercato (anche 0)';
    end if;
    insert into movimenti_prodotto (variante_id, tipo, quantita, sessione_mercato_id)
    select variante_id, 'reso_mercato', quantita_resa, p_sessione
      from sessione_mercato_righe where sessione_id = p_sessione and quantita_resa > 0;
    update sessioni_mercato set stato = 'chiusa', chiusa_il = now() where id = p_sessione;
end $$;

-- 12.5 Acquisto come scontrino, in un'unica chiamata
-- p_fornitore: id, oppure NULL con p_nuovo_fornitore = 'Nome' (creato al volo), oppure entrambi NULL
-- p_righe: [{ "articolo_id": 3 | "nuovo_articolo": {"nome":"..","categoria":"ali","unita":"kg"},
--             "quantita": 2, "confezione_id": 5 (facoltativa: quantita in confezioni),
--             "totale": 36.00,
--             "mezzo_id": 1, "contachilometri": 216600,                 (solo carburante, facoltativi)
--             "cespite": {"nome":"Arnie Dadant","categoria_id":1,"vita_utile":10,"contributo":200,"quantita":4}
--           }, ...]
create or replace function registra_acquisto(p_data date, p_fornitore int, p_nuovo_fornitore text,
                                             p_righe jsonb, p_note text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_forn int := p_fornitore; v_acq bigint; v_art int; v_qta numeric; v_riga bigint; e jsonb; c jsonb; v_cat int;
begin
    if not is_admin() then raise exception 'Solo l''amministratore registra gli acquisti'; end if;
    if jsonb_array_length(coalesce(p_righe, '[]')) = 0 then raise exception 'Aggiungi almeno una voce'; end if;
    if v_forn is null and coalesce(trim(p_nuovo_fornitore), '') <> '' then
        select id into v_forn from fornitori where lower(trim(nome)) = lower(trim(p_nuovo_fornitore));
        if v_forn is null then
            insert into fornitori (nome) values (trim(p_nuovo_fornitore)) returning id into v_forn;
        end if;
    end if;
    insert into acquisti (data, fornitore_id, note) values (coalesce(p_data, current_date), v_forn, p_note)
    returning id into v_acq;

    for e in select * from jsonb_array_elements(p_righe) loop
        v_art := (e->>'articolo_id')::int;
        if v_art is null then
            c := e->'nuovo_articolo';
            if coalesce(trim(c->>'nome'), '') = '' then raise exception 'Indica l''articolo'; end if;
            select id into v_art from articoli where lower(trim(nome)) = lower(trim(c->>'nome'));
            if v_art is null then
                select id into v_cat from categorie_articolo where codice = coalesce(c->>'categoria', 'altro');
                if v_cat is null then raise exception 'Categoria articolo sconosciuta: %', c->>'categoria'; end if;
                insert into articoli (nome, categoria_id, magazzino, unita)
                values (trim(c->>'nome'), v_cat,
                        coalesce((c->>'magazzino')::magazzino_articolo,
                                 (select magazzino_default from categorie_articolo where id = v_cat)),
                        coalesce((c->>'unita')::unita_misura, 'pz'))
                returning id into v_art;
            end if;
        end if;
        v_qta := (e->>'quantita')::numeric;
        if e ? 'confezione_id' and e->>'confezione_id' is not null then
            select v_qta * quantita into v_qta from articoli_confezioni
             where id = (e->>'confezione_id')::int and articolo_id = v_art;
            if v_qta is null then raise exception 'Confezione non valida per questo articolo'; end if;
        end if;
        insert into acquisto_righe (acquisto_id, articolo_id, quantita, totale, mezzo_id, contachilometri)
        values (v_acq, v_art, v_qta, (e->>'totale')::numeric,
                (e->>'mezzo_id')::int, (e->>'contachilometri')::int)
        returning id into v_riga;

        c := e->'cespite';
        if c is not null and jsonb_typeof(c) = 'object' then
            insert into cespiti (nome, categoria_id, quantita, anno_acquisto, prezzo, contributo, vita_utile, acquisto_riga_id)
            select coalesce(c->>'nome', (select nome from articoli where id = v_art)),
                   cc.id, coalesce((c->>'quantita')::int, greatest(v_qta::int, 1)),
                   extract(year from coalesce(p_data, current_date))::int,
                   (e->>'totale')::numeric, coalesce((c->>'contributo')::numeric, 0),
                   coalesce((c->>'vita_utile')::int, cc.vita_utile_default), v_riga
              from categorie_cespite cc where cc.id = (c->>'categoria_id')::int;
            if not found then raise exception 'Categoria attrezzatura non valida'; end if;
        end if;
    end loop;
    return v_acq;
end $$;

-- Ogni riga d'acquisto di un articolo a magazzino genera il carico; le correzioni generano la differenza
create or replace function fn_mov_acquisto() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_delta numeric; v_mag magazzino_articolo;
begin
    if tg_op in ('UPDATE', 'DELETE') then
        select magazzino into v_mag from articoli where id = old.articolo_id;
        if v_mag is not null then
            insert into movimenti_articoli (articolo_id, tipo, quantita, acquisto_riga_rif, note)
            values (old.articolo_id, 'acquisto', -old.quantita, old.id, 'Correzione acquisto');
        end if;
    end if;
    if tg_op in ('INSERT', 'UPDATE') then
        select magazzino into v_mag from articoli where id = new.articolo_id;
        if v_mag is not null then
            insert into movimenti_articoli (articolo_id, tipo, quantita, acquisto_riga_rif, note)
            values (new.articolo_id, 'acquisto', new.quantita, new.id,
                    case when tg_op = 'UPDATE' then 'Correzione acquisto' end);
        end if;
    end if;
    return coalesce(new, old);
end $$;
create trigger trg_mov_acquisto after insert or delete on acquisto_righe
    for each row execute function fn_mov_acquisto();
create trigger trg_mov_acquisto_upd after update of articolo_id, quantita on acquisto_righe
    for each row when (old.articolo_id is distinct from new.articolo_id or old.quantita is distinct from new.quantita)
    execute function fn_mov_acquisto();

-- 12.6 Attività di stagione: scala il magazzino materie apistiche
-- p_quantita in unità base, oppure in confezioni passando p_confezione
-- p_postazioni NULL o vuoto = tutte le postazioni
create or replace function registra_attivita(p_tipo tipo_attivita, p_data date, p_articolo int, p_quantita numeric,
                                             p_minuti int default null, p_note text default null,
                                             p_postazioni int[] default null, p_confezione int default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_qta numeric := p_quantita;
begin
    if not is_admin() then raise exception 'Operazione riservata all''amministratore'; end if;
    if p_confezione is not null then
        select p_quantita * quantita into v_qta from articoli_confezioni where id = p_confezione and articolo_id = p_articolo;
        if v_qta is null then raise exception 'Confezione non valida per questo articolo'; end if;
    end if;
    if (select magazzino from articoli where id = p_articolo) is distinct from 'apistiche' then
        raise exception 'L''articolo non è nel magazzino materie apistiche';
    end if;
    insert into attivita_stagione (tipo, data, articolo_id, quantita, minuti, note)
    values (p_tipo, coalesce(p_data, current_date), p_articolo, v_qta, p_minuti, p_note) returning id into v_id;
    insert into attivita_postazioni (attivita_id, postazione_id)
    select v_id, unnest(p_postazioni) where p_postazioni is not null;
    insert into movimenti_articoli (articolo_id, tipo, quantita, attivita_id)
    values (p_articolo, 'attivita', -v_qta, v_id);
    return v_id;
end $$;

-- 12.7 Lotti: codice SIGLA-ANNO-NN generato
create or replace function fn_codice_lotto() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    perform pg_advisory_xact_lock(hashtext('lotto'), new.tipo_miele_id * 10000 + new.anno);
    if new.progressivo is null then
        select coalesce(max(progressivo), 0) + 1 into new.progressivo
          from lotti where tipo_miele_id = new.tipo_miele_id and anno = new.anno;
    end if;
    select sigla || '-' || new.anno || '-' || lpad(new.progressivo::text, 2, '0') into new.codice
      from tipi_miele where id = new.tipo_miele_id;
    return new;
end $$;
create trigger trg_codice_lotto before insert on lotti
    for each row execute function fn_codice_lotto();

create or replace function nuovo_lotto(p_tipo_miele int, p_anno int default null, p_note text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
    if not is_admin() then raise exception 'Solo l''amministratore gestisce la produzione'; end if;
    insert into lotti (tipo_miele_id, anno, note)
    values (p_tipo_miele, coalesce(p_anno, extract(year from now())::int), p_note) returning id into v;
    return v;
end $$;

-- Smielatura: i kg dei bariloni entrano nel miele sfuso del lotto (anche quando si correggono)
create or replace function fn_mov_bariloni() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_lotto bigint; v_delta numeric;
begin
    select lotto_id into v_lotto from lotto_eventi where id = coalesce(new.evento_id, old.evento_id);
    v_delta := coalesce(new.kg, 0) - coalesce(old.kg, 0);
    if v_delta <> 0 then
        insert into movimenti_miele (lotto_id, tipo, kg, evento_id, note)
        values (v_lotto, 'smielatura', v_delta, coalesce(new.evento_id, old.evento_id),
                case when tg_op <> 'INSERT' then 'Correzione pesata' end);
    end if;
    return coalesce(new, old);
end $$;
create trigger trg_mov_bariloni after insert or update or delete on smielatura_bariloni
    for each row execute function fn_mov_bariloni();

-- Spostamento o smielatura (il confezionamento ha la sua funzione)
-- p_bariloni: kg di ogni barilone, solo per la smielatura
create or replace function registra_evento_lotto(p_lotto bigint, p_tipo tipo_evento_lotto, p_data timestamptz default now(),
                                                 p_postazione int default null, p_mezzo int default null,
                                                 p_km numeric default null, p_minuti int default null,
                                                 p_arnie int default null, p_costo_terzi numeric default null,
                                                 p_note text default null, p_bariloni numeric[] default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_km numeric := p_km;
begin
    if not is_admin() then raise exception 'Solo l''amministratore gestisce la produzione'; end if;
    if p_tipo not in ('spostamento', 'smielatura') then
        raise exception 'Per confezionamento e chiusura usa confeziona() e chiudi_lotto()';
    end if;
    if (select stato from lotti where id = p_lotto) is distinct from 'aperto' then
        raise exception 'Il lotto è chiuso o inesistente';
    end if;
    if p_tipo = 'smielatura' and coalesce(array_length(p_bariloni, 1), 0) = 0 then
        raise exception 'Inserisci il peso di almeno un barilone';
    end if;
    if p_tipo = 'spostamento' and v_km is null then
        select km_abituali into v_km from postazioni where id = p_postazione;   -- proposta della postazione
    end if;
    insert into lotto_eventi (lotto_id, tipo, data, postazione_id, mezzo_id, km, minuti, arnie, costo_terzi, note)
    values (p_lotto, p_tipo, coalesce(p_data, now()), p_postazione, p_mezzo, v_km, p_minuti, p_arnie, p_costo_terzi, p_note)
    returning id into v_id;
    if p_tipo = 'smielatura' then
        insert into smielatura_bariloni (evento_id, kg) select v_id, unnest(p_bariloni);
    end if;
    return v_id;
end $$;

-- Scarico comune a confezionamento e uso personale: prodotti, materiali da distinta, miele sfuso
create or replace function _scarica_vasetti(p_lotto bigint, p_evento bigint, p_righe jsonb, p_personale boolean)
returns numeric language plpgsql security definer set search_path = public as $$
declare r record; v_tipo int; v_kg numeric := 0; v_peso numeric;
begin
    select tipo_miele_id into v_tipo from lotti where id = p_lotto;
    -- prima il miele: se non basta è il messaggio più utile
    select coalesce(sum(v.peso_kg * (e->>'pezzi')::int), 0) into v_kg
      from jsonb_array_elements(coalesce(p_righe, '[]')) e join varianti_prodotto v on v.id = (e->>'variante_id')::int
     where (e->>'pezzi')::int > 0;
    if v_kg > 0 then
        insert into movimenti_miele (lotto_id, tipo, kg, evento_id)
        values (p_lotto, case when p_personale then 'uso_personale'::tipo_mov_miele else 'confezionamento'::tipo_mov_miele end,
                -v_kg, p_evento);
    end if;
    for r in select (e->>'variante_id')::int as variante_id, (e->>'pezzi')::int as pezzi
               from jsonb_array_elements(coalesce(p_righe, '[]')) e loop
        if coalesce(r.pezzi, 0) <= 0 then continue; end if;
        select v.peso_kg into v_peso from varianti_prodotto v join prodotti p on p.id = v.prodotto_id
         where v.id = r.variante_id and p.tipo_miele_id = v_tipo and v.peso_kg > 0;
        if v_peso is null then raise exception 'Il formato % non è un vasetto di questo miele', r.variante_id; end if;
        insert into confezionamento_righe (evento_id, variante_id, pezzi, uso_personale)
        values (p_evento, r.variante_id, r.pezzi, p_personale);
        if not p_personale then
            insert into movimenti_prodotto (variante_id, tipo, quantita, lotto_id)
            values (r.variante_id, 'carico_produzione', r.pezzi, p_lotto);
        end if;
        insert into movimenti_articoli (articolo_id, tipo, quantita, lotto_id)
        select d.articolo_id, case when p_personale then 'uso_personale'::tipo_mov_articolo
                                   else 'confezionamento'::tipo_mov_articolo end,
               -(d.quantita * r.pezzi), p_lotto
          from distinta_base d where d.variante_id = r.variante_id;
    end loop;
    return v_kg;
end $$;
revoke execute on function _scarica_vasetti(bigint, bigint, jsonb, boolean) from public;

-- p_righe = [{"variante_id": 2, "pezzi": 160}, ...]
-- Rifiuta tutto se il miele del lotto o un materiale non bastano (messaggio con cosa manca)
create or replace function confeziona(p_lotto bigint, p_righe jsonb, p_data timestamptz default now(),
                                      p_minuti int default null, p_mezzo int default null, p_km numeric default null,
                                      p_costo_terzi numeric default null, p_note text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_ev bigint; v_kg numeric;
begin
    if not is_admin() then raise exception 'Solo l''amministratore gestisce la produzione'; end if;
    if (select stato from lotti where id = p_lotto) is distinct from 'aperto' then
        raise exception 'Il lotto è chiuso o inesistente';
    end if;
    insert into lotto_eventi (lotto_id, tipo, data, mezzo_id, km, minuti, costo_terzi, note)
    values (p_lotto, 'confezionamento', coalesce(p_data, now()), p_mezzo, p_km, p_minuti, p_costo_terzi, p_note)
    returning id into v_ev;
    v_kg := _scarica_vasetti(p_lotto, v_ev, p_righe, false);
    if v_kg = 0 then raise exception 'Indica quanti vasetti hai riempito'; end if;
    return v_ev;
end $$;


-- ============================================================================
-- 13. CALCOLATORE DEI COSTI
--     Formule (spec v03.1, sezione "Il costo di un vasetto"):
--       costo medio articolo  = Σ totali pagati ÷ Σ quantità acquistate
--       costo confezione      = Σ distinta × costo medio
--       kg di riferimento     = media dei kg smielati negli ultimi ≤3 anni con raccolto
--       quota stagione al kg  = (consumi attività + altre spese senza magazzino
--                                + mezzi [spese "mezzi" + carburante non attribuito ai lotti]
--                                + costo d'uso attrezzatura) ÷ kg di riferimento
--       viaggio               = dedicato: km × costo al km dell'anno
--                               personale: km × tariffa · terzi: costo scritto
--       costo al kg del lotto = (quota × kg smielati + viaggi + ore × valore ora
--                                + confezioni dei vasetti personali) ÷ kg vendibili
--       kg vendibili          = kg smielati − calo − kg uso personale (prima della chiusura: kg smielati)
-- ============================================================================
create or replace function costo_medio(p_articolo int) returns numeric
language sql stable set search_path = public as $$
    select sum(totale) / nullif(sum(quantita), 0) from acquisto_righe where articolo_id = p_articolo;
$$;

create or replace function costo_confezione(p_variante int) returns numeric
language sql stable set search_path = public as $$
    select coalesce(sum(d.quantita * coalesce(costo_medio(d.articolo_id), 0)), 0)
      from distinta_base d where d.variante_id = p_variante;
$$;

create or replace function kg_smielati(p_lotto bigint) returns numeric
language sql stable set search_path = public as $$
    select coalesce(sum(b.kg), 0) from smielatura_bariloni b join lotto_eventi e on e.id = b.evento_id
     where e.lotto_id = p_lotto;
$$;

create or replace function kg_anno(p_anno int) returns numeric
language sql stable set search_path = public as $$
    select coalesce(sum(b.kg), 0) from smielatura_bariloni b
      join lotto_eventi e on e.id = b.evento_id join lotti l on l.id = e.lotto_id
     where l.anno = p_anno;
$$;

create or replace function kg_riferimento(p_anno int) returns numeric
language sql stable set search_path = public as $$
    select coalesce(avg(k), 0) from (select kg_anno(y) as k from generate_series(p_anno - 2, p_anno) y) x where k > 0;
$$;

-- Righe di carburante dell'anno attribuite a un mezzo (senza mezzo = il primo mezzo dedicato)
create or replace function _righe_carburante(p_anno int, p_mezzo int)
returns setof acquisto_righe language sql stable set search_path = public as $$
    select r.* from acquisto_righe r
      join acquisti a on a.id = r.acquisto_id
      join articoli ar on ar.id = r.articolo_id
      join categorie_articolo c on c.id = ar.categoria_id
     where c.codice = 'carb' and extract(year from a.data) = p_anno
       and coalesce(r.mezzo_id, (select min(id) from mezzi where tipo = 'dedicato')) = p_mezzo;
$$;

create or replace function km_lotti(p_anno int, p_mezzo int) returns numeric
language sql stable set search_path = public as $$
    select coalesce(sum(e.km), 0) from lotto_eventi e join lotti l on l.id = e.lotto_id
     where l.anno = p_anno and e.mezzo_id = p_mezzo;
$$;

create or replace function costo_km(p_anno int, p_mezzo int) returns numeric
language sql stable set search_path = public as $$
    with c as (select coalesce(sum(totale), 0) as fuel,
                      case when count(contachilometri) >= 2 then max(contachilometri) - min(contachilometri) else 0 end as km_odo
                 from _righe_carburante(p_anno, p_mezzo))
    select case when km_odo > 0 then fuel / km_odo
                when km_lotti(p_anno, p_mezzo) > 0 then fuel / km_lotti(p_anno, p_mezzo)
                else 0 end
      from c;
$$;

create or replace function costo_viaggio(p_evento bigint) returns numeric
language sql stable set search_path = public as $$
    select coalesce(case m.tipo
               when 'dedicato'  then coalesce(e.km, 0) * costo_km(l.anno, m.id)
               when 'personale' then coalesce(e.km, 0) * coalesce(m.tariffa_km, 0)
               when 'terzi'     then coalesce(e.costo_terzi, 0) end, 0)
      from lotto_eventi e join lotti l on l.id = e.lotto_id left join mezzi m on m.id = e.mezzo_id
     where e.id = p_evento;
$$;

create or replace function uso_cespiti(p_anno int) returns numeric
language sql stable set search_path = public as $$
    select coalesce(sum((c.prezzo - case when i.costo_netto then c.contributo else 0 end) / c.vita_utile), 0)
      from cespiti c cross join impostazioni i
     where c.anno_acquisto <= p_anno
       and (c.stato = 'in_uso' or extract(year from c.data_dismissione) >= p_anno);
$$;

create or replace function quota_stagione(p_anno int)
returns table (consumi numeric, altre_spese numeric, mezzi numeric, attrezzatura numeric,
               totale numeric, kg_riferimento numeric, per_kg numeric)
language sql stable set search_path = public as $$
    with righe as (
        select r.*, c.codice as cat, ar.magazzino,
               exists (select 1 from cespiti ce where ce.acquisto_riga_id = r.id) as is_cespite
          from acquisto_righe r join acquisti a on a.id = r.acquisto_id
          join articoli ar on ar.id = r.articolo_id join categorie_articolo c on c.id = ar.categoria_id
         where extract(year from a.data) = p_anno
    ), v as (
        select
          (select coalesce(sum(s.quantita * coalesce(costo_medio(s.articolo_id), 0)), 0)
             from attivita_stagione s where extract(year from s.data) = p_anno) as consumi,
          (select coalesce(sum(totale), 0) from righe
            where magazzino is null and cat not in ('carb', 'mezzi') and not is_cespite) as altre,
          (select coalesce(sum(totale), 0) from righe where cat = 'mezzi')
          + (select coalesce(sum(greatest(0,
                    (select coalesce(sum(totale), 0) from _righe_carburante(p_anno, m.id))
                    - km_lotti(p_anno, m.id) * costo_km(p_anno, m.id))), 0)
               from mezzi m where m.tipo = 'dedicato') as mezzi,
          uso_cespiti(p_anno) as ces,
          kg_riferimento(p_anno) as kr
    )
    select consumi, altre, mezzi, ces, consumi + altre + mezzi + ces, kr,
           case when kr > 0 then (consumi + altre + mezzi + ces) / kr else 0 end
      from v;
$$;

-- Costo del lotto calcolato ADESSO (non congelato)
create or replace function calcola_costo_lotto(p_lotto bigint) returns jsonb
language plpgsql stable set search_path = public as $$
declare l lotti%rowtype; q record; v_kg numeric; v_viaggi numeric; v_ore numeric; v_min numeric;
        v_pers numeric; v_vend numeric; v_stag numeric; v_tot numeric;
begin
    select * into l from lotti where id = p_lotto;
    if not found then return null; end if;
    select * into q from quota_stagione(l.anno);
    v_kg := kg_smielati(p_lotto);
    select coalesce(sum(costo_viaggio(e.id)), 0), coalesce(sum(e.minuti), 0)
      into v_viaggi, v_min from lotto_eventi e where e.lotto_id = p_lotto;
    v_ore := v_min / 60.0 * (select valore_ora from impostazioni);
    select coalesce(sum(r.pezzi * costo_confezione(r.variante_id)), 0) into v_pers
      from confezionamento_righe r join lotto_eventi e on e.id = r.evento_id
     where e.lotto_id = p_lotto and r.uso_personale;
    v_stag := q.per_kg * v_kg;
    v_tot  := v_stag + v_viaggi + v_ore + v_pers;
    v_vend := case when l.stato = 'chiuso' then v_kg - coalesce(l.kg_calo, 0) - coalesce(l.kg_uso_personale, 0) else v_kg end;
    return jsonb_build_object(
        'kg_smielati', v_kg, 'kg_vendibili', v_vend, 'minuti', v_min,
        'quota_stagione', v_stag, 'viaggi', v_viaggi, 'ore', v_ore, 'confezioni_personali', v_pers,
        'totale', v_tot, 'costo_kg', case when v_vend > 0 then v_tot / v_vend else 0 end,
        'stima', l.stato = 'aperto',
        'stagione', jsonb_build_object('anno', l.anno, 'consumi', q.consumi, 'altre_spese', q.altre_spese,
                                       'mezzi', q.mezzi, 'attrezzatura', q.attrezzatura, 'totale', q.totale,
                                       'kg_riferimento', q.kg_riferimento, 'per_kg', q.per_kg));
end $$;

-- Scrive il costo congelato del lotto e dei suoi vasetti
create or replace function _congela_costo(p_lotto bigint) returns void
language plpgsql security definer set search_path = public as $$
declare c jsonb; v_tipo int;
begin
    c := calcola_costo_lotto(p_lotto);
    update lotti set costo_totale = round((c->>'totale')::numeric, 2),
                     kg_vendibili = (c->>'kg_vendibili')::numeric,
                     costo_kg = round((c->>'costo_kg')::numeric, 4),
                     costo_dettaglio = c, costo_calcolato_il = now()
     where id = p_lotto returning tipo_miele_id into v_tipo;
    delete from lotti_costo_vasetti where lotto_id = p_lotto;
    insert into lotti_costo_vasetti (lotto_id, variante_id, costo_confezione, costo_miele, costo_totale)
    select p_lotto, v.id, costo_confezione(v.id), v.peso_kg * (c->>'costo_kg')::numeric,
           costo_confezione(v.id) + v.peso_kg * (c->>'costo_kg')::numeric
      from varianti_prodotto v join prodotti p on p.id = v.prodotto_id
     where p.tipo_miele_id = v_tipo and v.peso_kg > 0 and v.attivo;
end $$;
revoke execute on function _congela_costo(bigint) from public;

-- 12.8 (segue) Chiusura del lotto
-- p_kg_rimasto: miele sfuso che resta davvero (pesato)
-- p_uso_personale: [{"variante_id": 2, "pezzi": 2}] vasetti tenuti per sé (anche non pieni)
create or replace function chiudi_lotto(p_lotto bigint, p_kg_rimasto numeric, p_uso_personale jsonb default '[]',
                                        p_data date default current_date, p_minuti int default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ev bigint; v_kg_pers numeric; v_teorico numeric; v_calo numeric;
begin
    if not is_admin() then raise exception 'Solo l''amministratore gestisce la produzione'; end if;
    if (select stato from lotti where id = p_lotto for update) is distinct from 'aperto' then
        raise exception 'Il lotto è già chiuso o inesistente';
    end if;
    if p_kg_rimasto is null or p_kg_rimasto < 0 then raise exception 'Indica quanti kg di miele restano (anche 0)'; end if;
    if kg_smielati(p_lotto) = 0 then raise exception 'Il lotto non ha ancora una smielatura'; end if;

    insert into lotto_eventi (lotto_id, tipo, data, minuti, note)
    values (p_lotto, 'chiusura', coalesce(p_data, current_date)::timestamptz + interval '12 hours', p_minuti, p_note)
    returning id into v_ev;
    v_kg_pers := _scarica_vasetti(p_lotto, v_ev, p_uso_personale, true);

    select coalesce(sum(kg), 0) into v_teorico from movimenti_miele where lotto_id = p_lotto;
    v_calo := round(v_teorico - p_kg_rimasto, 3);
    if v_calo <> 0 then
        insert into movimenti_miele (lotto_id, tipo, kg, evento_id, note)
        values (p_lotto, 'calo', -v_calo, v_ev, case when v_calo < 0 then 'Eccedenza rispetto al teorico' end);
    end if;

    update lotti set stato = 'chiuso', ricordami_chiusura = false, data_chiusura = coalesce(p_data, current_date),
                     kg_rimasto = p_kg_rimasto, kg_calo = v_calo, kg_uso_personale = v_kg_pers
     where id = p_lotto;
    perform _congela_costo(p_lotto);
    return jsonb_build_object('kg_teorico', v_teorico, 'kg_rimasto', p_kg_rimasto, 'kg_calo', v_calo,
                              'kg_uso_personale', v_kg_pers, 'costo_kg', (select costo_kg from lotti where id = p_lotto));
end $$;

create or replace function ricalcola_lotto(p_lotto bigint) returns numeric
language plpgsql security definer set search_path = public as $$
begin
    if not is_admin() then raise exception 'Operazione riservata all''amministratore'; end if;
    if (select stato from lotti where id = p_lotto) is distinct from 'chiuso' then
        raise exception 'Si ricalcolano solo i lotti chiusi (quelli aperti sono sempre aggiornati)';
    end if;
    perform _congela_costo(p_lotto);
    return (select costo_kg from lotti where id = p_lotto);
end $$;

create or replace function ricalcola_tutti_lotti() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; l record;
begin
    if not is_admin() then raise exception 'Operazione riservata all''amministratore'; end if;
    for l in select id from lotti where stato = 'chiuso' loop
        perform _congela_costo(l.id); n := n + 1;
    end loop;
    return n;
end $$;


-- ============================================================================
-- 14. RETTIFICHE E CARICHI INIZIALI (motivo obbligatorio, "Altro" entra nella lista)
-- ============================================================================
create or replace function rettifica_prodotto(p_variante int, p_quantita int, p_motivo text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
    if not is_admin() then raise exception 'Operazione riservata all''amministratore'; end if;
    insert into movimenti_prodotto (variante_id, tipo, quantita, motivo_id, note)
    values (p_variante, 'rettifica', p_quantita, motivo_id('prodotti', p_motivo), p_note);
end $$;

create or replace function rettifica_articolo(p_articolo int, p_quantita numeric, p_motivo text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
    if not is_admin() then raise exception 'Operazione riservata all''amministratore'; end if;
    if (select magazzino from articoli where id = p_articolo) is null then
        raise exception 'L''articolo non è tenuto a magazzino';
    end if;
    insert into movimenti_articoli (articolo_id, tipo, quantita, motivo_id, note)
    values (p_articolo, 'rettifica', p_quantita, motivo_id('articoli', p_motivo), p_note);
end $$;

create or replace function rettifica_miele(p_lotto bigint, p_kg numeric, p_motivo text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
    if not is_admin() then raise exception 'Operazione riservata all''amministratore'; end if;
    insert into movimenti_miele (lotto_id, tipo, kg, motivo_id, note)
    values (p_lotto, 'rettifica', p_kg, motivo_id('miele', p_motivo), p_note);
end $$;

-- Prodotti finiti già pronti all'avvio. (Materiali e materie apistiche iniziali:
-- si registrano come un acquisto "Inventario iniziale" con un valore indicativo, così hanno un costo.)
create or replace function carico_iniziale_prodotto(p_variante int, p_quantita int)
returns void language plpgsql security definer set search_path = public as $$
begin
    if not is_admin() then raise exception 'Operazione riservata all''amministratore'; end if;
    insert into movimenti_prodotto (variante_id, tipo, quantita, note)
    values (p_variante, 'carico_iniziale', p_quantita, 'Inventario iniziale');
end $$;


-- ============================================================================
-- 15. NOTIFICHE AUTOMATICHE E AUDIT
-- ============================================================================
create or replace function fn_notifica_nuova_comanda() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if not is_admin() then
        insert into notifiche (categoria, titolo, messaggio, tabella_rif, record_rif, generata_da)
        select 'ordini', 'Nuovo ordine da confermare',
               format('%s %s — inserito da %s', cl.nome, cl.cognome, p.username),
               'comande', new.id::text, auth.uid()
          from clienti cl left join profili p on p.id = auth.uid()
         where cl.id = new.cliente_id;
    end if;
    return new;
end $$;
create trigger trg_notifica_nuova_comanda after insert on comande
    for each row execute function fn_notifica_nuova_comanda();

create or replace function fn_notifica_modifica_staff() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_comanda bigint;
begin
    if not is_admin() and auth.uid() is not null then
        v_comanda := case when tg_table_name = 'comande' then new.id
                          else coalesce(new.comanda_id, old.comanda_id) end;
        if not exists (select 1 from notifiche where categoria = 'modifiche' and letta_il is null
                         and tabella_rif = 'comande' and record_rif = v_comanda::text) then
            insert into notifiche (categoria, titolo, messaggio, tabella_rif, record_rif, generata_da)
            select 'modifiche', 'Ordine modificato dallo staff',
                   format('Comanda n. %s modificata da %s', v_comanda, p.username),
                   'comande', v_comanda::text, auth.uid()
              from profili p where p.id = auth.uid();
        end if;
    end if;
    return coalesce(new, old);
end $$;
create trigger trg_notifica_modifica_comande after update on comande
    for each row execute function fn_notifica_modifica_staff();
create trigger trg_notifica_modifica_righe after update or delete on comanda_righe
    for each row execute function fn_notifica_modifica_staff();

-- Scorta minima di materiali e materie apistiche
create or replace function fn_notifica_soglia_articolo() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_giacenza numeric; a articoli%rowtype;
begin
    if new.quantita >= 0 then return new; end if;
    select * into a from articoli where id = new.articolo_id;
    if a.scorta_minima is null then return new; end if;
    select coalesce(sum(quantita), 0) into v_giacenza from movimenti_articoli where articolo_id = new.articolo_id;
    if v_giacenza < a.scorta_minima
       and not exists (select 1 from notifiche where categoria = 'stock' and letta_il is null
                         and tabella_rif = 'articoli' and record_rif = a.id::text) then
        insert into notifiche (categoria, titolo, messaggio, tabella_rif, record_rif, generata_da)
        values ('stock', 'Sotto la scorta minima: ' || coalesce(a.codice, a.nome),
                format('%s: restano %s %s, scorta minima %s %s', a.nome,
                       trim(to_char(v_giacenza, 'FM999999990.###')), a.unita,
                       trim(to_char(a.scorta_minima, 'FM999999990.###')), a.unita),
                'articoli', a.id::text, auth.uid());
    end if;
    return new;
end $$;
create trigger trg_notifica_soglia_articolo after insert on movimenti_articoli
    for each row execute function fn_notifica_soglia_articolo();

create or replace function fn_notifica_prezzo() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_precedente numeric; v_sku text;
begin
    if auth.uid() is null then return new; end if;
    select codice_articolo into v_sku from varianti_prodotto where id = new.variante_id;
    select prezzo into v_precedente from prezzi_storico
     where variante_id = new.variante_id and id <> new.id order by valido_dal desc, id desc limit 1;
    insert into notifiche (categoria, titolo, messaggio, tabella_rif, record_rif, generata_da)
    values ('prezzi', 'Prezzo aggiornato: ' || v_sku,
            format('Da %s a %s €', coalesce(v_precedente::text, 'X'), new.prezzo),
            'prezzi_storico', new.id::text, auth.uid());
    return new;
end $$;
create trigger trg_notifica_prezzo after insert on prezzi_storico
    for each row execute function fn_notifica_prezzo();

create or replace function segna_letta(p_notifica bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
    if not is_admin() then raise exception 'Operazione riservata all''amministratore'; end if;
    update notifiche set letta_il = now(), letta_da = auth.uid() where id = p_notifica and letta_il is null;
end $$;

create or replace function segna_tutte_lette(p_categoria categoria_notifica default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
    if not is_admin() then raise exception 'Operazione riservata all''amministratore'; end if;
    update notifiche set letta_il = now(), letta_da = auth.uid()
     where letta_il is null and (p_categoria is null or categoria = p_categoria);
    get diagnostics n = row_count;
    return n;
end $$;

create or replace function fn_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    insert into audit_log (tabella, record_id, azione, utente_id, prima, dopo)
    values (tg_table_name, coalesce(to_jsonb(new)->>'id', to_jsonb(old)->>'id'), tg_op, auth.uid(),
            case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
            case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end);
    return null;
end $$;

-- Audit sulle tabelle che si possono modificare (i registri append-only sono già il loro storico)
do $$
declare t text;
begin
    foreach t in array array['profili', 'impostazioni', 'clienti', 'fornitori', 'postazioni', 'mezzi',
                             'tipi_miele', 'prodotti', 'varianti_prodotto', 'distinta_base', 'prezzi_storico',
                             'articoli', 'articoli_confezioni', 'acquisti', 'acquisto_righe', 'cespiti',
                             'lotti', 'lotto_eventi', 'smielatura_bariloni', 'attivita_stagione',
                             'comande', 'comanda_righe', 'sessioni_mercato', 'sessione_mercato_righe'] loop
        execute format('create trigger trg_audit after insert or update or delete on %I
                        for each row execute function fn_audit()', t);
    end loop;
end $$;


-- ============================================================================
-- 16. SICUREZZA — ROW LEVEL SECURITY
--     Regola base: RLS attiva su TUTTE le tabelle; l'admin fa tutto;
--     lo staff solo ciò che è esplicitato sotto.
-- ============================================================================
do $$
declare t text;
begin
    for t in select tablename from pg_tables where schemaname = 'public' loop
        execute format('alter table %I enable row level security', t);
        execute format('create policy admin_tutto on %I for all to authenticated
                        using (is_admin()) with check (is_admin())', t);
    end loop;
end $$;

-- Registri e audit: l'admin legge e inserisce, ma niente update/delete (oltre al trigger)
do $$
declare t text;
begin
    foreach t in array array['movimenti_prodotto', 'movimenti_articoli', 'movimenti_miele',
                             'movimenti_pagamento', 'audit_log'] loop
        execute format('drop policy admin_tutto on %I', t);
        execute format('create policy admin_legge on %I for select to authenticated using (is_admin())', t);
        execute format('create policy admin_inserisce on %I for insert to authenticated with check (is_admin())', t);
    end loop;
end $$;
drop policy admin_inserisce on audit_log;   -- l'audit lo scrive solo il trigger

-- Staff: il proprio profilo
create policy staff_proprio_profilo on profili for select to authenticated using (id = auth.uid());

-- Staff: catalogo in sola lettura (i clienti li vede dalla vista ridotta v_clienti_staff)
create policy staff_legge on categorie_prodotto for select to authenticated using (is_utente_attivo());
create policy staff_legge on prodotti           for select to authenticated using (is_utente_attivo());
create policy staff_legge on varianti_prodotto  for select to authenticated using (is_utente_attivo());
create policy staff_legge on tipi_miele         for select to authenticated using (is_utente_attivo());

-- Staff: le PROPRIE comande; modificabili/annullabili finché in attesa di conferma
create policy staff_legge_proprie_comande on comande for select to authenticated
    using (is_utente_attivo() and creata_da = auth.uid());
create policy staff_modifica_comande on comande for update to authenticated
    using (is_utente_attivo() and creata_da = auth.uid() and stato = 'in_attesa_conferma')
    with check (creata_da = auth.uid() and stato in ('in_attesa_conferma', 'annullata'));

create policy staff_legge_righe on comanda_righe for select to authenticated
    using (exists (select 1 from comande c where c.id = comanda_id and c.creata_da = auth.uid()) and is_utente_attivo());
create policy staff_crea_righe on comanda_righe for insert to authenticated
    with check (exists (select 1 from comande c where c.id = comanda_id and c.creata_da = auth.uid()
                          and c.stato = 'in_attesa_conferma') and is_utente_attivo());
create policy staff_modifica_righe on comanda_righe for update to authenticated
    using (exists (select 1 from comande c where c.id = comanda_id and c.creata_da = auth.uid()
                     and c.stato = 'in_attesa_conferma') and is_utente_attivo());
create policy staff_elimina_righe on comanda_righe for delete to authenticated
    using (exists (select 1 from comande c where c.id = comanda_id and c.creata_da = auth.uid()
                     and c.stato = 'in_attesa_conferma') and is_utente_attivo());

-- Ognuno la propria Home e i propri grafici
create policy propria_home on preferenze_home for all to authenticated
    using (utente_id = auth.uid()) with check (utente_id = auth.uid());
create policy propri_grafici on grafici_utente for all to authenticated
    using (utente_id = auth.uid()) with check (utente_id = auth.uid());

-- Nessun accesso anonimo
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated;
revoke execute on function _scarica_vasetti(bigint, bigint, jsonb, boolean), _congela_costo(bigint) from authenticated;


-- ============================================================================
-- 17. VISTE
--     STAFF  (security definer, filtro esplicito): dati ridotti, senza costi
--     ADMIN  (security_invoker): valgono le RLS → per lo staff 0 righe
-- ============================================================================

-- STAFF · clienti ridotti per la ricerca nel nuovo ordine (niente telefono e note)
create view v_clienti_staff as
select id, nome, cognome from clienti where not archiviato and is_utente_attivo();

create view v_giacenza_prodotti as
select v.id as variante_id, v.codice_articolo, p.nome as prodotto, v.formato, v.peso_kg, p.tipo_miele_id,
       coalesce(sum(m.quantita), 0)::int as disponibile
  from varianti_prodotto v
  join prodotti p on p.id = v.prodotto_id
  left join movimenti_prodotto m on m.variante_id = v.id
 where v.attivo and is_utente_attivo()
 group by v.id, p.id;

-- STAFF · presa ordini: disponibilità, quanto è al mercato, prezzo
create view v_disponibilita_staff as
select g.variante_id, g.codice_articolo, g.prodotto, g.formato, g.disponibile,
       coalesce(mk.prelevata, 0)::int as prelevata_mercato,
       ps.prezzo as prezzo_corrente
  from v_giacenza_prodotti g
  left join prezzi_storico ps on ps.variante_id = g.variante_id and ps.valido_al is null
  left join (select r.variante_id, sum(r.quantita_prelevata) as prelevata
               from sessione_mercato_righe r join sessioni_mercato s on s.id = r.sessione_id
              where s.stato = 'aperta' group by r.variante_id) mk on mk.variante_id = g.variante_id;

-- STAFF + ADMIN · "i miei ordini" (staff: i suoi; admin: tutti)
create view v_mie_comande as
select c.id, c.creata_il, c.creata_da, cl.nome || ' ' || cl.cognome as cliente, c.stato,
       c.data_consegna_indicativa, c.note,
       string_agg(v.codice_articolo || ' ×' || cr.quantita_ordinata, ', ' order by v.codice_articolo) as articoli
  from comande c
  join clienti cl on cl.id = c.cliente_id
  left join comanda_righe cr on cr.comanda_id = c.id
  left join varianti_prodotto v on v.id = cr.variante_id
 where is_utente_attivo() and (c.creata_da = auth.uid() or is_admin())
 group by c.id, cl.nome, cl.cognome;

-- ADMIN · Quadro disponibilità
create view v_quadro_disponibilita with (security_invoker = true) as
with anno as (
    select cr.variante_id, sum(cr.quantita_ordinata) as ordinata, sum(cr.quantita_evasa) as evasa
      from comanda_righe cr join comande c on c.id = cr.comanda_id
     where c.stato <> 'annullata' and c.creata_il >= date_trunc('year', now())
     group by cr.variante_id
), aperte as (
    select cr.variante_id,
           sum(cr.quantita_ordinata - cr.quantita_evasa) as da_evadere,
           sum(cr.quantita_ordinata) filter (where c.stato = 'in_attesa_conferma') as di_cui_da_confermare
      from comanda_righe cr join comande c on c.id = cr.comanda_id
     where c.stato in ('in_attesa_conferma', 'confermata', 'in_produzione', 'parzialmente_evasa')
     group by cr.variante_id
)
select d.variante_id, d.codice_articolo, d.prodotto, d.formato, d.disponibile, d.prelevata_mercato,
       coalesce(a.ordinata, 0)::int              as ordinata,
       coalesce(a.evasa, 0)::int                 as evasa,
       coalesce(o.da_evadere, 0)::int            as da_evadere,
       coalesce(o.di_cui_da_confermare, 0)::int  as di_cui_da_confermare,
       greatest(coalesce(o.da_evadere, 0) - d.disponibile, 0)::int as da_produrre
  from v_disponibilita_staff d
  left join anno   a on a.variante_id = d.variante_id
  left join aperte o on o.variante_id = d.variante_id
 where is_admin();

-- ADMIN · Costo medio e giacenze di materiali e materie apistiche, con valore
create view v_giacenza_articoli with (security_invoker = true) as
select a.id as articolo_id, a.nome, a.codice, c.codice as categoria, c.nome as categoria_nome,
       a.magazzino, a.unita, a.scorta_minima, a.archiviato,
       coalesce(m.giacenza, 0) as giacenza,
       costo_medio(a.id) as costo_medio,
       round(coalesce(m.giacenza, 0) * coalesce(costo_medio(a.id), 0), 2) as valore,
       a.scorta_minima is not null and coalesce(m.giacenza, 0) < a.scorta_minima as sotto_scorta,
       (select jsonb_agg(jsonb_build_object('id', k.id, 'nome', k.nome, 'quantita', k.quantita) order by k.quantita)
          from articoli_confezioni k where k.articolo_id = a.id) as confezioni
  from articoli a
  join categorie_articolo c on c.id = a.categoria_id
  left join (select articolo_id, sum(quantita) as giacenza from movimenti_articoli group by articolo_id) m
         on m.articolo_id = a.id;

-- ADMIN · Miele sfuso per lotto, con valore al costo del lotto
create view v_miele_sfuso with (security_invoker = true) as
select l.id as lotto_id, l.codice, t.nome as tipo_miele, l.anno, l.stato,
       coalesce(sum(m.kg), 0) as kg,
       round(coalesce(sum(m.kg), 0) * coalesce(l.costo_kg, (calcola_costo_lotto(l.id)->>'costo_kg')::numeric), 2) as valore
  from lotti l join tipi_miele t on t.id = l.tipo_miele_id
  left join movimenti_miele m on m.lotto_id = l.id
 group by l.id, t.nome;

-- ADMIN · Lotti con costo congelato, costo attuale e avviso "dati cambiati"
create view v_lotti with (security_invoker = true) as
select l.id, l.codice, l.tipo_miele_id, t.nome as tipo_miele, l.anno, l.progressivo, l.stato,
       l.ricordami_chiusura, l.data_chiusura,
       kg_smielati(l.id) as kg_smielati,
       (select coalesce(sum(kg), 0) from movimenti_miele where lotto_id = l.id) as kg_sfuso,
       l.kg_rimasto, l.kg_calo, l.kg_uso_personale,
       (select min(data) from lotto_eventi where lotto_id = l.id) as inizio,
       (select max(data) from lotto_eventi where lotto_id = l.id) as ultimo_evento,
       l.costo_kg as costo_kg_congelato,
       (c.j->>'costo_kg')::numeric as costo_kg_attuale,
       l.stato = 'chiuso' and l.costo_kg is not null
         and abs((c.j->>'costo_kg')::numeric - l.costo_kg) > 0.005 as dati_cambiati,
       c.j as dettaglio_attuale, l.costo_dettaglio as dettaglio_congelato
  from lotti l join tipi_miele t on t.id = l.tipo_miele_id
  cross join lateral (select calcola_costo_lotto(l.id) as j) c;

-- ADMIN · Costo di ogni vasetto e margine: ultimo lotto chiuso del miele, altrimenti il più recente (stima)
create view v_costo_vasetti with (security_invoker = true) as
with rif as (
    select distinct on (l.tipo_miele_id) l.tipo_miele_id, l.id as lotto_id, l.codice, l.stato
      from lotti l
     where kg_smielati(l.id) > 0
     order by l.tipo_miele_id, (l.stato = 'chiuso') desc, l.anno desc, l.progressivo desc
)
select v.id as variante_id, v.codice_articolo, p.nome as prodotto, v.formato, v.peso_kg,
       r.codice as lotto_rif, r.stato = 'aperto' as stima,
       coalesce(lv.costo_confezione, costo_confezione(v.id)) as costo_confezione,
       coalesce(lv.costo_miele, v.peso_kg * coalesce((calcola_costo_lotto(r.lotto_id)->>'costo_kg')::numeric, 0)) as costo_miele,
       ps.prezzo as prezzo,
       (select jsonb_agg(jsonb_build_object('articolo', a.nome, 'quantita', d.quantita, 'costo_medio', costo_medio(a.id)))
          from distinta_base d join articoli a on a.id = d.articolo_id where d.variante_id = v.id) as componenti
  from varianti_prodotto v
  join prodotti p on p.id = v.prodotto_id
  left join rif r on r.tipo_miele_id = p.tipo_miele_id
  left join lotti_costo_vasetti lv on lv.lotto_id = r.lotto_id and lv.variante_id = v.id and r.stato = 'chiuso'
  left join prezzi_storico ps on ps.variante_id = v.id and ps.valido_al is null
 where v.attivo and exists (select 1 from distinta_base d where d.variante_id = v.id);
-- costo totale = costo_confezione + costo_miele; margine = prezzo − costo totale (calcolati nell'app)

-- ADMIN · Fatturato unificato (clienti + mercato)
create view v_fatturato with (security_invoker = true) as
select 'cliente'::text as canale, cs.data_consegna::date as data, cr.variante_id,
       csr.quantita as pezzi, csr.quantita * cr.prezzo_unitario_applicato as importo
  from consegna_righe csr
  join consegne cs      on cs.id = csr.consegna_id
  join comanda_righe cr on cr.id = csr.comanda_riga_id
union all
select 'mercato', s.data, r.variante_id,
       r.quantita_prelevata - r.quantita_resa,
       (r.quantita_prelevata - r.quantita_resa) * r.prezzo_unitario_applicato
  from sessione_mercato_righe r join sessioni_mercato s on s.id = r.sessione_id
 where s.stato = 'chiusa';

-- ADMIN · Andamento: vendite con tutte le dimensioni dei grafici
create view v_vendite with (security_invoker = true) as
select f.data, extract(year from f.data)::int as anno, extract(month from f.data)::int as mese,
       f.canale, f.variante_id, p.nome as prodotto, t.nome as tipo_miele, v.formato,
       f.pezzi, f.pezzi * coalesce(v.peso_kg, 0) as kg, f.importo
  from v_fatturato f
  join varianti_prodotto v on v.id = f.variante_id
  join prodotti p on p.id = v.prodotto_id
  left join tipi_miele t on t.id = p.tipo_miele_id;

-- ADMIN · Andamento: spese per categoria e prezzo unitario degli articoli nel tempo
create view v_spese with (security_invoker = true) as
select a.data, extract(year from a.data)::int as anno, extract(month from a.data)::int as mese,
       r.id as riga_id, ar.id as articolo_id, ar.nome as articolo, c.codice as categoria, c.nome as categoria_nome,
       f.nome as fornitore, r.quantita, ar.unita, r.totale,
       round(r.totale / r.quantita, 4) as prezzo_unitario,
       exists (select 1 from cespiti ce where ce.acquisto_riga_id = r.id) as attrezzatura_pluriennale
  from acquisto_righe r join acquisti a on a.id = r.acquisto_id
  join articoli ar on ar.id = r.articolo_id join categorie_articolo c on c.id = ar.categoria_id
  left join fornitori f on f.id = a.fornitore_id;

-- ADMIN · Andamento: kg smielati per tipo e anno
create view v_kg_smielati with (security_invoker = true) as
select l.anno, t.nome as tipo_miele, l.codice as lotto, sum(b.kg) as kg
  from smielatura_bariloni b join lotto_eventi e on e.id = b.evento_id
  join lotti l on l.id = e.lotto_id join tipi_miele t on t.id = l.tipo_miele_id
 group by l.anno, t.nome, l.codice;

-- ADMIN · Andamento: incassi e costi per anno
--   costi = spese dell'anno senza gli acquisti di attrezzatura pluriennale + costo d'uso dell'attrezzatura
create view v_incassi_costi_anno with (security_invoker = true) as
with anni as (
    select anno from v_vendite union select anno from v_spese
)
select a.anno,
       coalesce((select sum(importo) from v_vendite v where v.anno = a.anno), 0)::numeric(12,2) as incassi,
       (coalesce((select sum(totale) from v_spese s where s.anno = a.anno and not s.attrezzatura_pluriennale), 0)
        + uso_cespiti(a.anno))::numeric(12,2) as costi
  from anni a where is_admin();

-- ADMIN · Venduto mensile (compatibilità v02)
create view v_venduto_mensile with (security_invoker = true) as
select date_trunc('month', data)::date as mese, canale, prodotto, formato,
       sum(pezzi)::int as pezzi, sum(kg)::numeric(10,3) as kg,
       coalesce(sum(importo), 0)::numeric(10,2) as euro,
       coalesce(sum(pezzi) filter (where importo is null), 0)::int as pezzi_senza_prezzo
  from v_vendite group by 1, 2, 3, 4;

create view v_scadenze_consegna with (security_invoker = true) as
select c.id, cl.nome || ' ' || cl.cognome as cliente, c.stato, c.data_consegna_indicativa,
       c.data_consegna_indicativa - current_date as giorni_mancanti
  from comande c join clienti cl on cl.id = c.cliente_id
 where c.stato in ('confermata', 'in_produzione', 'parzialmente_evasa')
   and c.data_consegna_indicativa <= current_date + 7;

create view v_saldi_aperti with (security_invoker = true) as
select c.id as comanda_id, cl.nome || ' ' || cl.cognome as cliente,
       coalesce(t.totale_consegnato, 0)::numeric(10,2) as totale_consegnato,
       coalesce(pg.incassato, 0)::numeric(10,2)        as incassato,
       (coalesce(t.totale_consegnato, 0) - coalesce(pg.incassato, 0))::numeric(10,2) as saldo
  from comande c
  join clienti cl on cl.id = c.cliente_id
  left join (select comanda_id, sum(quantita_evasa * prezzo_unitario_applicato) as totale_consegnato
               from comanda_righe group by comanda_id) t on t.comanda_id = c.id
  left join (select comanda_id, sum(importo) as incassato
               from movimenti_pagamento group by comanda_id) pg on pg.comanda_id = c.id
 where c.stato <> 'annullata'
   and coalesce(t.totale_consegnato, 0) - coalesce(pg.incassato, 0) <> 0;

create view v_notifiche_da_leggere with (security_invoker = true) as
select categoria, count(*)::int as da_leggere from notifiche where letta_il is null group by categoria;

-- ADMIN · "Da fare" della Home: lotti da chiudere, ordini da confermare, consegne vicine
create view v_da_fare with (security_invoker = true) as
select 'chiudi_lotto'::text as tipo, l.id::text as rif, 'Chiudi il lotto ' || l.codice as testo, l.data_ultimo as quando
  from (select l.*, (select max(data) from lotto_eventi e where e.lotto_id = l.id) as data_ultimo
          from lotti l where l.stato = 'aperto'
           and (l.ricordami_chiusura or exists (select 1 from lotto_eventi e where e.lotto_id = l.id and e.tipo = 'confezionamento'))) l
union all
select 'conferma_ordine', c.id::text, 'Conferma l''ordine di ' || cl.nome || ' ' || cl.cognome, c.creata_il
  from comande c join clienti cl on cl.id = c.cliente_id where c.stato = 'in_attesa_conferma'
union all
select 'consegna', s.id::text, 'Consegna a ' || s.cliente, s.data_consegna_indicativa::timestamptz
  from v_scadenze_consegna s;

revoke all on all tables in schema public from anon;
-- Privilegi: le RLS decidono cosa si vede e cosa si scrive; le viste sono in sola lettura
do $$
declare t text;
begin
    for t in select tablename from pg_tables where schemaname = 'public' loop
        execute format('grant select, insert, update, delete on %I to authenticated', t);
    end loop;
    for t in select viewname from pg_views where schemaname = 'public' loop
        execute format('revoke all on %I from authenticated; grant select on %I to authenticated', t, t);
    end loop;
end $$;
grant usage on all sequences in schema public to authenticated;


-- ============================================================================
-- 18. DATI INIZIALI (Filodape)
-- ============================================================================
insert into tipi_miele (nome, sigla) values ('Acacia', 'ACA'), ('Castagno', 'CAS'), ('Millefiori', 'MIL');

insert into categorie_prodotto (nome) values
    ('Miele'), ('Propoli'), ('Pappa reale'), ('Candele'), ('Kit regalo'), ('Ceste e bomboniere');

insert into prodotti (categoria_id, nome, tipo_miele_id)
select c.id, x.nome, t.id from (values
    (1, 'Miele', 'Miele di Acacia', 'ACA'), (2, 'Miele', 'Miele di Castagno', 'CAS'), (3, 'Miele', 'Miele Millefiori', 'MIL'),
    (4, 'Propoli', 'Propoli', null), (5, 'Pappa reale', 'Pappa reale', null),
    (6, 'Candele', 'Candela in cera d''api', null), (7, 'Candele', 'Candela Palmanova', null),
    (8, 'Kit regalo', 'Kit Regalo', null), (9, 'Ceste e bomboniere', 'Cesta / bomboniera personalizzata', null)
) as x(ord, cat, nome, sigla) join categorie_prodotto c on c.nome = x.cat left join tipi_miele t on t.sigla = x.sigla order by x.ord;

insert into varianti_prodotto (prodotto_id, formato, peso_kg, codice_articolo)
select p.id, x.formato, x.peso, x.sku from (values
    (1, 'Miele di Acacia',   '125g', 0.125, 'MIE-ACA-125'), (2, 'Miele di Acacia',   '500g', 0.5, 'MIE-ACA-500'),
    (3, 'Miele di Acacia',   '1kg',  1.0,   'MIE-ACA-1KG'),
    (4, 'Miele di Castagno', '125g', 0.125, 'MIE-CAS-125'), (5, 'Miele di Castagno', '500g', 0.5, 'MIE-CAS-500'),
    (6, 'Miele di Castagno', '1kg',  1.0,   'MIE-CAS-1KG'),
    (7, 'Miele Millefiori',  '125g', 0.125, 'MIE-MIL-125'), (8, 'Miele Millefiori',  '500g', 0.5, 'MIE-MIL-500'),
    (9, 'Miele Millefiori',  '1kg',  1.0,   'MIE-MIL-1KG'),
    (10, 'Propoli', null, null, 'PRO-STD'), (11, 'Pappa reale', null, null, 'PAP-STD'),
    (12, 'Candela in cera d''api', null, null, 'CAN-STD'), (13, 'Candela Palmanova', null, null, 'CAN-PAL'),
    (14, 'Kit Regalo', null, null, 'KIT-REG'), (15, 'Cesta / bomboniera personalizzata', null, null, 'CES-PER')
) as x(ord, prodotto, formato, peso, sku) join prodotti p on p.nome = x.prodotto order by x.ord;

-- Prezzi ufficiali noti (Brand Image 01/09/2026). Il resto resta "X" finché Filippo non lo imposta.
insert into prezzi_storico (variante_id, prezzo)
select v.id, x.prezzo from (values
    ('MIE-ACA-500', 7.00), ('MIE-ACA-1KG', 13.00), ('MIE-CAS-500', 8.50),
    ('MIE-MIL-500', 7.00), ('MIE-MIL-1KG', 12.00)
) as x(sku, prezzo) join varianti_prodotto v on v.codice_articolo = x.sku;

insert into categorie_articolo (codice, nome, magazzino_default) values
    ('conf',  'Confezionamento',                             'materiali'),
    ('ali',   'Alimentazione api',                           'apistiche'),
    ('trat',  'Trattamenti',                                 'apistiche'),
    ('attr',  'Attrezzatura',                                null),
    ('carb',  'Carburante',                                  null),
    ('mezzi', 'Mezzi: assicurazione, bollo, manutenzione',   null),
    ('altro', 'Altro',                                       null);

insert into articoli (nome, categoria_id, magazzino, unita, scorta_minima, codice)
select x.nome, c.id, 'materiali', 'pz', 50, x.codice
  from (values
    (1, 'Vasetto 125g', 'VAS-125G'), (2, 'Vasetto 500g', 'VAS-500G'), (3, 'Vasetto 1kg', 'VAS-1KG'),
    (4, 'Tappo 125g', 'TAP-125G'), (5, 'Tappo 500g', 'TAP-500G'), (6, 'Tappo 1kg', 'TAP-1KG'),
    (7, 'Etichetta 125g', 'ETI-125G'), (8, 'Etichetta 500g', 'ETI-500G'), (9, 'Etichetta 1kg', 'ETI-1KG'),
    (10, 'Sigillo Acacia', 'SIG-ACA'), (11, 'Sigillo Millefiori', 'SIG-MIL')
  ) as x(ord, nome, codice) cross join categorie_articolo c where c.codice = 'conf' order by x.ord;
-- SIG-CAS non esiste ancora: quando arriva, si crea l'articolo con codice SIG-CAS e si aggiunge alle distinte Castagno.

insert into articoli (nome, categoria_id, magazzino, unita)
select 'Gasolio', id, null, 'l' from categorie_articolo where codice = 'carb';

-- Distinta base proposta per tutti i vasetti
insert into distinta_base (variante_id, articolo_id)
select v.id, a.id
  from varianti_prodotto v join prodotti p on p.id = v.prodotto_id join tipi_miele t on t.id = p.tipo_miele_id
  join articoli a on a.codice in ('VAS-' || upper(v.formato), 'TAP-' || upper(v.formato),
                                  'ETI-' || upper(v.formato), 'SIG-' || t.sigla);

insert into mezzi (nome, tipo, tariffa_km, note) values
    ('Fiorino', 'dedicato', null, 'Del 1998, usato solo per le api'),
    ('Auto personale', 'personale', 0.15, 'Uso misto: solo tariffa al km'),
    ('Furgone di un amico', 'terzi', null, 'Costo scritto viaggio per viaggio');

insert into categorie_cespite (nome, vita_utile_default) values
    ('Arnie', 10), ('Smielatura', 15), ('Maturazione e stoccaggio', 12), ('Attrezzi', 5), ('Mezzi', 8);

insert into motivi_rettifica (magazzino, nome) values
    ('prodotti', 'Rotto o danneggiato'), ('prodotti', 'Omaggio'), ('prodotti', 'Assaggio'),
    ('prodotti', 'Compenso in miele'), ('prodotti', 'Correzione inventario'),
    ('articoli', 'Scaduto'), ('articoli', 'Rotto o danneggiato'), ('articoli', 'Perso'),
    ('articoli', 'Correzione inventario'),
    ('miele', 'Uso personale'), ('miele', 'Scartato'), ('miele', 'Correzione inventario');


-- ============================================================================
-- 19. NOTE DI IMPLEMENTAZIONE (per Mohammed / strumento AI di sviluppo)
-- ============================================================================
-- A) PRIMO ACCESSO DI FILIPPO (una tantum, SQL editor Supabase)
--    1. Authentication → Add user → email filippo.menossi@utenti.filodape.it, "Auto confirm"
--    2. insert into profili (id, username, nome, cognome, ruolo)
--       values ('<uuid auth>', 'filippo.menossi', 'Filippo', 'Menossi', 'admin');
--
-- B) EDGE FUNCTION "gestione-utenti" (service_role, MAI nel browser)
--    crea_utente(username, nome, cognome, password) · reset_password(user_id, password)
--    disattiva_utente(user_id) → update profili set attivo = false. Il chiamante deve essere admin.
--
-- C) LOGIN: email = username.trim().toLowerCase() + '@' + impostazioni.dominio_login
--    supabase-js con persistSession + autoRefreshToken: nessuna scadenza lato app.
--
-- D) CHIAMATE DALL'APP
--    Staff · nuovo ordine      rpc crea_comanda(p_cliente | p_nuovo_cliente, p_righe, p_note)
--            ricerca clienti   select v_clienti_staff · disponibilità: select v_disponibilita_staff
--            i miei ordini     select v_mie_comande · modifica/annulla: update comande / comanda_righe (RLS)
--    Admin · ordini            conferma_comanda · registra_consegna · insert movimenti_pagamento (±)
--            prezzi            imposta_prezzo(variante, prezzo | null)
--            mercato           insert sessioni_mercato → insert sessione_mercato_righe → chiudi_sessione_mercato
--            acquisti          registra_acquisto(data, fornitore | nuovo, righe) — fornitori/articoli/cespiti al volo
--            stagione          registra_attivita(tipo, data, articolo, quantità, minuti, note, postazioni[], confezione)
--            produzione        nuovo_lotto → registra_evento_lotto (spostamento | smielatura con bariloni[])
--                              → confeziona(lotto, righe) → chiudi_lotto(lotto, kg_rimasto, uso_personale)
--                              "ricordamelo dopo": update lotti set ricordami_chiusura = true
--                              ricalcola_lotto(lotto) · ricalcola_tutti_lotti()
--            rettifiche        rettifica_prodotto / rettifica_articolo / rettifica_miele (motivo testo)
--            inventario        carico_iniziale_prodotto; materiali = registra_acquisto "Inventario iniziale"
--            anagrafiche       insert/update diretti (RLS admin); archiviare = update archiviato = true;
--                              cancellare: delete, se fallisce per FK l'app propone "Archivia"
--            catalogo          nuovo_tipo_miele(nome, sigla) · proponi_distinta(variante) · distinta_base diretta
--            calcolatore       select v_costo_vasetti · v_lotti · quota_stagione(anno) · calcola_costo_lotto(id)
--            andamento         v_vendite · v_spese · v_kg_smielati · v_incassi_costi_anno (aggregazioni nell'app)
--            home              preferenze_home · grafici_utente · v_da_fare · v_notifiche_da_leggere
--
-- E) NAVIGAZIONE: ogni pagina ha un URL proprio (router), così il "indietro" del browser funziona;
--    nella PWA installata (senza barra del browser) resta il tasto "← indietro" in pagina.
-- ============================================================================
