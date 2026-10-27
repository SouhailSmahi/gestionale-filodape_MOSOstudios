-- Valore degli ordini per anno (ottobre 2026), per la Home del titolare.
-- Conta tutti gli ordini inseriti nell'anno (data dell'ordine), annullati esclusi:
-- da confermare, confermati e non ancora consegnati, consegnati. Diverso dal "venduto",
-- che non conta quelli ancora da confermare.
create view v_ordini_anno with (security_invoker = true) as
select extract(year from c.creata_il at time zone 'Europe/Rome')::int as anno,
       count(distinct c.id)::int as ordini,
       coalesce(sum(cr.quantita_ordinata * coalesce(cr.prezzo_unitario_applicato, 0)), 0)::numeric(12,2) as totale,
       coalesce(sum(cr.quantita_ordinata * coalesce(cr.prezzo_unitario_applicato, 0))
                filter (where c.stato = 'in_attesa_conferma'), 0)::numeric(12,2) as da_confermare,
       coalesce(sum((cr.quantita_ordinata - cr.quantita_evasa) * coalesce(cr.prezzo_unitario_applicato, 0))
                filter (where c.stato <> 'in_attesa_conferma'), 0)::numeric(12,2) as da_consegnare,
       coalesce(sum(cr.quantita_evasa * coalesce(cr.prezzo_unitario_applicato, 0)), 0)::numeric(12,2) as consegnato,
       count(distinct c.id) filter (where c.stato = 'in_attesa_conferma')::int as ordini_da_confermare,
       coalesce(sum(cr.quantita_ordinata) filter (where cr.prezzo_unitario_applicato is null), 0)::int as pezzi_senza_prezzo
  from comande c join comanda_righe cr on cr.comanda_id = c.id
 where c.stato <> 'annullata' and is_admin()
 group by 1;
grant select on v_ordini_anno to authenticated;
