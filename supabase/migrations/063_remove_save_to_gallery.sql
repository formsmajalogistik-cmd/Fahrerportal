-- ============================================================
-- Maja-Logistik Business-Portal — 063: save_to_gallery entfernen
-- ------------------------------------------------------------
-- Die Profil-Einstellung „aufgenommene Fotos in der Galerie speichern"
-- konnte technisch nie wie gedacht funktionieren (Web-Apps dürfen nicht
-- automatisch in die Geräte-Galerie schreiben). Sie wird durch den
-- bewussten „Fotos dieser Seite sichern"-Button (Web Share API) ersetzt.
-- Die Spalte + der RPC-Parameter werden vollständig entfernt.
--
-- Idempotent.
-- ============================================================

-- 1) Alte RPC-Signatur (mit p_save_to_gallery) entfernen, neue ohne anlegen.
drop function if exists public.update_my_profile(text, text, boolean, text, text);

create or replace function public.update_my_profile(
  p_vorname   text,
  p_nachname  text,
  p_telefon   text default null,
  p_position  text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  update public.app_users
     set vorname  = p_vorname,
         nachname = p_nachname,
         telefon  = p_telefon,
         position = p_position
   where id = auth.uid();
end;
$$;

grant execute on function public.update_my_profile(text, text, text, text) to authenticated;

-- 2) Spalte entfernen (die RPC referenziert sie nun nicht mehr).
alter table public.app_users drop column if exists save_to_gallery;

notify pgrst, 'reload schema';
