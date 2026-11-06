-- Startdaten aus dem Medien-Vertrag. Alles lässt sich später in der Eltern-Ansicht ändern.

INSERT INTO settings (key, value) VALUES ('main', '{
  "earliestStart": {"1": 720, "2": 720, "3": 720, "4": 720, "5": 720},
  "freeDayStart": 690,
  "endBeforeSchool": 1200,
  "endOtherwise": 1290,
  "pauseActiveMinutes": 180,
  "pauseBreakMinutes": 30,
  "pauseMinutes": 30,
  "offlineMinutes": 240,
  "warnMinutes": 5,
  "examDays": 7,
  "testDays": 3
}');

INSERT INTO checklist_items (label, condition, sort) VALUES
  ('Zimmer aufgeräumt', 'always', 1),
  ('Hausaufgaben gemacht', 'always', 2),
  ('Lernstunde erledigt', 'study', 3),
  ('Schulranzen gepackt und Anziehstuhl vorbereitet', 'tomorrowSchool', 4);

INSERT INTO catalog (label, log_text, minutes, special, hint, sort) VALUES
  ('Geschirr nicht in/auf die Spülmaschine geräumt', 'Geschirr nicht weggeräumt', 15, NULL, NULL, 1),
  ('Türen knallen', 'Türen geknallt', 30, NULL, NULL, 2),
  ('Weiterdiskutieren nach klarer Entscheidung', 'Nach klarer Entscheidung weiterdiskutiert', 15, NULL, NULL, 3),
  ('Nicht innerhalb von 8 Min. gekommen', 'Nicht innerhalb von 8 Min. gekommen', 30, NULL, NULL, 4),
  ('Nicht gekommen – ab 15 Min. Verspätung', 'Erst nach über 15 Min. gekommen', 60, NULL, NULL, 5),
  ('Rumschreien', 'Rumgeschrien', 60, NULL, NULL, 6),
  ('Carl ärgern', 'Carl geärgert', 30, NULL, NULL, 7),
  ('Nicht gehorchen', 'Nicht gehorcht', 30, NULL, NULL, 8),
  ('Keine Pause eingelegt', 'Keine Pause eingelegt', 30, NULL, NULL, 9),
  ('Materialien für Hausaufgaben/Lernen in der Schule liegen gelassen', 'Materialien in der Schule liegen gelassen', 60, NULL, NULL, 10),
  ('Essen vorzeitig verlassen', 'Essen vorzeitig verlassen', 30, NULL, NULL, 11),
  ('Pflicht vor Medien doch nicht erledigt', 'Pflicht doch nicht erledigt, Checkliste zurückgesetzt', 30, 'reset_checklist', NULL, 12),
  ('Geräte zu spät auf dem Fensterbrett – bis 10 Min.', 'Geräte zu spät aufs Fensterbrett gelegt', 60, NULL, NULL, 13),
  ('Geräte zu spät auf dem Fensterbrett – über 10 Min.', 'Geräte über 10 Min. zu spät aufs Fensterbrett gelegt', 180, NULL, NULL, 14),
  ('In der Schule schlecht benommen (Mitteilung der Lehrkraft)', 'In der Schule schlecht benommen', 300, NULL, NULL, 15),
  ('Lügen', 'Gelogen', 180, NULL, NULL, 16),
  ('Lernstunde ausgelassen', 'Lernstunde ausgelassen', 60, NULL, 'Lernstunde nachholen', 17),
  ('Sport ohne guten Grund ausgelassen', 'Sport ohne guten Grund ausgelassen', 180, NULL, NULL, 18),
  ('Familienunternehmung verweigert', 'Familienunternehmung verweigert', 60, NULL, NULL, 19),
  ('Heimlich Medien genutzt (auch morgens vor der Schule)', 'Heimlich Medien genutzt', 600, NULL, NULL, 20);

-- Kanton Thurgau: Schulferien (Volksschule/Sekundarstufe) und Feiertage.
-- Quelle: öffentliche Ferienkalender (Stand Nov. 2026). Bitte mit dem Ferienplan der
-- eigenen Sekundarschulgemeinde abgleichen – einzelne Gemeinden weichen ab.
INSERT INTO holidays (date_from, date_to, label) VALUES
  ('2026-12-21', '2027-01-03', 'Weihnachtsferien'),
  ('2027-02-01', '2027-02-07', 'Sportferien'),
  ('2027-03-26', '2027-04-11', 'Frühlingsferien (inkl. Ostern)'),
  ('2027-05-06', '2027-05-17', 'Auffahrt/Pfingsten'),
  ('2027-07-12', '2027-08-15', 'Sommerferien'),
  ('2027-10-11', '2027-10-24', 'Herbstferien'),
  ('2027-12-20', '2028-01-02', 'Weihnachtsferien'),
  ('2028-04-14', '2028-04-14', 'Karfreitag'),
  ('2028-04-17', '2028-04-17', 'Ostermontag'),
  ('2028-05-01', '2028-05-01', 'Tag der Arbeit (bitte prüfen, ob schulfrei)'),
  ('2028-05-25', '2028-05-25', 'Auffahrt'),
  ('2028-06-05', '2028-06-05', 'Pfingstmontag'),
  ('2028-08-01', '2028-08-01', 'Bundesfeier'),
  ('2028-12-25', '2028-12-26', 'Weihnachten/Stephanstag');
