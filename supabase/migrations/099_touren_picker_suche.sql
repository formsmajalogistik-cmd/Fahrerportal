-- Volltextsuche für die Tour-Auswahl im Posteingang („Zusätze
-- hinzufügen" / „Zusätze + Belege").
--
-- Anlass: Die Auswahl lud die 150 Touren mit dem spätesten Startdatum und
-- suchte nur darin. Geplante Zukunftstouren belegten die Plätze, eine
-- Fahrt von vor zwei Tagen fiel schon heraus — auch per Suche war sie
-- nicht mehr erreichbar. Zusätze und Belege kommen aber typischerweise
-- Tage NACH der Fahrt.
--
-- Die Standardliste läuft jetzt über ein Zeitfenster direkt in der Abfrage.
-- Für alles außerhalb gibt es diese Suche, ohne Datumsgrenze. Sie muss
-- serverseitig laufen, weil zwei der wichtigsten Suchbegriffe sich über
-- PostgREST nicht als Teilstring filtern lassen:
--   * Kennzeichen liegen als text[] vor („HB-ML" soll „HB-ML 421" finden),
--   * Fahrernamen stehen in fahrer bzw. app_users, nicht in touren.
--
-- SECURITY INVOKER: die RLS des Aufrufers gilt unverändert. Zurück kommen
-- nur Tour-IDs; die Zeilen lädt das Frontend wie gewohnt mit seinem
-- eigenen select (und wieder unter RLS).

create or replace function public.touren_picker_suche(
  p_suche text,
  p_limit int default 200
)
returns setof uuid
language sql
stable
security invoker
set search_path = public
as $$
  with muster as (
    -- % und _ aus der Eingabe wörtlich nehmen, nicht als Platzhalter.
    select '%' || replace(replace(replace(trim(p_suche), '\', '\\'), '%', '\%'), '_', '\_') || '%' as m
  )
  select t.id
  from public.touren t
  cross join muster
  left join public.auftraggeber a on a.id = t.auftraggeber_id
  left join public.fahrer f       on f.id = t.fahrer_id
  left join public.app_users u    on u.id = f.user_id
  where length(trim(coalesce(p_suche, ''))) >= 2
    and (
         t.tour_id                         ilike muster.m
      or t.start_stadt                     ilike muster.m
      or t.ziel_stadt                      ilike muster.m
      or t.rueckfuehrung_stadt             ilike muster.m
      or t.kundenname                      ilike muster.m
      or array_to_string(t.kennzeichen, ' ') ilike muster.m
      or a.name                            ilike muster.m
      or concat_ws(' ', f.vorname, f.nachname) ilike muster.m
      or concat_ws(' ', u.vorname, u.nachname) ilike muster.m
      or u.email                           ilike muster.m
    )
  order by coalesce(t.enddatum, t.startdatum) desc nulls last, t.id
  limit least(greatest(coalesce(p_limit, 200), 1), 500);
$$;

comment on function public.touren_picker_suche(text, int) is
  'Tour-IDs zu einem Suchbegriff (Tour-ID, Stadt, Kunde, Kennzeichen-Teilstring, Auftraggeber, Fahrer) ohne Datumsgrenze. Läuft unter der RLS des Aufrufers.';

grant execute on function public.touren_picker_suche(text, int) to authenticated;

notify pgrst, 'reload schema';
