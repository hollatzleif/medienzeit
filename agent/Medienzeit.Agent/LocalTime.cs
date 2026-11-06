namespace Medienzeit.Agent;

/// <summary>Formatiert Zeiten immer in Europe/Zurich, egal welche Zeitzone am Laptop eingestellt ist.</summary>
public static class LocalTime
{
    private static readonly TimeZoneInfo Zone = Find();

    private static TimeZoneInfo Find()
    {
        foreach (var id in new[] { "Europe/Zurich", "W. Europe Standard Time" })
        {
            try { return TimeZoneInfo.FindSystemTimeZoneById(id); }
            catch { /* nächste Kennung probieren */ }
        }
        return TimeZoneInfo.Utc;
    }

    public static DateTime ToLocal(long ms) =>
        TimeZoneInfo.ConvertTimeFromUtc(DateTimeOffset.FromUnixTimeMilliseconds(ms).UtcDateTime, Zone);

    public static string Hm(long ms) => ToLocal(ms).ToString("HH:mm");
}
