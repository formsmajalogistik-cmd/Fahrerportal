-- ============================================================
-- Maja-Logistik Business-Portal — 017: Self-Update der eigenen Profil-Felder
-- ------------------------------------------------------------
-- app_users hat bisher nur eine admin-only Write-Policy. Damit konnten
-- Fahrer ihre Profil-Felder (Vorname/Nachname/Galerie-Toggle) nicht
-- speichern — der UPDATE schlug stillschweigend fehl, weil die RLS-
-- Policy den Schreibzugriff verweigert hat.
--
-- Lösung: SECURITY-DEFINER-RPC, die nur die unkritischen Felder schreibt
-- und intern auf auth.uid() prüft. Damit kann ein eingeloggter User die
-- eigenen Profil-Felder pflegen, ohne dass Rolle/E-Mail manipuliert
-- werden können.
-- ============================================================

create or replace function public.update_my_profile(
  p_vorname         text,
  p_nachname        text,
  p_save_to_gallery boolean
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
         save_to_gallery = coalesce(p_save_to_gallery, false)
   where id = auth.uid();
end;
$$;

grant execute on function public.update_my_profile(text, text, boolean) to authenticated;
