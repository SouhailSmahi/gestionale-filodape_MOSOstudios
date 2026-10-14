-- Pulizia segnalata dal controllo di sicurezza di Supabase (ottobre 2026).
-- Le funzioni dei trigger non devono essere chiamabili dall'app come rpc:
-- i trigger continuano a funzionare anche senza il permesso EXECUTE.
do $$
declare f record;
begin
    for f in select p.oid::regprocedure as firma
               from pg_proc p
              where p.pronamespace = 'public'::regnamespace
                and p.prorettype = 'trigger'::regtype loop
        execute format('revoke execute on function %s from public, anon, authenticated', f.firma);
    end loop;
end $$;

-- search_path fisso anche per l'unica funzione che non lo aveva
alter function fn_solo_inserimento() set search_path = public;
