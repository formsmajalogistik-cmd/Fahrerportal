-- Migration 089: Tour an ein eigenes Unterkonto übergeben
--
-- Ausgangslage (geprüft, siehe Bericht)
-- ------------------------------------
-- Die Policy `touren_self_reassign` aus Migration 024 existiert noch und
-- erlaubt Fahrern UPDATE auf Touren der eigenen Konto-Familie. Sie tut
-- damit fast das Richtige — aber als reine FOR-UPDATE-Policy schützt sie
-- keine einzelnen SPALTEN. Ein Fahrer konnte darüber `verguetung`,
-- `km_*`, `bestaetigt`, Datumsfelder und Adressen seiner eigenen Touren
-- beliebig ändern. Lokal gegen die echten Policies reproduziert:
--   * fahrer_id → eigenes Unterkonto        → ging durch
--   * fahrer_id → fremder Fahrer            → korrekt abgelehnt
--   * verguetung 450,00 → 9999,99           → GING DURCH
--
-- Deshalb hier: die breite UPDATE-Policy fällt weg und wird durch eine
-- SECURITY-DEFINER-Funktion ersetzt, die ausschließlich `fahrer_id`
-- schreibt. Das ist dieselbe Lehre wie bei den Auftraggeber-Touren
-- (079/084): RLS ist zeilen-, nicht spaltenbasiert.

-- ------------------------------------------------------------
-- 1. Breite UPDATE-Policy entfernen.
--    Fahrer haben damit KEIN direktes UPDATE mehr auf touren —
--    Übergaben laufen nur noch über die RPC unten.
-- ------------------------------------------------------------
drop policy if exists touren_self_reassign on public.touren;

-- ------------------------------------------------------------
-- 2. Konto-Familie: alle Fahrer-Einträge, die zum aufrufenden Login
--    gehören (Haupt-Eintrag + dessen Unterkonten).
--
--    Wichtig: Haupt- und Unterkonten teilen sich denselben auth-User
--    (Migration 024). Serverseitig ist deshalb NICHT unterscheidbar,
--    ob gerade "als Hauptkonto" oder "als Unterkonto" gehandelt wird —
--    es ist derselbe JWT. Die Regel "nur das Hauptkonto verteilt" kann
--    daher nur die Oberfläche durchsetzen; die Datenbank stellt sicher,
--    dass die Tour die Familie nicht verlässt.
-- ------------------------------------------------------------
create or replace function public.meine_fahrer_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select f.id
    from public.fahrer f
   where f.user_id = auth.uid()
  union
  select u.id
    from public.fahrer u
    join public.fahrer h on h.id = u.haupt_user_id
   where h.user_id = auth.uid();
$$;

revoke all on function public.meine_fahrer_ids() from public;
grant execute on function public.meine_fahrer_ids() to authenticated;

-- ------------------------------------------------------------
-- 3. Anzeigename eines Fahrer-Eintrags für das Änderungsprotokoll.
--    Unterkonten haben eigene vorname/nachname (024); fehlen sie,
--    greift der Name aus app_users.
-- ------------------------------------------------------------
create or replace function public.fahrer_anzeigename(p_fahrer_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(btrim(concat_ws(' ', f.vorname, f.nachname)), ''),
    nullif(btrim(concat_ws(' ', u.vorname, u.nachname)), ''),
    u.email,
    'Unbekannt'
  )
    from public.fahrer f
    left join public.app_users u on u.id = f.user_id
   where f.id = p_fahrer_id;
$$;

revoke all on function public.fahrer_anzeigename(uuid) from public;
grant execute on function public.fahrer_anzeigename(uuid) to authenticated;

-- ------------------------------------------------------------
-- 4. Die eigentliche Übergabe.
--
--    Schreibt AUSSCHLIESSLICH touren.fahrer_id. Alle übrigen Spalten
--    (Preis, km, Status, Daten, Adressen …) bleiben für Fahrer
--    unerreichbar — sie stehen nicht im UPDATE.
-- ------------------------------------------------------------
create or replace function public.tour_uebergeben(
  p_tour_id        uuid,
  p_neuer_fahrer_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alt_fahrer  uuid;
  v_greimel     uuid;
  v_alt_name    text;
  v_neu_name    text;
begin
  if p_tour_id is null or p_neuer_fahrer_id is null then
    return jsonb_build_object('ok', false, 'fehler', 'Tour und Ziel-Konto sind erforderlich.');
  end if;

  select t.fahrer_id, t.greimel_zugang_id
    into v_alt_fahrer, v_greimel
    from public.touren t
   where t.id = p_tour_id;

  if not found then
    return jsonb_build_object('ok', false, 'fehler', 'Tour nicht gefunden.');
  end if;

  -- Admins dürfen das ohnehin über die Tour-Bearbeitung; hier geht es
  -- um den Fahrer-Pfad. Beide Enden müssen zur eigenen Konto-Familie
  -- gehören — damit ist "an fremde Fahrer weitergeben" ausgeschlossen,
  -- ebenso "Touren übernehmen, die mir gar nicht zugewiesen sind".
  if not public.is_admin() then
    if v_alt_fahrer is null
       or v_alt_fahrer not in (select public.meine_fahrer_ids()) then
      return jsonb_build_object('ok', false,
        'fehler', 'Diese Tour ist Ihnen nicht zugewiesen.');
    end if;
    if p_neuer_fahrer_id not in (select public.meine_fahrer_ids()) then
      return jsonb_build_object('ok', false,
        'fehler', 'Die Tour kann nur an das eigene Konto oder eigene Unterkonten übergeben werden.');
    end if;
  end if;

  if v_alt_fahrer = p_neuer_fahrer_id then
    return jsonb_build_object('ok', true, 'unveraendert', true);
  end if;

  select public.fahrer_anzeigename(v_alt_fahrer)       into v_alt_name;
  select public.fahrer_anzeigename(p_neuer_fahrer_id)  into v_neu_name;

  -- NUR fahrer_id. Bewusst keine weitere Spalte.
  update public.touren
     set fahrer_id = p_neuer_fahrer_id
   where id = p_tour_id;

  -- Greimel-Zugang mitziehen: der neue Fahrer braucht Zugriff, sonst
  -- steht er ohne Zugangsdaten vor der App.
  if v_greimel is not null then
    update public.greimel_zugaenge
       set fahrer_ids = (
             select array(
               select distinct x
                 from unnest(coalesce(fahrer_ids, '{}'::uuid[]) || p_neuer_fahrer_id) as x
             ))
     where id = v_greimel;
  end if;

  -- Begonnene Entwürfe mitziehen.
  --
  -- Ein Draft hängt nur über daten->>'_tour_id' an der Tour und wird im
  -- Fahrer-Dashboard nach ausgefuellte_formulare.fahrer_id gefiltert.
  -- Ohne diesen Schritt bliebe eine halb ausgefüllte Übernahme beim
  -- alten Konto liegen und wäre für den neuen Fahrer unsichtbar.
  --
  -- NUR Entwürfe. Eingereichte Formulare bleiben bei dem Konto, das sie
  -- eingereicht hat — das ist ein Beleg darüber, wer die Fahrt
  -- tatsächlich dokumentiert hat, und darf nicht umgeschrieben werden.
  update public.ausgefuellte_formulare
     set fahrer_id = p_neuer_fahrer_id
   where status = 'draft'
     and daten ->> '_tour_id' = p_tour_id::text
     and fahrer_id is distinct from p_neuer_fahrer_id;

  -- Für Admins nachvollziehbar machen — dieselbe Tabelle und dieselbe
  -- Ansicht wie bei Auftraggeber-Änderungen (079).
  insert into public.tour_aenderungen (tour_id, geaendert_von, feld, wert_alt, wert_neu)
  values (p_tour_id, auth.uid(), 'fahrer_id', v_alt_name, v_neu_name);

  return jsonb_build_object(
    'ok', true,
    'alt', v_alt_name,
    'neu', v_neu_name
  );
end;
$$;

revoke all on function public.tour_uebergeben(uuid, uuid) from public;
grant execute on function public.tour_uebergeben(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
