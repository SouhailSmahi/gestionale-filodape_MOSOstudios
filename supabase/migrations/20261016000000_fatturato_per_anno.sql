-- Fatturato per anno (ottobre 2026).
-- Fino al 2025 il gestionale non c'era: Filippo scrive a mano il totale venduto di ogni anno.
-- Dal 2026 il totale lo calcola l'app: vale la data dell'ordine (competenza), non quella della consegna.
-- Conta tutto quello che Filippo vende: ordini dei clienti (anche ingrosso, secchi, bomboniere, accessori)
-- e vendite al mercato. Gli ordini annullati o ancora da confermare non contano.

-- 1. Totali scritti a mano, solo per gli anni prima del gestionale
create table fatturato_storico (
    anno          int primary key constraint fatturato_storico_anno check (anno between 1990 and 2025),
    importo       numeric(12,2) not null constraint fatturato_storico_importo check (importo >= 0),
    nota          text,
    aggiornato_il timestamptz not null default now(),
    aggiornato_da uuid references profili(id) default auth.uid()
);

-- 2. Registro delle modifiche (si aggiunge, non si cancella): chi ha cambiato cosa e quando
create table fatturato_storico_modifiche (
    id             bigint generated always as identity primary key,
    anno           int not null,
    importo_prima  numeric(12,2),
    importo_dopo   numeric(12,2),
    nota           text,
    modificato_il  timestamptz not null default now(),
    modificato_da  uuid references profili(id) default auth.uid()
);

alter table fatturato_storico enable row level security;
alter table fatturato_storico_modifiche enable row level security;
create policy admin_legge on fatturato_storico for select to authenticated using (is_admin());
create policy admin_legge on fatturato_storico_modifiche for select to authenticated using (is_admin());
-- si scrive solo con la funzione qui sotto
revoke all on fatturato_storico, fatturato_storico_modifiche from anon;
revoke insert, update, delete, truncate on fatturato_storico, fatturato_storico_modifiche from authenticated;
grant select on fatturato_storico, fatturato_storico_modifiche to authenticated;

-- 3. Scrive, corregge o toglie il totale di un anno passato (solo titolare). Importo vuoto = togli.
create or replace function imposta_fatturato_storico(p_anno int, p_importo numeric, p_nota text default null)
returns void language plpgsql security definer set search_path = public as $$
declare prima numeric;
begin
    if not is_admin() then raise exception 'Solo l''amministratore può modificare il fatturato'; end if;
    if p_anno is null then raise exception 'Indica l''anno'; end if;
    if p_anno >= 2026 then raise exception 'Dal 2026 il fatturato lo calcola l''app dagli ordini: non si scrive a mano'; end if;
    if p_anno < 1990 then raise exception 'Anno non valido'; end if;
    if p_importo is not null and p_importo < 0 then raise exception 'Il fatturato non può essere negativo'; end if;

    select importo into prima from fatturato_storico where anno = p_anno for update;
    if p_importo is null then
        if not found then return; end if;
        delete from fatturato_storico where anno = p_anno;
    else
        insert into fatturato_storico (anno, importo, nota, aggiornato_il, aggiornato_da)
        values (p_anno, round(p_importo, 2), nullif(trim(p_nota), ''), now(), auth.uid())
        on conflict (anno) do update
           set importo = excluded.importo, nota = excluded.nota,
               aggiornato_il = excluded.aggiornato_il, aggiornato_da = excluded.aggiornato_da;
    end if;
    if prima is distinct from round(p_importo, 2) or p_nota is not null then
        insert into fatturato_storico_modifiche (anno, importo_prima, importo_dopo, nota)
        values (p_anno, prima, round(p_importo, 2), nullif(trim(p_nota), ''));
    end if;
end $$;
revoke execute on function imposta_fatturato_storico(int, numeric, text) from public, anon;
grant execute on function imposta_fatturato_storico(int, numeric, text) to authenticated;

-- 4. Fatturato per anno: manuale fino al 2025, automatico dal 2026 (solo titolare)
create view v_fatturato_anni with (security_invoker = true) as
with ordini as (
    select extract(year from c.creata_il at time zone 'Europe/Rome')::int as anno,
           sum(cr.quantita_ordinata * coalesce(cr.prezzo_unitario_applicato, 0)) as venduto,
           sum(cr.quantita_ordinata) filter (where cr.prezzo_unitario_applicato is null) as pezzi_senza_prezzo
      from comande c join comanda_righe cr on cr.comanda_id = c.id
     where c.stato not in ('annullata', 'in_attesa_conferma')
     group by 1
), pagati as (
    select extract(year from c.creata_il at time zone 'Europe/Rome')::int as anno, sum(mp.importo) as incassato
      from comande c join movimenti_pagamento mp on mp.comanda_id = c.id
     where c.stato not in ('annullata', 'in_attesa_conferma')
     group by 1
), mercato as (
    select extract(year from s.data)::int as anno,
           sum((r.quantita_prelevata - r.quantita_resa) * coalesce(r.prezzo_unitario_applicato, 0)) as venduto,
           sum(r.quantita_prelevata - r.quantita_resa) filter (where r.prezzo_unitario_applicato is null) as pezzi_senza_prezzo
      from sessione_mercato_righe r join sessioni_mercato s on s.id = r.sessione_id
     where s.stato = 'chiusa'
     group by 1
), auto as (
    select a.anno,
           coalesce(o.venduto, 0)::numeric(12,2) as venduto_ordini,
           coalesce(m.venduto, 0)::numeric(12,2) as venduto_mercato,
           -- al mercato si incassa sul momento
           (coalesce(p.incassato, 0) + coalesce(m.venduto, 0))::numeric(12,2) as incassato,
           (coalesce(o.pezzi_senza_prezzo, 0) + coalesce(m.pezzi_senza_prezzo, 0))::int as pezzi_senza_prezzo
      from (select anno from ordini union select anno from mercato
            union select extract(year from now() at time zone 'Europe/Rome')::int) a
      left join ordini o on o.anno = a.anno
      left join pagati p on p.anno = a.anno
      left join mercato m on m.anno = a.anno
     where a.anno >= 2026
)
select anno, 'automatico'::text as fonte, (venduto_ordini + venduto_mercato)::numeric(12,2) as venduto,
       venduto_ordini, venduto_mercato, incassato, pezzi_senza_prezzo,
       null::text as nota, null::timestamptz as aggiornato_il
  from auto where is_admin()
union all
select anno, 'manuale', importo, null, null, null, 0, nota, aggiornato_il
  from fatturato_storico where is_admin();
revoke all on v_fatturato_anni from anon;
grant select on v_fatturato_anni to authenticated;
