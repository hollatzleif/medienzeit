namespace Medienzeit.Agent;

/// <summary>Letzter erfolgreicher Kontakt zum Server.</summary>
public sealed class ContactInfo
{
    /// <summary>Serverzeit (ms UTC) laut Antwort.</summary>
    public long ServerTime { get; set; }
    /// <summary>Environment.TickCount64 im Moment der Antwort.</summary>
    public long Tick { get; set; }
    /// <summary>Wanduhr des Laptops (ms UTC) im Moment der Antwort.</summary>
    public long WallUtc { get; set; }
}

public readonly record struct TimeEstimate(long NowMs, bool Suspicious);

/// <summary>
/// Schätzt die aktuelle Zeit. Grundlage ist immer die Serverzeit beim letzten Kontakt.
/// Weitergezählt wird mit der monotonen Uhr (TickCount64). Nach einem Neustart, wenn die
/// monotone Uhr wieder bei null beginnt, wird die Wanduhr genommen und auf Rücksprünge geprüft.
/// </summary>
public static class TimeEstimator
{
    public const long MaxDriftMs = 5 * 60_000;

    /// <param name="contact">letzter Kontakt oder null</param>
    /// <param name="tick">aktuelles TickCount64</param>
    /// <param name="wallUtc">aktuelle Wanduhr in ms UTC</param>
    /// <param name="lastAliveWallUtc">Wanduhr beim letzten Speichern des Zustands (vor einem Neustart)</param>
    /// <param name="contactInThisProcess">true, wenn der Kontakt im laufenden Prozess stattfand (dann sicher kein Neustart dazwischen)</param>
    public static TimeEstimate Estimate(ContactInfo? contact, long tick, long wallUtc, long? lastAliveWallUtc, bool contactInThisProcess)
    {
        if (contact is null)
            return new TimeEstimate(wallUtc, false);

        bool rebooted;
        if (tick < contact.Tick)
        {
            rebooted = true;
        }
        else if (contactInThisProcess)
        {
            rebooted = false;
        }
        else
        {
            // Prozess wurde neu gestartet. Lag ein Neustart des Rechners dazwischen?
            // Wir vergleichen den geschätzten Bootzeitpunkt. Weicht er deutlich ab, war es ein Neustart.
            long bootThen = contact.WallUtc - contact.Tick;
            long bootNow = wallUtc - tick;
            rebooted = Math.Abs(bootNow - bootThen) > 10 * 60_000;
        }

        if (!rebooted)
        {
            long mono = contact.ServerTime + (tick - contact.Tick);
            long wallEst = contact.ServerTime + (wallUtc - contact.WallUtc);
            bool suspicious = Math.Abs(wallEst - mono) > MaxDriftMs;
            return new TimeEstimate(mono, suspicious);
        }

        long now = contact.ServerTime + (wallUtc - contact.WallUtc);
        bool back = wallUtc < contact.WallUtc - MaxDriftMs
                    || (lastAliveWallUtc is long alive && wallUtc < alive - MaxDriftMs);
        return new TimeEstimate(now, back);
    }
}
