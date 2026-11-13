import { describe, expect, it } from 'vitest';
import { Engine } from '../worker/engine/engine';
import { hm, localDate, zonedToUtc } from '../worker/engine/time';
import { at, checkAll, engine, input, nextAllowedLocal, penalty, uncheckAll } from './helpers';
import { DEFAULT_SETTINGS, ratingPenaltyMinutes } from '../worker/engine/types';

// Kalender: Mo 09.11.2026, Di 10.11., Fr 13.11., Sa 14.11., So 15.11.
const MO = '2026-11-09';
const DI = '2026-11-10';
const FR = '2026-11-13';
const SA = '2026-11-14';
const SO = '2026-11-15';

describe('Pflichtfälle aus dem Auftrag', () => {
  it('1: Montag 14:30, Checkliste erledigt, Rumschreien 1 Std. sofort → gesperrt bis 15:30', () => {
    const e = engine(at(MO, '14:31'), {
      checklistEvents: checkAll(MO, '13:00'),
      penalties: [penalty(at(MO, '14:30'), 60)],
    });
    const st = e.status();
    expect(st.kind).toBe('penalty');
    expect(st.allowed).toBe(false);
    expect(st.text).toBe('Gesperrt bis 15:30 – Rumschreien (Papa)');
    expect(nextAllowedLocal(e)).toBe(`${MO} 15:30`);
  });

  it('2: dazu um 14:45 Carl ärgern 30 Min. → gesperrt bis 16:00', () => {
    const e = engine(at(MO, '14:46'), {
      checklistEvents: checkAll(MO, '13:00'),
      penalties: [penalty(at(MO, '14:30'), 60), penalty(at(MO, '14:45'), 30, 'Carl ärgern', 'Mama')],
    });
    expect(e.status().text).toBe('Gesperrt bis 16:00 – Rumschreien (Papa)');
    const open = e.openPenalties();
    expect(open.map((p) => p.remainingMinutes)).toEqual([44, 30]);
    expect(hm(open[1].endsAt!)).toBe('16:00');
  });

  it('3: Montag 19:30 Rumschreien 1 Std. „heute früher Schluss“ → sofort Schluss, 30 Min. Rest am Dienstag', () => {
    const before = engine(at(MO, '19:30'), { checklistEvents: checkAll(MO, '13:00') });
    expect(before.status().kind).toBe('allowed');
    const split = before.modeBSplit(60);
    expect(split).toEqual({ cut: 30, carry: 30 });

    const p = penalty(at(MO, '19:30'), 60, 'Rumschreien', 'Papa', { mode: 'B', ...split });
    const after = engine(at(MO, '19:31'), { checklistEvents: checkAll(MO, '13:00'), penalties: [p] });
    expect(after.status().kind).toBe('schedule');
    expect(after.dayInfo(MO).end).toBe(19 * 60 + 30);

    // Dienstag: Checkliste um 13:00 → gesperrt bis 13:30
    const di = engine(at(DI, '13:01'), {
      checklistEvents: [...checkAll(MO, '13:00'), ...checkAll(DI, '13:00')],
      penalties: [p],
    });
    expect(di.status().text).toBe('Gesperrt bis 13:30 – Rumschreien (Papa)');

    // Dienstag: Checkliste schon um 11:00 → Strafe läuft erst ab der frühesten Startzeit 12:00
    const di2 = engine(at(DI, '12:01'), {
      checklistEvents: [...checkAll(MO, '13:00'), ...checkAll(DI, '11:00')],
      penalties: [p],
    });
    expect(di2.status().text).toBe('Gesperrt bis 12:30 – Rumschreien (Papa)');
  });

  it('4: Samstag 9:00, 30 Min. sofort → Medien erst ab 12:00', () => {
    const e = engine(at(SA, '10:01'), {
      checklistEvents: checkAll(SA, '10:00'),
      penalties: [penalty(at(SA, '09:00'), 30)],
    });
    expect(e.status().kind).toBe('schedule');
    expect(e.status().text).toBe('Sperrzeit – wieder ab 12:00');
    expect(nextAllowedLocal(e)).toBe(`${SA} 12:00`);
  });

  it('5: 10 Std. Strafe am Freitagabend → nur in erlaubter Zeit übers Wochenende', () => {
    const p = penalty(at(FR, '20:00'), 600, 'Heimlich Medien genutzt');
    // Freitag 20:00–21:30 = 90 Min. Samstag 11:30–20:00 = 510 Min.
    const fr = engine(at(FR, '20:01'), { checklistEvents: checkAll(FR, '13:00'), penalties: [p] });
    expect(fr.status().kind).toBe('penalty');
    expect(nextAllowedLocal(fr)).toBe(`${SA} 20:00`);

    // Samstag Checkliste erst um 14:00: 14:00–21:30 = 450 Min., Rest 60 Min. am Sonntag
    const sa = engine(at(SA, '14:01'), {
      checklistEvents: [...checkAll(FR, '13:00'), ...checkAll(SA, '14:00')],
      penalties: [p],
    });
    expect(sa.openPenalties()[0].remainingMinutes).toBe(509);
    expect(nextAllowedLocal(sa)).toBe(`${SO} 12:30`);

    // Samstag 12:00 ohne Checkliste: Strafe läuft NICHT ab
    const sa2 = engine(at(SA, '12:00'), { checklistEvents: checkAll(FR, '13:00'), penalties: [p] });
    expect(sa2.openPenalties()[0].remainingMinutes).toBe(510);
    expect(sa2.status().kind).toBe('checklist');
  });

  it('6: Sonntag vor Ferienbeginn → Endzeit 21:30 statt 20:00', () => {
    const holidays = [{ from: '2026-12-21', to: '2027-01-03', label: 'Weihnachtsferien' }];
    expect(engine(at('2026-12-20', '12:00'), { holidays }).dayInfo('2026-12-20').end).toBe(21 * 60 + 30);
    expect(engine(at('2026-12-13', '12:00'), { holidays }).dayInfo('2026-12-13').end).toBe(20 * 60);
    // letzter Ferientag vor Schulbeginn → 20:00
    expect(engine(at('2027-01-03', '12:00'), { holidays }).dayInfo('2027-01-03').end).toBe(20 * 60);
    // Freitag vor den Ferien und Ferientag mitten in der Woche → 21:30, Start 11:30
    const e = engine(at('2026-12-22', '12:00'), { holidays });
    expect(e.dayInfo('2026-12-22')).toMatchObject({ school: false, start: 690, end: 1290 });
  });

  it('7: Zeitumstellung Ende Oktober und Ende März', () => {
    // So 25.10.2026: Uhren 03:00 → 02:00
    expect(new Date(zonedToUtc('2026-10-25', 11 * 60 + 30)).toISOString()).toBe('2026-10-25T10:30:00.000Z');
    expect(new Date(zonedToUtc('2026-10-24', 11 * 60 + 30)).toISOString()).toBe('2026-10-24T09:30:00.000Z');
    const okt = engine(at('2026-10-25', '12:01'), {
      checklistEvents: checkAll('2026-10-25', '11:00'),
      penalties: [penalty(at('2026-10-25', '12:00'), 60)],
    });
    const d = okt.dayInfo('2026-10-25');
    expect((d.endTs - d.startTs) / 3_600_000).toBe(8.5);
    expect(nextAllowedLocal(okt)).toBe('2026-10-25 13:00');

    // So 28.03.2027: Uhren 02:00 → 03:00
    expect(new Date(zonedToUtc('2027-03-28', 11 * 60 + 30)).toISOString()).toBe('2027-03-28T09:30:00.000Z');
    const mar = engine(at('2027-03-28', '01:00'), {
      checklistEvents: checkAll('2027-03-28', '00:30'),
      penalties: [penalty(at('2027-03-28', '01:00'), 60)],
    });
    expect(nextAllowedLocal(mar)).toBe('2027-03-28 12:30');
    // Strafe über Mitternacht in die Umstellungsnacht hinein
    const sat = engine(at('2027-03-27', '21:00'), {
      checklistEvents: [...checkAll('2027-03-27', '10:00'), ...checkAll('2027-03-28', '10:00')],
      penalties: [penalty(at('2027-03-27', '21:00'), 60)],
    });
    expect(nextAllowedLocal(sat, 'real')).toBe('2027-03-28 12:00');
  });

  it('8: Strafe verringern (PIN) während eine Strafe läuft → neue Endzeit', () => {
    const p = penalty(at(MO, '14:30'), 60);
    const mid = engine(at(MO, '15:00'), { checklistEvents: checkAll(MO, '13:00'), penalties: [p] });
    const split = mid.reductionSplit(p, 20);
    expect(split).toEqual({ queueMinutes: 20, cutMinutes: 0 });
    const e = engine(at(MO, '15:01'), {
      checklistEvents: checkAll(MO, '13:00'),
      penalties: [p],
      adjustments: [{ id: 1, ts: at(MO, '15:00'), penaltyId: p.id, ...split }],
    });
    expect(e.status().text).toBe('Gesperrt bis 15:10 – Rumschreien (Papa)');

    // ganz aufheben
    const all = mid.reductionSplit(p, null);
    expect(all.queueMinutes).toBe(30);
    const e2 = engine(at(MO, '15:01'), {
      checklistEvents: checkAll(MO, '13:00'),
      penalties: [p],
      adjustments: [{ id: 1, ts: at(MO, '15:00'), penaltyId: p.id, ...all }],
    });
    expect(e2.status().kind).toBe('allowed');
  });

  it('8b: Modus-B-Strafe verringern → Endzeit rückt wieder nach hinten', () => {
    const p = penalty(at(MO, '16:00'), 60, 'Lügen', 'Mama', { mode: 'B', cut: 60, carry: 0 });
    const e = engine(at(MO, '16:30'), { checklistEvents: checkAll(MO, '13:00'), penalties: [p] });
    expect(e.status().text).toBe('Darf bis 19:00');
    const split = e.reductionSplit(p, 20);
    expect(split).toEqual({ queueMinutes: 0, cutMinutes: 20 });
    const e2 = engine(at(MO, '16:31'), {
      checklistEvents: checkAll(MO, '13:00'),
      penalties: [p],
      adjustments: [{ id: 1, ts: at(MO, '16:30'), penaltyId: p.id, ...split }],
    });
    expect(e2.status().text).toBe('Darf bis 19:20');
  });

  it('9: Pausenregel – 3 Std. aktiv → 30 Min. Pause; gesperrte Sitzung zählt nicht', () => {
    const cl = checkAll(SA, '11:00');
    const e = engine(at(SA, '14:35'), { checklistEvents: cl, activity: [{ from: at(SA, '11:30'), to: at(SA, '14:30') }] });
    expect(e.status().kind).toBe('pause');
    expect(e.status().text).toBe('Pause bis 15:00');

    // 20 Min. gesperrt (keine Aktivität) zählt nicht als aktiv, setzt aber auch nicht zurück
    const e2 = engine(at(SA, '14:55'), {
      checklistEvents: cl,
      activity: [
        { from: at(SA, '11:30'), to: at(SA, '13:00') },
        { from: at(SA, '13:20'), to: at(SA, '14:55') },
      ],
    });
    expect(e2.status().text).toBe('Pause bis 15:20');

    // Pause ≥ 30 Min. setzt den Zähler zurück
    const e3 = engine(at(SA, '15:00'), {
      checklistEvents: cl,
      activity: [
        { from: at(SA, '11:30'), to: at(SA, '13:00') },
        { from: at(SA, '13:35'), to: at(SA, '15:00') },
      ],
    });
    expect(e3.status().kind).toBe('allowed');
    expect(e3.pauseView().activeSoFarMinutes).toBe(85);

    // Vorhersage: aktiv seit 11:30, jetzt 14:00 → Pause ab 14:30 (für die Vorwarnung)
    const e4 = engine(at(SA, '14:00'), { checklistEvents: cl, activity: [{ from: at(SA, '11:30'), to: at(SA, '14:00') }] });
    expect(hm(e4.pauseView().nextPauseAt!)).toBe('14:30');
    expect(e4.status().text).toBe('Darf bis 14:30');
    const pauseSeg = e4.plan().find((s) => s.kind === 'pause');
    expect(pauseSeg && hm(pauseSeg.from)).toBe('14:30');
  });

  it('10 (Server-Seite): Offline-Plan ist vorsichtig – künftige Tage mit offener Checkliste', () => {
    const e = engine(at(MO, '19:00'), { checklistEvents: checkAll(MO, '13:00') });
    const plan = e.plan();
    expect(plan[0]).toMatchObject({ kind: 'allowed', allowed: true });
    expect(hm(plan[0].to)).toBe('20:00');
    expect(plan.filter((s) => s.allowed)).toHaveLength(1);
    expect(plan.some((s) => s.kind === 'checklist' && localDate(s.from) === DI)).toBe(true);
    expect(plan[plan.length - 1].to - plan[0].from).toBe(24 * 3_600_000);
  });

  it('11: Checkliste um 7:00 abgehakt → trotzdem keine Medien vor der frühesten Startzeit', () => {
    const e = engine(at(MO, '08:00'), { checklistEvents: checkAll(MO, '07:00') });
    expect(e.status().kind).toBe('schedule');
    expect(e.status().text).toBe('Sperrzeit – wieder ab 12:00');
    expect(engine(at(MO, '12:00'), { checklistEvents: checkAll(MO, '07:00') }).status().kind).toBe('allowed');
  });

  it('12: „Pflicht doch nicht erledigt“ → Checkliste offen, sofort gesperrt, +30 Min. nach erneutem Abhaken', () => {
    const p = penalty(at(MO, '15:00'), 30, 'Pflicht vor Medien doch nicht erledigt');
    const events = [...checkAll(MO, '13:00'), ...uncheckAll(MO, '15:00')];
    const e = engine(at(MO, '15:01'), { checklistEvents: events, penalties: [p] });
    expect(e.status().kind).toBe('checklist');
    expect(e.status().allowed).toBe(false);
    expect(e.status().text).toBe('Checkliste noch offen – danach noch 30 Min. Strafe');

    const e2 = engine(at(MO, '16:01'), { checklistEvents: [...events, ...checkAll(MO, '16:00')], penalties: [p] });
    expect(e2.status().text).toBe('Gesperrt bis 16:30 – Pflicht vor Medien doch nicht erledigt (Papa)');
  });
});

describe('Weitere Regeln', () => {
  it('Sonderfreigabe gilt trotz Strafe; die Strafe pausiert solange', () => {
    const e = engine(at(MO, '14:45'), {
      checklistEvents: checkAll(MO, '13:00'),
      penalties: [penalty(at(MO, '14:30'), 60)],
      grants: [{ id: 1, from: at(MO, '14:40'), to: at(MO, '15:00'), person: 'Leif', reason: 'Referat' }],
    });
    expect(e.status().text).toBe('Sonderfreigabe bis 15:00');
    expect(e.openPenalties()[0].remainingMinutes).toBe(50);
    expect(hm(e.openPenalties()[0].endsAt!)).toBe('15:50');
  });

  it('Sonderfreigabe gilt auch ohne Checkliste und außerhalb der Zeiten', () => {
    const e = engine(at(MO, '21:00'), {
      grants: [{ id: 1, from: at(MO, '20:50'), to: at(MO, '21:20'), person: 'Mama', reason: 'Film' }],
    });
    expect(e.status()).toMatchObject({ kind: 'grant', allowed: true, text: 'Sonderfreigabe bis 21:20' });
  });

  it('Lernstunde erscheint nur bei Klausur (7 Tage) oder Test (3 Tage)', () => {
    const e = engine(at(MO, '12:00'), {
      exams: [
        { id: 1, date: '2026-11-16', kind: 'klausur', subject: 'Mathe' },
        { id: 2, date: '2026-11-13', kind: 'test', subject: 'Englisch' },
      ],
    });
    expect(e.studyNeeded(MO)).toBe(true); // Klausur in 7 Tagen
    expect(e.studyNeeded('2026-11-16')).toBe(false); // am Klausurtag selbst nicht mehr
    const onlyTest = engine(at(MO, '12:00'), { exams: [{ id: 2, date: '2026-11-13', kind: 'test', subject: 'Englisch' }] });
    expect(onlyTest.studyNeeded(MO)).toBe(false);
    expect(onlyTest.studyNeeded(DI)).toBe(true);
  });

  it('Neu eingetragene Klausur wirkt nicht rückwirkend auf schon abgesessene Strafzeit', () => {
    const p = penalty(at(MO, '14:00'), 90);
    const e = engine(at(MO, '15:01'), {
      checklistEvents: checkAll(MO, '13:00').filter((x) => x.itemId !== 3),
      penalties: [p],
      exams: [{ id: 1, date: '2026-11-12', kind: 'klausur', subject: 'Mathe', ts: at(MO, '15:00') }],
    });
    // 14:00–15:00 ist abgesessen; ab 15:00 ist die Checkliste offen (Lernstunde neu)
    expect(e.openPenalties()[0].remainingMinutes).toBe(30);
    expect(e.status().kind).toBe('checklist');
  });

  it('Schulranzen-Punkt nur, wenn morgen Schule ist', () => {
    const e = engine(at(FR, '12:00'));
    expect(e.applicableItems(FR).map((i) => i.id)).toEqual([1, 2]);
    expect(e.applicableItems(SO).map((i) => i.id)).toEqual([1, 2, 4]);
  });

  it('Tag verlängern („darf bis 22:15“) und später erneut Modus B → chronologisch', () => {
    const e = engine(at(SA, '20:00'), {
      checklistEvents: checkAll(SA, '11:00'),
      dayChanges: [{ id: 1, ts: at(SA, '10:00'), date: SA, kind: 'end', minutes: 22 * 60 + 15 }],
    });
    expect(e.status().text).toBe('Darf bis 22:15');
    const split = e.modeBSplit(30);
    const p = penalty(at(SA, '20:00'), 30, 'Türen knallen', 'Gretja', { mode: 'B', ...split });
    const e2 = engine(at(SA, '20:01'), {
      checklistEvents: checkAll(SA, '11:00'),
      dayChanges: [{ id: 1, ts: at(SA, '10:00'), date: SA, kind: 'end', minutes: 22 * 60 + 15 }],
      penalties: [p],
    });
    expect(e2.status().text).toBe('Darf bis 21:45');
  });

  it('Modus B, bevor die Medienzeit begonnen hat: Rest ab frühester Startzeit gerechnet', () => {
    const e = engine(at(MO, '10:00'));
    expect(e.modeBSplit(60)).toEqual({ cut: 60, carry: 0 });
    const late = engine(at(MO, '20:30'));
    expect(late.modeBSplit(60)).toEqual({ cut: 0, carry: 60 });
  });

  it('Zwischenstand (Checkpoint) liefert dasselbe Ergebnis', () => {
    const p = penalty(at(FR, '20:00'), 600);
    const events = [...checkAll(FR, '13:00'), ...checkAll(SA, '14:00'), ...checkAll(SO, '11:00')];
    const full = engine(at(SO, '12:00'), { checklistEvents: events, penalties: [p] });
    const cand = full.checkpointCandidate();
    expect(cand).not.toBeNull();
    expect(cand!.checkpoint.remaining[String(p.id)]).toBe(60 * 60_000);
    const withCp = engine(at(SO, '12:00'), { checklistEvents: events, penalties: [p], checkpoint: cand!.checkpoint });
    expect(withCp.status()).toEqual(full.status());
    expect(withCp.from).toBe(cand!.checkpoint.ts);
    expect(withCp.status().text).toBe('Gesperrt bis 12:30 – Rumschreien (Papa)');
  });

  it('Sperrzeit-Text: nächster Tag mit Checkliste', () => {
    const e = engine(at(FR, '22:00'), { checklistEvents: checkAll(FR, '13:00') });
    expect(e.status().text).toBe('Sperrzeit – wieder ab morgen 11:30 (mit erledigter Checkliste)');
  });

  it('Rechenaufwand bleibt klein', () => {
    const penalties = Array.from({ length: 30 }, (_, i) => penalty(at(MO, '14:00') + i * 60_000, 30));
    const t0 = performance.now();
    const e = new Engine(input(at(MO, '14:31'), { checklistEvents: checkAll(MO, '13:00'), penalties }));
    e.status();
    e.plan();
    e.openPenalties();
    expect(performance.now() - t0).toBeLessThan(200);
  });
});

describe('Bewertung des morgendlichen Benehmens', () => {
  const withRating = { ...DEFAULT_SETTINGS, ratingRequired: true };
  const rating = (date: string, time: string, score = 9) => ({ date, ts: at(date, time), score, person: 'Mama' });

  it('Checkliste erledigt, aber noch nicht bewertet → wartet auf Bewertung', () => {
    const e = engine(at(MO, '13:30'), { settings: withRating, checklistEvents: checkAll(MO, '13:00') });
    expect(e.status().kind).toBe('checklist');
    expect(e.status().text).toBe('Wartet auf die Bewertung des Morgens durch einen Erwachsenen');
    expect(e.checklistView()).toMatchObject({ done: true, ratingNeeded: true, rating: null });
  });

  it('Bewertung 9/10 → Medienzeit beginnt ab der Bewertung', () => {
    const e = engine(at(MO, '13:31'), { settings: withRating, checklistEvents: checkAll(MO, '13:00'), ratings: [rating(MO, '13:30')] });
    expect(e.status().kind).toBe('allowed');
    expect(e.checklistView().rating).toMatchObject({ score: 9, person: 'Mama' });
  });

  it('Bewertung 6/10 mit 30 Min. „Sofort“ → Medien 30 Min. später', () => {
    const p = penalty(at(MO, '13:30'), ratingPenaltyMinutes(withRating, 6), 'Morgendliches Benehmen: 6/10', 'Mama');
    const e = engine(at(MO, '13:31'), {
      settings: withRating,
      checklistEvents: checkAll(MO, '13:00'),
      ratings: [rating(MO, '13:30', 6)],
      penalties: [p],
    });
    expect(e.status().text).toBe('Gesperrt bis 14:00 – Morgendliches Benehmen: 6/10 (Mama)');
  });

  it('Bewertung am Vormittag vor der Checkliste zählt auch', () => {
    const e = engine(at(MO, '12:30'), { settings: withRating, checklistEvents: checkAll(MO, '12:15'), ratings: [rating(MO, '08:00')] });
    expect(e.status().kind).toBe('allowed');
  });

  it('Abzüge nach Punkten', () => {
    expect([10, 8, 7, 6, 5, 3, 2, 1].map((x) => ratingPenaltyMinutes(withRating, x))).toEqual([0, 0, 30, 30, 60, 60, 120, 120]);
  });

  it('Pflicht gilt erst ab „ratingFrom“', () => {
    const e = engine(at(MO, '13:30'), { settings: { ...withRating, ratingFrom: DI }, checklistEvents: checkAll(MO, '13:00') });
    expect(e.status().kind).toBe('allowed');
    const di = engine(at(DI, '13:30'), { settings: { ...withRating, ratingFrom: DI }, checklistEvents: checkAll(DI, '13:00') });
    expect(di.status().kind).toBe('checklist');
  });

  it('Offline-Plan: künftige Tage brauchen Checkliste und Bewertung', () => {
    const e = engine(at(MO, '19:00'), { settings: withRating, checklistEvents: checkAll(MO, '13:00'), ratings: [rating(MO, '13:00')] });
    expect(e.plan().filter((s) => s.allowed)).toHaveLength(1);
  });
});

describe('Tageskonto (max. Laptop-Zeit pro Tag)', () => {
  const act = (date: string, from: string, to: string) => ({ from: at(date, from), to: at(date, to) });

  it('Mo: 2,5 Std. genutzt, gerade aktiv → darf noch bis 15:00', () => {
    const e = engine(at(MO, '14:30'), { checklistEvents: checkAll(MO, '11:00'), activity: [act(MO, '12:00', '14:30')] });
    expect(e.budgetView()).toMatchObject({ limitMinutes: 180, usedMinutes: 150, leftMinutes: 30 });
    expect(e.status().text).toBe('Darf bis 15:00');
    expect(e.plan().find((s) => s.kind === 'budget')).toBeTruthy();
  });

  it('Mo: 3 Std. genutzt → Tageszeit aufgebraucht', () => {
    const e = engine(at(MO, '15:31'), {
      checklistEvents: checkAll(MO, '11:00'),
      activity: [act(MO, '12:00', '13:30'), act(MO, '14:00', '15:30')],
    });
    expect(e.status().kind).toBe('budget');
    expect(e.status().text).toBe('Tageszeit aufgebraucht – wieder ab morgen 12:00');
  });

  it('Nicht aktiv: Restzeit wird angezeigt, Fenster bleibt offen', () => {
    const e = engine(at(MO, '14:00'), { checklistEvents: checkAll(MO, '11:00'), activity: [act(MO, '12:00', '13:00')] });
    expect(e.status().allowed).toBe(true);
    expect(e.status().text).toBe('Noch 2 Std. Laptop-Zeit heute (bis spätestens 20:00)');
  });

  it('Sa/So 5 Std., Ferientag unter der Woche wie Wochenende', () => {
    const holidays = [{ from: DI, to: DI, label: 'Feiertag' }];
    const e = engine(at(MO, '12:00'), { holidays });
    expect(e.budgetBase(MO)).toBe(180);
    expect(e.budgetBase(DI)).toBe(300);
    expect(e.budgetBase(SA)).toBe(300);
    expect(e.budgetBase(SO)).toBe(300);
  });

  it('Strafe „vom Tageskonto“: 1 Std. weniger heute', () => {
    const e0 = engine(at(MO, '13:00'), { checklistEvents: checkAll(MO, '11:00') });
    const split = e0.modeCSplit(60)!;
    expect(split).toEqual({ cut: 60, carry: 0 });
    const p = penalty(at(MO, '13:00'), 60, 'Rumschreien', 'Papa', { mode: 'C', ...split });
    const e = engine(at(MO, '13:01'), { checklistEvents: checkAll(MO, '11:00'), penalties: [p] });
    expect(e.budgetView()).toMatchObject({ deductedMinutes: 60, leftMinutes: 120 });
    expect(e.status().allowed).toBe(true);
    expect(e.openPenalties()[0]).toMatchObject({ mode: 'C', remainingMinutes: 60 });
  });

  it('Reicht das Konto heute nicht, wird der Rest an den nächsten Tagen abgezogen', () => {
    const e0 = engine(at(MO, '19:30'), { checklistEvents: checkAll(MO, '11:00') });
    const split = e0.modeCSplit(60)!;
    expect(split).toEqual({ cut: 30, carry: 30 });
    const p = penalty(at(MO, '19:30'), 60, 'Lügen', 'Mama', { mode: 'C', ...split });
    const di = engine(at(DI, '12:00'), { checklistEvents: [...checkAll(MO, '11:00'), ...checkAll(DI, '11:00')], penalties: [p] });
    expect(di.budgetView()).toMatchObject({ deductedMinutes: 30, leftMinutes: 150 });

    const big = penalty(at(FR, '20:00'), 600, 'Heimlich Medien genutzt', 'Papa', { mode: 'C', cut: 90, carry: 510 });
    const sa = engine(at(SA, '12:00'), { penalties: [big] });
    expect(sa.budgetView(SA)).toMatchObject({ deductedMinutes: 300, leftMinutes: 0 });
    expect(sa.budgetView(SO)).toMatchObject({ deductedMinutes: 210, leftMinutes: 90 });
    expect(sa.status().kind).toBe('budget');
  });

  it('Strafe vom Tageskonto verringern: Übertrag zuerst', () => {
    const p = penalty(at(MO, '19:30'), 60, 'Lügen', 'Mama', { mode: 'C', cut: 30, carry: 30 });
    const e = engine(at(MO, '19:40'), { checklistEvents: checkAll(MO, '11:00'), penalties: [p] });
    expect(e.reductionSplit(p, 40)).toEqual({ queueMinutes: 30, cutMinutes: 10 });
  });

  it('Sonderfreigabe zählt nicht aufs Tageskonto', () => {
    const e = engine(at(MO, '16:00'), {
      checklistEvents: checkAll(MO, '11:00'),
      activity: [act(MO, '12:00', '15:00')],
      grants: [{ id: 1, from: at(MO, '14:00'), to: at(MO, '15:00'), person: 'Mama', reason: 'Referat' }],
    });
    expect(e.budgetView()).toMatchObject({ usedMinutes: 120, leftMinutes: 60 });
  });

  it('Zusätzliche Laptop-Zeit (Bonus) an einem Tag', () => {
    const e = engine(at(MO, '12:00'), { dayChanges: [{ id: 1, ts: at(MO, '08:00'), date: MO, kind: 'bonus', minutes: 45 }] });
    expect(e.budgetBase(MO)).toBe(225);
  });

  it('Tageskonto aus (0) → keine Grenze', () => {
    const e = engine(at(MO, '15:31'), {
      settings: { ...DEFAULT_SETTINGS, ratingRequired: false, budget: { school: 0, weekend: 0, holiday: 0 } },
      checklistEvents: checkAll(MO, '11:00'),
      activity: [act(MO, '12:00', '13:30'), act(MO, '14:00', '15:30')],
    });
    expect(e.status().kind).toBe('allowed');
    expect(e.modeCSplit(30)).toBeNull();
  });
});
