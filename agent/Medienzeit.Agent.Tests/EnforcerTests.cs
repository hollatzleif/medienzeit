using Medienzeit.Agent;
using Xunit;

namespace Medienzeit.Agent.Tests;

/// <summary>Simuliert den Dienst sekundenweise ohne Windows.</summary>
internal sealed class Sim
{
    public static readonly long T0 = new DateTimeOffset(2026, 11, 9, 13, 0, 0, TimeSpan.Zero).ToUnixTimeMilliseconds(); // Mo 14:00 in Zürich
    public const long Min = 60_000;

    public long Now = T0;
    public long? LastContact = T0;
    public PollResponse Plan;
    public bool Online;
    public bool LoggedIn = true;
    public bool ScreenLocked;
    public bool ClockSuspicious;
    public bool NewContactPending = true;
    public EngineState S = new();
    public Decision? Last;
    public readonly List<(long T, AgentAction A)> Actions = new();
    private readonly Enforcer _e = new();

    public Sim(PollResponse plan) { Plan = plan; }

    public SessionState Session => !LoggedIn ? SessionState.None : ScreenLocked ? SessionState.Locked : SessionState.Active;

    public void Tick()
    {
        bool nc = NewContactPending;
        NewContactPending = false;
        if (Online && (LastContact is null || Now - LastContact >= 20_000))
        {
            LastContact = Now;
            nc = true;
        }
        var r = _e.Tick(new EnforcementInput
        {
            NowMs = Now,
            Session = Session,
            Plan = Plan,
            LastContactMs = LastContact,
            ClockSuspicious = ClockSuspicious,
            NewContact = nc,
        }, S);
        Last = r.Decision;
        foreach (var a in r.Actions)
        {
            Actions.Add((Now, a));
            if (a.Type == ActionType.Logoff) LoggedIn = false;
        }
    }

    public void RunUntil(long t)
    {
        while (Now < t)
        {
            Now += 1000;
            Tick();
        }
    }

    public IEnumerable<(long T, AgentAction A)> Of(ActionType type) => Actions.Where(x => x.A.Type == type);

    public static PollResponse MakePlan(params (int FromMin, int ToMin, bool Allowed, string Kind, string Text)[] segs) => new()
    {
        ServerTime = T0,
        Segments = segs.Select(s => new PlanSegment
        {
            From = T0 + s.FromMin * Min,
            To = T0 + s.ToMin * Min,
            Allowed = s.Allowed,
            Kind = s.Kind,
            Text = s.Text,
        }).ToList(),
        Allowed = segs.Length > 0 && segs[0].Allowed,
        Text = segs.Length > 0 ? segs[0].Text : "",
        OfflineMinutes = 240,
        WarnMinutes = 5,
        PenaltyGraceSeconds = 60,
        ReloginGraceSeconds = 15,
        Pause = new PauseInfo { ActiveMinutes = 180, BreakMinutes = 30, PauseMinutes = 30, ActiveSoFarMinutes = 0 },
    };
}

public class EnforcerTests
{
    private const long Min = Sim.Min;
    private static readonly long T0 = Sim.T0;

    [Fact]
    public void Fall10_Offline3Stunden_PlanGiltWeiter()
    {
        var sim = new Sim(Sim.MakePlan((0, 600, true, "allowed", "Darf bis 24:00")))
        {
            ScreenLocked = true, // angemeldet, aber nicht aktiv: Pausenregel spielt keine Rolle
        };
        sim.RunUntil(T0 + 180 * Min);
        Assert.True(sim.Last!.Allowed);
        Assert.Empty(sim.Of(ActionType.Logoff));
    }

    [Fact]
    public void Fall10_Offline5Stunden_Gesperrt_mitVorwarnungUndAbmeldungNach4Stunden()
    {
        var sim = new Sim(Sim.MakePlan((0, 600, true, "allowed", "Darf bis 24:00")))
        {
            ScreenLocked = true,
        };
        sim.RunUntil(T0 + 300 * Min);

        Assert.False(sim.Last!.Allowed);
        Assert.Equal("offline", sim.Last.Kind);

        var warn = Assert.Single(sim.Of(ActionType.Warning));
        Assert.Equal(T0 + 235 * Min, warn.T);
        var logoff = Assert.Single(sim.Of(ActionType.Logoff));
        Assert.Equal(T0 + 240 * Min, logoff.T);
        Assert.Empty(sim.Of(ActionType.Message)); // vorhergesehen: keine 60-Sekunden-Frist
    }

    [Fact]
    public void Vorwarnung_5MinutenVorGeplantemEnde_danachSofortAbmeldung()
    {
        var sim = new Sim(Sim.MakePlan(
            (0, 30, true, "allowed", "Darf bis 14:30"),
            (30, 600, false, "schedule", "Sperrzeit – wieder ab morgen 12:00"))) { Online = true };

        sim.RunUntil(T0 + 31 * Min);

        var warn = Assert.Single(sim.Of(ActionType.Warning));
        Assert.Equal(T0 + 25 * Min, warn.T);
        Assert.Contains("14:30", warn.A.Text);
        Assert.Contains("Sperrzeit", warn.A.Text);

        var logoff = Assert.Single(sim.Of(ActionType.Logoff));
        Assert.Equal(T0 + 30 * Min, logoff.T);
        Assert.Empty(sim.Of(ActionType.Message));
    }

    [Fact]
    public void KeineVorwarnung_wennNiemandAngemeldet()
    {
        var sim = new Sim(Sim.MakePlan(
            (0, 30, true, "allowed", "Darf bis 14:30"),
            (30, 600, false, "schedule", "Sperrzeit"))) { Online = true, LoggedIn = false };
        sim.RunUntil(T0 + 40 * Min);
        Assert.Empty(sim.Actions);
    }

    [Fact]
    public void NeueStrafe_MeldungUnd60SekundenFrist()
    {
        var sim = new Sim(Sim.MakePlan((0, 600, true, "allowed", "Darf bis 20:00"))) { Online = true };
        sim.RunUntil(T0 + 10 * Min);

        // Server meldet eine neue Strafe: ab jetzt gesperrt.
        var plan = Sim.MakePlan((0, 10, true, "allowed", "Darf"), (10, 70, false, "penalty", "Gesperrt bis 15:10 – Rumschreien (Papa)"), (70, 600, true, "allowed", "Darf bis 20:00"));
        plan.LockId = "p:42";
        sim.Plan = plan;
        sim.NewContactPending = true;
        sim.RunUntil(T0 + 10 * Min + 1000);

        var msg = Assert.Single(sim.Of(ActionType.Message));
        Assert.Contains("Rumschreien (Papa)", msg.A.Text);
        Assert.Contains("60 Sekunden", msg.A.Text);
        Assert.Empty(sim.Of(ActionType.Logoff));

        sim.RunUntil(T0 + 12 * Min);
        var logoff = Assert.Single(sim.Of(ActionType.Logoff));
        Assert.Equal(msg.T + 60_000, logoff.T);
    }

    [Fact]
    public void AnmeldungWaehrendSperre_Abmeldung_nach15Sekunden()
    {
        var sim = new Sim(Sim.MakePlan((0, 600, false, "penalty", "Gesperrt bis 18:00 – Lügen (Mama)"))) { Online = true, LoggedIn = false };
        sim.RunUntil(T0 + 5 * Min);
        Assert.Empty(sim.Actions);

        sim.LoggedIn = true;
        sim.RunUntil(T0 + 5 * Min + 1000);
        var msg = Assert.Single(sim.Of(ActionType.Message));
        Assert.Contains("15 Sekunden", msg.A.Text);
        Assert.Contains("Lügen (Mama)", msg.A.Text);

        sim.RunUntil(T0 + 6 * Min);
        var logoff = Assert.Single(sim.Of(ActionType.Logoff));
        Assert.Equal(msg.T + 15_000, logoff.T);

        // Zweite Anmeldung: wieder Meldung + 15 s
        sim.LoggedIn = true;
        sim.RunUntil(T0 + 7 * Min);
        Assert.Equal(2, sim.Of(ActionType.Message).Count());
        Assert.Equal(2, sim.Of(ActionType.Logoff).Count());
    }

    [Fact]
    public void FristWirdAbgebrochen_wennWiederErlaubt()
    {
        var sim = new Sim(Sim.MakePlan((0, 600, true, "allowed", "Darf"))) { Online = true };
        sim.RunUntil(T0 + 1 * Min);
        sim.Plan = Sim.MakePlan((0, 600, false, "penalty", "Gesperrt"));
        sim.NewContactPending = true;
        sim.RunUntil(T0 + 1 * Min + 10_000);
        sim.Plan = Sim.MakePlan((0, 600, true, "allowed", "Darf")); // Strafe aufgehoben
        sim.NewContactPending = true;
        sim.RunUntil(T0 + 5 * Min);
        Assert.Single(sim.Of(ActionType.Message));
        Assert.Empty(sim.Of(ActionType.Logoff));
        Assert.True(sim.Last!.Allowed);
    }

    [Fact]
    public void Uhrsprung_fuehrtZurSperre()
    {
        var sim = new Sim(Sim.MakePlan((0, 600, true, "allowed", "Darf"))) { ClockSuspicious = true, LoggedIn = false };
        sim.RunUntil(T0 + 1 * Min);
        Assert.False(sim.Last!.Allowed);
        Assert.Equal("offline", sim.Last.Kind);
        Assert.Contains("Uhrzeit", sim.Last.Text);
    }

    [Fact]
    public void OhneJeglichenPlan_gesperrt()
    {
        var sim = new Sim(null!) { LastContact = null, LoggedIn = false };
        sim.Plan = null!;
        sim.RunUntil(T0 + 2000);
        Assert.False(sim.Last!.Allowed);
    }

    [Fact]
    public void Offline_Pausenregel_lokalerZaehler_mitVorwarnung()
    {
        var plan = Sim.MakePlan((0, 600, true, "allowed", "Darf bis 24:00"));
        plan.Pause.ActiveSoFarMinutes = 170; // Server: schon 2:50 Std. aktiv
        var sim = new Sim(plan); // offline ab T0

        sim.RunUntil(T0 + 9 * Min);
        Assert.True(sim.Last!.Allowed);

        sim.RunUntil(T0 + 11 * Min);
        var warn = Assert.Single(sim.Of(ActionType.Warning));
        Assert.Equal(T0 + 5 * Min + 1000, warn.T); // 1 s Versatz: der Zähler beginnt mit dem ersten aktiven Tick
        Assert.Contains("Pause", warn.A.Text);

        var logoff = Assert.Single(sim.Of(ActionType.Logoff));
        Assert.Equal("pause", sim.Last!.Kind);
        Assert.InRange(logoff.T, T0 + 10 * Min, T0 + 10 * Min + 2000);

        // Ludwig meldet sich während der Pause an → 15 s
        sim.LoggedIn = true;
        sim.RunUntil(T0 + 12 * Min);
        Assert.Single(sim.Of(ActionType.Message));

        // Nach 30 Minuten Pause wieder erlaubt
        sim.LoggedIn = false;
        sim.RunUntil(T0 + 41 * Min);
        Assert.True(sim.Last!.Allowed);
    }

    [Fact]
    public void Online_keineLokalePause_derServerEntscheidet()
    {
        var plan = Sim.MakePlan((0, 600, true, "allowed", "Darf"));
        plan.Pause.ActiveSoFarMinutes = 179;
        var sim = new Sim(plan) { Online = true };
        sim.RunUntil(T0 + 20 * Min);
        Assert.True(sim.Last!.Allowed);
        Assert.Empty(sim.Of(ActionType.Logoff));
    }

    [Fact]
    public void Pausenzaehler_wirdNachLangerInaktivitaetZurueckgesetzt()
    {
        var plan = Sim.MakePlan((0, 600, true, "allowed", "Darf"));
        plan.Pause.ActiveSoFarMinutes = 170;
        var sim = new Sim(plan);
        sim.RunUntil(T0 + 2 * Min);
        sim.ScreenLocked = true; // 30 Minuten gesperrter Bildschirm = Pause
        sim.RunUntil(T0 + 33 * Min);
        sim.ScreenLocked = false;
        sim.RunUntil(T0 + 60 * Min);
        Assert.True(sim.Last!.Allowed);
        Assert.Empty(sim.Of(ActionType.Logoff));
        Assert.InRange(sim.S.LocalActiveMs, 26 * Min, 28 * Min);
    }
}

public class TimeEstimatorTests
{
    private static readonly ContactInfo Contact = new() { ServerTime = 1_000_000_000_000, Tick = 5_000_000, WallUtc = 1_000_000_030_000 };

    [Fact]
    public void Monoton_ohneNeustart()
    {
        var e = TimeEstimator.Estimate(Contact, Contact.Tick + 60_000, Contact.WallUtc + 60_000, null, true);
        Assert.Equal(Contact.ServerTime + 60_000, e.NowMs);
        Assert.False(e.Suspicious);
    }

    [Fact]
    public void Uhrsprung_ueber5Minuten_istVerdaechtig()
    {
        var e = TimeEstimator.Estimate(Contact, Contact.Tick + 60_000, Contact.WallUtc - 10 * 60_000, null, true);
        Assert.True(e.Suspicious);
        Assert.Equal(Contact.ServerTime + 60_000, e.NowMs); // monotone Uhr gewinnt
    }

    [Fact]
    public void NachNeustart_Wanduhr_mitServerKorrektur()
    {
        var e = TimeEstimator.Estimate(Contact, 10_000, Contact.WallUtc + 3_600_000, Contact.WallUtc + 600_000, false);
        Assert.Equal(Contact.ServerTime + 3_600_000, e.NowMs);
        Assert.False(e.Suspicious);
    }

    [Fact]
    public void NachNeustart_UhrZurueckgestellt_istVerdaechtig()
    {
        var e = TimeEstimator.Estimate(Contact, 10_000, Contact.WallUtc + 60_000, Contact.WallUtc + 3_600_000, false);
        Assert.True(e.Suspicious);
    }

    [Fact]
    public void Prozessneustart_ohneRechnerneustart_bleibtMonoton()
    {
        var e = TimeEstimator.Estimate(Contact, Contact.Tick + 120_000, Contact.WallUtc + 120_000, null, false);
        Assert.Equal(Contact.ServerTime + 120_000, e.NowMs);
        Assert.False(e.Suspicious);
    }
}

public class BufferTests
{
    [Fact]
    public void Aktivitaet_wirdZusammengefasst_undLueckenGetrennt()
    {
        var st = new AgentState();
        Buffers.RecordActivity(st, 1000, true);
        Buffers.RecordActivity(st, 2000, true);
        Buffers.RecordActivity(st, 3000, false);
        Buffers.RecordActivity(st, 50_000, true);   // Lücke < 60 s → gleicher Zeitraum
        Buffers.RecordActivity(st, 200_000, true);  // Lücke > 60 s → neuer Zeitraum
        Assert.Equal(2, st.PendingActivity.Count);
        Assert.Equal(1000, st.PendingActivity[0].From);
        Assert.Equal(50_000, st.PendingActivity[0].To);
    }

    [Fact]
    public void Bestaetigung_laesstWachsendenZeitraumOffen()
    {
        var st = new AgentState();
        Buffers.RecordActivity(st, 1000, true);
        Buffers.RecordActivity(st, 5000, true);
        Buffers.AddEvent(st, new AgentEvent { Ts = 1, Type = "started" });
        // gesendet: Zeitraum bis 5000; danach wächst er weiter
        Buffers.RecordActivity(st, 9000, true);
        Buffers.AddEvent(st, new AgentEvent { Ts = 2, Type = "warning" });
        Buffers.AcknowledgeSent(st, 1, 1, 5000);

        var ev = Assert.Single(st.PendingEvents);
        Assert.Equal("warning", ev.Type);
        var act = Assert.Single(st.PendingActivity);
        Assert.Equal(5000, act.From);
        Assert.Equal(9000, act.To);
    }

    [Fact]
    public void OfflineEreignis_beiWiederverbindung()
    {
        var st = new AgentState { Contact = new ContactInfo { ServerTime = 1_000_000 } };
        OfflineTracker.OnPollFailure(st, 1_020_000, 0);
        OfflineTracker.OnPollFailure(st, 1_040_000, 0);
        OfflineTracker.OnPollSuccess(st, 1_000_000 + 3 * 3_600_000);
        var ev = Assert.Single(st.PendingEvents);
        Assert.Equal("offline", ev.Type);
        Assert.Equal(1_000_000, ev.From);
    }

    [Fact]
    public void KurzerAussetzer_keinOfflineEreignis()
    {
        var st = new AgentState { Contact = new ContactInfo { ServerTime = 1_000_000 } };
        OfflineTracker.OnPollFailure(st, 1_020_000, 0);
        OfflineTracker.OnPollSuccess(st, 1_060_000);
        Assert.Empty(st.PendingEvents);
    }

    [Fact]
    public void Dienststart_meldetOfflineVorDemAusschalten()
    {
        var st = new AgentState
        {
            Contact = new ContactInfo { ServerTime = 1_000_000 },
            LastAliveMs = 1_000_000 + 600_000,
        };
        OfflineTracker.OnServiceStart(st);
        var ev = Assert.Single(st.PendingEvents);
        Assert.Equal(1_000_000 + 600_000, ev.To);
    }
}
