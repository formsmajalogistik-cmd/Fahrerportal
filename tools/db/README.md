# Datenbank-Tests der Migrationen

```
npm run test:db
```

Prüft Trigger, Sperren, RLS und RPCs der Migrationen 115–118 sowie die
Daten-Skripte aus `supabase/scripts/` gegen einen
**lokalen** PostgreSQL (≥ 15) — nie gegen die echte Datenbank:

1. Vorlage bauen: kleine Supabase-Nachbildung (`bootstrap.sql`: Rollen
   `authenticated`/`service_role`, `auth.uid()`, `storage`), alle Migrationen
   bis 114 und Testnutzer (`seed.sql`).
2. Je Test eine frische Kopie; darin wird die Migration zweimal eingespielt
   (Wiederholbarkeit) und das Verhalten geprüft.

| Datei | Inhalt |
|---|---|
| `115.test.sh` | Fälligkeit, Empfänger-/Positionsfelder, Bestand unverändert |
| `116.test.sh` | Firmendaten-Snapshot, Archiv nur per Server, Sperren, Storno-RPC |
| `118.test.sh` | Niederlassungen: Zuordnung nur zum eigenen Auftraggeber, inaktiv/abgerechnet gesperrt, Löschen nur ohne Bezüge, E-Rechnungs-Angaben beim Erstellen, Storno, Tour aufteilen, Auftraggeber-Konto + Kundensicht ohne Preise |
| `adressen.test.sh` | PLZ/Ort-Schreibskript: Probelauf ändert nichts, echter Lauf schreibt nur „eindeutig" und nichts Gefülltes, zweiter Lauf ohne Wirkung |
| `117.test.sh` | ZUGFeRD-Eintrag ohne XML-Pfad, Export-Protokoll, Rechnungsnummer bei gescheitertem Erstellen (keine Lücke, keine Doppelvergabe) |

Verbindung: Standard ist `-h /tmp -p 5463 -U postgres`; anpassen mit
`DBTEST_PSQL="-h localhost -p 5432 -U postgres" npm run test:db`. Es werden
nur Datenbanken mit dem Präfix `fp_test_` angelegt und wieder gelöscht.
