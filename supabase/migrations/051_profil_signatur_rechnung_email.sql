-- ============================================================
-- Maja-Logistik Business-Portal — 051: Admin-Profil-Erweiterung +
-- Rechnungs-Belege-Zuordnung + Email-Versand-Stempel.
-- ------------------------------------------------------------
-- 1) app_users bekommt telefon + position für die E-Mail-Signatur
--    aller ausgehenden Mails (Aufgabe 1).
-- 2) update_my_profile-RPC um die zwei neuen Felder erweitert.
-- 3) rechnungen.belege_pdf_url für die Beleg-Zuordnung (Aufgabe 2)
--    und rechnungen.email_versendet_am als Versand-Stempel
--    (Aufgabe 3).
-- ============================================================

alter table public.app_users
  add column if not exists telefon  text,
  add column if not exists position text;

create or replace function public.update_my_profile(
  p_vorname         text,
  p_nachname        text,
  p_save_to_gallery boolean,
  p_telefon         text default null,
  p_position        text default null
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
     set vorname         = p_vorname,
         nachname        = p_nachname,
         save_to_gallery = coalesce(p_save_to_gallery, false),
         telefon         = p_telefon,
         position        = p_position
   where id = auth.uid();
end;
$$;

grant execute on function public.update_my_profile(text, text, boolean, text, text) to authenticated;

alter table public.rechnungen
  add column if not exists belege_pdf_url      text,
  add column if not exists email_versendet_am  timestamptz;

notify pgrst, 'reload schema';
