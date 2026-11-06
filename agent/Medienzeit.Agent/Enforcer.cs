namespace Medienzeit.Agent;

public enum ActionType
{
    /// <summary>Meldung an Ludwig (Sperre mit Gnadenfrist)</summary>
    Message,
    /// <summary>Vorwarnung vor einem geplanten Ende</summary>
    Warning,
    /// <summary>Ludwig abmelden</summary>
    Logoff,
}

public sealed record AgentAction(ActionType Type, string Text, int TimeoutSeconds = 0);

public sealed record Decision(bool Allowed, string Kind, string Text);

public sealed class EnforcementResult
{
    public required Decision Decision { get; init; }
    public List<AgentAction> Actions { get; } = new();
}

/// <summary>Merkzettel der Entscheidungslogik, wird mit dem Cache gespeichert.</summary>
public sealed class EngineState
{
    public long? LastTickMs { get; set; }
    public bool? WasAllowed { get; set; }
    public bool PrevActive { get; set; }
    /// <summary>Ende, für das zuletzt eine Vorwarnung gezeigt wurde.</summary>
    public long? WarnedEndMs { get; set; }
    public long? PendingLogoffAtMs { get; set; }
    public string? PendingText { get; set; }
    public long? LastLogoffAtMs { get; set; }
    /// <summary>Aktive Zeit seit der letzten ausreichend langen Pause (lokaler Zähler).</summary>
    public long LocalActiveMs { get; set; }
    public long? LastActiveMs { get; set; }
    public long? OfflinePauseUntilMs { get; set; }
}

public sealed class EnforcementInput
{
    /// <summary>geschätzte aktuelle Zeit (ms UTC)</summary>
    public long NowMs { get; init; }
    public SessionState Session { get; init; }
    /// <summary>zuletzt geladener Plan</summary>
    public PollResponse? Plan { get; init; }
    /// <summary>Serverzeit des letzten erfolgreichen Kontakts</summary>
    public long? LastContactMs { get; init; }
    /// <summary>Uhr wirkt manipuliert</summary>
    public bool ClockSuspicious { get; init; }
    /// <summary>Seit dem letzten Tick kam eine neue Antwort vom Server.</summary>
    public bool NewContact { get; init; }
}

/// <summary>
/// Reine Entscheidungslogik: Aus Plan, Uhrzeit und Sitzungszustand ergibt sich, ob Ludwig darf
/// und welche Meldungen bzw. Abmeldungen nötig sind. Keine Windows-Aufrufe, voll testbar.
/// Wird etwa einmal pro Sekunde aufgerufen.
/// </summary>
public sealed class Enforcer
{
    /// <summary>Ohne Kontakt seit so vielen ms gilt der Laptop als offline (lokale Pausenregel greift).</summary>
    public const long OnlineWindowMs = 90_000;
    private const long MaxTickGapMs = 60_000;
    private const long LogoffSettleMs = 20_000;
    private const long ExpectedToleranceMs = 60_000;

    public EnforcementResult Tick(EnforcementInput input, EngineState s)
    {
        long now = input.NowMs;
        var plan = input.Plan;
        var pause = plan?.Pause ?? new PauseInfo();
        long activeLimitMs = Math.Max(1, pause.ActiveMinutes) * 60_000L;
        long breakMs = Math.Max(1, pause.BreakMinutes) * 60_000L;
        long pauseMs = Math.Max(1, pause.PauseMinutes) * 60_000L;
        long warnMs = (plan?.WarnMinutes ?? 5) * 60_000L;

        long dt = s.LastTickMs is long lt ? now - lt : 0;
        bool gap = dt < 0 || dt > MaxTickGapMs;
        if (gap) dt = 0;

        bool online = input.LastContactMs is long lc && now - lc <= OnlineWindowMs && !input.ClockSuspicious;

        if (input.NewContact && plan is not null)
        {
            // Der Server ist maßgeblich: Zähler übernehmen, lokale Offline-Pause verwerfen.
            s.LocalActiveMs = Math.Max(0, pause.ActiveSoFarMinutes) * 60_000L;
            s.OfflinePauseUntilMs = null;
        }

        var decision = BaseDecision(input);

        // --- Aktivitätszähler für die Pausenregel ---
        bool active = input.Session == SessionState.Active;
        if (active)
        {
            if (s.LastActiveMs is long la && now - la >= breakMs) s.LocalActiveMs = 0;
            if (s.PrevActive && !gap) s.LocalActiveMs += dt;
            s.LastActiveMs = now;
        }
        else if (s.LastActiveMs is long la2 && now - la2 >= breakMs)
        {
            s.LocalActiveMs = 0;
        }
        s.PrevActive = active;

        // --- Pausenregel offline (online rechnet der Server) ---
        if (s.OfflinePauseUntilMs is long done && now >= done) s.OfflinePauseUntilMs = null;
        if (!online && decision.Allowed)
        {
            if (s.OfflinePauseUntilMs is null && s.LocalActiveMs >= activeLimitMs)
            {
                s.OfflinePauseUntilMs = now + pauseMs;
                s.LocalActiveMs = 0;
            }
            if (s.OfflinePauseUntilMs is long pu)
                decision = new Decision(false, "pause", $"Pause bis {LocalTime.Hm(pu)}");
        }

        var result = new EnforcementResult { Decision = decision };
        bool loggedIn = input.Session != SessionState.None;

        // --- Vorwarnung ---
        if (decision.Allowed && loggedIn)
        {
            var (runEnd, after) = AllowedRunEnd(input, plan, now);
            if (!online && active)
            {
                long pauseAt = now + Math.Max(0, activeLimitMs - s.LocalActiveMs);
                if (pauseAt < runEnd)
                {
                    runEnd = pauseAt;
                    after = $"Danach ist {pause.PauseMinutes} Minuten Pause.";
                }
            }

            long rem = runEnd - now;
            bool alreadyWarned = s.WarnedEndMs is long w && Math.Abs(w - runEnd) <= ExpectedToleranceMs;
            if (rem > 0 && rem <= warnMs + 500 && !alreadyWarned)
            {
                long minutes = Math.Max(1, (rem + 59_999) / 60_000);
                string text = $"In {minutes} {(minutes == 1 ? "Minute" : "Minuten")} endet deine Medienzeit (um {LocalTime.Hm(runEnd)}). Bitte jetzt speichern!";
                if (!string.IsNullOrWhiteSpace(after)) text += "\n\n" + after;
                result.Actions.Add(new AgentAction(ActionType.Warning, text, (int)Math.Min(rem / 1000, 300)));
                s.WarnedEndMs = runEnd;
            }
        }

        // --- Sperren und Abmelden ---
        if (decision.Allowed)
        {
            s.PendingLogoffAtMs = null;
            s.PendingText = null;
        }
        else if (!loggedIn)
        {
            s.PendingLogoffAtMs = null;
            s.PendingText = null;
        }
        else if (s.PendingLogoffAtMs is long pa)
        {
            if (now >= pa)
            {
                result.Actions.Add(new AgentAction(ActionType.Logoff, s.PendingText ?? decision.Text));
                s.PendingLogoffAtMs = null;
                s.PendingText = null;
                s.LastLogoffAtMs = now;
            }
        }
        else if (s.LastLogoffAtMs is long ll && now - ll >= 0 && now - ll < LogoffSettleMs)
        {
            // Abmeldung läuft noch, kurz abwarten.
        }
        else if (s.WasAllowed == true)
        {
            bool expected = s.WarnedEndMs is long w && Math.Abs(w - now) <= ExpectedToleranceMs;
            if (expected)
            {
                result.Actions.Add(new AgentAction(ActionType.Logoff, decision.Text));
                s.LastLogoffAtMs = now;
            }
            else
            {
                int grace = plan?.PenaltyGraceSeconds ?? 60;
                result.Actions.Add(new AgentAction(ActionType.Message,
                    $"{decision.Text}\n\nDu hast noch {grace} Sekunden zum Speichern, dann wirst du abgemeldet.", grace));
                s.PendingLogoffAtMs = now + grace * 1000L;
                s.PendingText = decision.Text;
            }
        }
        else
        {
            // Anmeldung während einer Sperre (oder Dienststart während Ludwig angemeldet ist).
            int grace = plan?.ReloginGraceSeconds ?? 15;
            result.Actions.Add(new AgentAction(ActionType.Message,
                $"{decision.Text}\n\nDu wirst in {grace} Sekunden abgemeldet.", grace));
            s.PendingLogoffAtMs = now + grace * 1000L;
            s.PendingText = decision.Text;
        }

        s.WasAllowed = decision.Allowed;
        s.LastTickMs = now;
        return result;
    }

    internal static Decision BaseDecision(EnforcementInput input)
    {
        long now = input.NowMs;
        var plan = input.Plan;
        if (plan is null || input.LastContactMs is not long lastContact)
            return new Decision(false, "offline", "Noch keine Verbindung zum Server – Laptop gesperrt.");

        if (input.ClockSuspicious)
            return new Decision(false, "offline", "Die Uhrzeit des Laptops stimmt nicht – Laptop gesperrt, bis wieder eine Verbindung zum Server besteht.");

        long offlineMs = Math.Max(1, plan.OfflineMinutes) * 60_000L;
        if (now - lastContact >= offlineMs)
            return new Decision(false, "offline", $"Seit über {FormatDuration(plan.OfflineMinutes)} keine Verbindung zum Server – Laptop gesperrt.");

        var seg = FindSegment(plan, now);
        if (seg is null)
        {
            if (plan.Segments.Count == 0 && now - plan.ServerTime <= OnlineWindowMs)
                return new Decision(plan.Allowed, plan.Kind, plan.Text);
            return new Decision(false, "offline", "Kein gültiger Plan – Laptop gesperrt.");
        }
        return new Decision(seg.Allowed, seg.Kind, seg.Text);
    }

    internal static PlanSegment? FindSegment(PollResponse plan, long now)
    {
        foreach (var seg in plan.Segments)
            if (seg.From <= now && now < seg.To) return seg;
        return null;
    }

    /// <summary>Ende des zusammenhängenden erlaubten Abschnitts ab jetzt, inklusive Offline-Grenze.</summary>
    private static (long End, string? After) AllowedRunEnd(EnforcementInput input, PollResponse? plan, long now)
    {
        if (plan is null) return (now, null);
        long end = long.MaxValue;
        string? after = null;

        var segs = plan.Segments.OrderBy(x => x.From).ToList();
        int i = segs.FindIndex(x => x.From <= now && now < x.To);
        if (i >= 0)
        {
            end = segs[i].To;
            int j = i + 1;
            while (j < segs.Count && segs[j].Allowed && segs[j].From <= end)
            {
                end = Math.Max(end, segs[j].To);
                j++;
            }
            if (j < segs.Count && !segs[j].Allowed) after = "Danach: " + segs[j].Text;
            else if (j >= segs.Count) end = long.MaxValue; // Planende ist kein echtes Ende
        }

        if (input.LastContactMs is long lc)
        {
            long offlineEnd = lc + Math.Max(1, plan.OfflineMinutes) * 60_000L;
            if (offlineEnd < end)
            {
                end = offlineEnd;
                after = "Grund: keine Verbindung zum Server.";
            }
        }
        return (end, after);
    }

    private static string FormatDuration(int minutes)
    {
        if (minutes % 60 == 0)
        {
            int h = minutes / 60;
            return h == 1 ? "1 Stunde" : $"{h} Stunden";
        }
        return $"{minutes} Minuten";
    }
}
