-- Funzione minima per il "keep-alive": una chiamata ogni pochi giorni evita che
-- il progetto Supabase gratuito venga messo in pausa per inattività.
-- Non legge dati: risponde solo true. È l'unica cosa che può chiamare chi non ha fatto l'accesso.
create or replace function ping() returns boolean
language sql stable set search_path = public as $$ select true $$;
revoke execute on function ping() from public;
grant execute on function ping() to anon, authenticated;
