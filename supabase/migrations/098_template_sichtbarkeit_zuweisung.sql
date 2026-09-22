-- Zugewiesene (unsichtbare) Protokolle erreichen den Fahrer wieder.
--
-- Fehlerbild: Ein Template mit `sichtbar = false` wurde einer Tour
-- zugewiesen und tauchte beim Fahrer weder unter „Formulare" noch in der
-- Tourenliste auf. Sichtbare Templates funktionierten.
--
-- Ursache: Seit Migration 054 leben Protokoll-Zuweisungen in
-- `tour_protokoll_zuweisungen`. Die Lesepolicy auf `formular_templates`
-- wurde dabei NICHT nachgezogen — sie kennt bis heute nur die alte
-- Einzelspalte `touren.schriftliches_protokoll_id`, die von keiner
-- Oberfläche mehr beschrieben wird (TourCreateDialog schreibt fest NULL,
-- TourDetailDialog reicht nur den Altwert durch). Der Fahrer durfte die
-- ZUWEISUNG lesen (Policy `tpz_read`), aber nicht das daran hängende
-- TEMPLATE. Im Frontend kam die eingebettete Template-Zeile deshalb als
-- NULL zurück und die Karte wurde verworfen.
--
-- Warum es „gestern noch ging": Die alte Policy prüft nicht die konkrete
-- Tour, sondern ob der Fahrer IRGENDEINE Tour mit diesem Template in der
-- Altspalte hat. Wer eine solche Alt-Tour besitzt, sieht das Template
-- überall; alle anderen Fahrer sehen es nirgends. Genau das erklärt, dass
-- derselbe Vorgang bei einem Fahrer klappte und bei den anderen nicht.
--
-- Zweiter Fehler in derselben Policy: Migration 024 hatte den Pfad auf
-- `fahrer_belongs_to_me()` gestellt (Unterkonten). Migration 056 hat beim
-- Umbau für die Auftraggeber-Rolle wieder `f.user_id = auth.uid()`
-- eingesetzt — damit verlor ein an ein UNTERKONTO übergebenes Protokoll
-- seine Sichtbarkeit. Wird hier mit repariert.

-- ------------------------------------------------------------
-- 1. Freischalt-Regel als eigene Funktion.
--
-- SECURITY DEFINER, damit die Unterabfragen nicht ihrerseits durch RLS
-- laufen (`ausgefuellte_formulare` verweist selbst auf Templates — das
-- ergäbe eine Endlosrekursion).
--
-- Freigeschaltet ist ein Template für mich, wenn
--   (a) es einer meiner Touren zugewiesen ist (neue Tabelle ODER
--       Altspalte), die Tour schriftlich protokolliert wird und noch
--       geplant/aktiv ist — Enddatum heute oder später bzw. gar nicht
--       gesetzt, identisch zu computeTourStatus() im Frontend; oder
--   (b) ich dafür bereits ein Formular habe (Entwurf oder eingereicht).
--
-- (b) ist kein Schlupfloch, sondern notwendig: ohne diese Zeile verlöre
-- ein Fahrer am Tag nach der Tour den Zugriff auf sein eigenes,
-- angefangenes oder eingereichtes Protokoll — die Formularseite braucht
-- das Schema zum Rendern.
--
-- „Unterkonto" ist durchgehend über fahrer_belongs_to_me() abgedeckt.
-- ------------------------------------------------------------

create or replace function public.template_fuer_mich_zugewiesen(p_template_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    -- (a) Zuweisung über die Verknüpfungstabelle (Migration 054)
    select 1
    from public.tour_protokoll_zuweisungen z
    join public.touren t on t.id = z.tour_id
    where z.template_id = p_template_id
      and t.protokoll_art = 'schriftlich'
      and (t.enddatum is null
           or t.enddatum >= (now() at time zone 'Europe/Berlin')::date)
      and public.fahrer_belongs_to_me(t.fahrer_id)
  ) or exists (
    -- (a) Altspalte, für nicht migrierte Bestandstouren
    select 1
    from public.touren t
    where t.schriftliches_protokoll_id = p_template_id
      and t.protokoll_art = 'schriftlich'
      and (t.enddatum is null
           or t.enddatum >= (now() at time zone 'Europe/Berlin')::date)
      and public.fahrer_belongs_to_me(t.fahrer_id)
  ) or exists (
    -- (b) eigenes Formular zu diesem Template
    select 1
    from public.ausgefuellte_formulare a
    where a.template_id = p_template_id
      and public.fahrer_belongs_to_me(a.fahrer_id)
  );
$$;

comment on function public.template_fuer_mich_zugewiesen(uuid) is
  'Darf der angemeldete Fahrer (inkl. Unterkonten) dieses Protokoll-Template lesen, obwohl es nicht sichtbar ist? Zuweisung an eine geplante/aktive eigene Tour oder ein eigenes Formular dazu.';

grant execute on function public.template_fuer_mich_zugewiesen(uuid) to authenticated;

-- ------------------------------------------------------------
-- 2. Lesepolicy auf formular_templates neu setzen.
--
-- Aufbau unverändert gegenüber Migration 056 — nur der Tour-Pfad zeigt
-- jetzt auf die Funktion statt auf die Altspalte. Der
-- Auftraggeber-Ausschluss und die Freigaben-Zeile bleiben wörtlich
-- erhalten.
-- ------------------------------------------------------------

drop policy if exists templates_visible_read on public.formular_templates;
create policy templates_visible_read on public.formular_templates
  for select using (
    public.is_admin()
    or (sichtbar = true and not public.is_auftraggeber())
    or (
      not public.is_auftraggeber()
      and public.template_fuer_mich_zugewiesen(formular_templates.id)
    )
    or exists (
      select 1 from public.template_auftraggeber_freigaben fr
      where fr.template_id = formular_templates.id
        and fr.auftraggeber_id = public.current_auftraggeber_id()
    )
  );

-- ------------------------------------------------------------
-- 3. Index für den Zuweisungs-Pfad.
--
-- `tour_protokoll_zuweisungen` hat bisher nur einen Index auf tour_id;
-- die Policy fragt aber nach template_id.
-- ------------------------------------------------------------

create index if not exists tour_protokoll_zuweisungen_template_id_idx
  on public.tour_protokoll_zuweisungen (template_id);

notify pgrst, 'reload schema';
