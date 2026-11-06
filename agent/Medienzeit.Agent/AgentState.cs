using System.Text.Json;

namespace Medienzeit.Agent;

/// <summary>Alles, was zwischen Neustarts erhalten bleiben muss (state.json).</summary>
public sealed class AgentState
{
    public PollResponse? Plan { get; set; }
    public ContactInfo? Contact { get; set; }
    /// <summary>geschätzte Serverzeit beim letzten Speichern</summary>
    public long? LastAliveMs { get; set; }
    /// <summary>Wanduhr beim letzten Speichern</summary>
    public long? LastAliveWallUtc { get; set; }
    /// <summary>seit wann keine Verbindung besteht (während der Dienst lief)</summary>
    public long? OfflineSinceMs { get; set; }
    public List<AgentEvent> PendingEvents { get; set; } = new();
    public List<TimeRange> PendingActivity { get; set; } = new();
    public EngineState Engine { get; set; } = new();
}

/// <summary>Puffer für Ereignisse und Aktivität bis zur nächsten erfolgreichen Anfrage.</summary>
public static class Buffers
{
    public const int MaxEvents = 500;
    public const int MaxActivity = 2000;
    public const long ActivityJoinMs = 60_000;

    public static void AddEvent(AgentState st, AgentEvent ev)
    {
        st.PendingEvents.Add(ev);
        if (st.PendingEvents.Count > MaxEvents)
            st.PendingEvents.RemoveRange(0, st.PendingEvents.Count - MaxEvents);
    }

    /// <summary>Hält aktive Zeiträume fest. Lücken bis 60 s werden überbrückt.</summary>
    public static void RecordActivity(AgentState st, long now, bool active)
    {
        if (!active) return;
        var list = st.PendingActivity;
        if (list.Count > 0)
        {
            var last = list[^1];
            if (now >= last.From && now - last.To <= ActivityJoinMs)
            {
                if (now > last.To) last.To = now;
                return;
            }
        }
        list.Add(new TimeRange { From = now, To = now });
        if (list.Count > MaxActivity) list.RemoveRange(0, list.Count - MaxActivity);
    }

    /// <summary>Nach erfolgreicher Anfrage: gesendete Einträge entfernen. Der letzte Aktivitätszeitraum bleibt offen, wenn er noch wächst.</summary>
    public static void AcknowledgeSent(AgentState st, int eventCount, int activityCount, long lastActivityToSent)
    {
        st.PendingEvents.RemoveRange(0, Math.Min(eventCount, st.PendingEvents.Count));
        int n = Math.Min(activityCount, st.PendingActivity.Count);
        if (n > 0)
        {
            var lastSent = st.PendingActivity[n - 1];
            bool stillGrowing = lastSent.To > lastActivityToSent;
            st.PendingActivity.RemoveRange(0, stillGrowing ? n - 1 : n);
            if (stillGrowing && st.PendingActivity.Count > 0)
                st.PendingActivity[0].From = lastActivityToSent;
        }
    }
}

/// <summary>Erkennt Offline-Zeiten, in denen der Dienst lief, und meldet sie bei Wiederverbindung.</summary>
public static class OfflineTracker
{
    public const long MinOfflineMs = 90_000;

    /// <summary>Beim Dienststart: War der Laptop vor dem Herunterfahren offline?</summary>
    public static void OnServiceStart(AgentState st)
    {
        if (st.Contact is { } c && st.LastAliveMs is long alive)
        {
            long from = Math.Max(c.ServerTime, st.OfflineSinceMs ?? c.ServerTime);
            if (alive - from > MinOfflineMs)
            {
                Buffers.AddEvent(st, new AgentEvent
                {
                    Ts = alive, Type = "offline", From = from, To = alive,
                    Text = "Laptop lief ohne Verbindung (bis zum Ausschalten oder Neustart)",
                });
            }
        }
        st.OfflineSinceMs = null;
    }

    public static void OnPollFailure(AgentState st, long now, long runStartMs)
    {
        if (st.OfflineSinceMs is null)
        {
            long since = st.Contact?.ServerTime ?? now;
            st.OfflineSinceMs = Math.Max(since, runStartMs);
        }
    }

    public static void OnPollSuccess(AgentState st, long serverNow)
    {
        if (st.OfflineSinceMs is long since && serverNow - since > MinOfflineMs)
        {
            Buffers.AddEvent(st, new AgentEvent
            {
                Ts = serverNow, Type = "offline", From = since, To = serverNow,
                Text = "Laptop lief ohne Verbindung zum Server",
            });
        }
        st.OfflineSinceMs = null;
    }
}

/// <summary>Liest und schreibt state.json und config.json robust (kaputte Dateien führen zu Standardwerten).</summary>
public sealed class StateStore
{
    private readonly string _path;
    public StateStore(string dir) => _path = Path.Combine(dir, "state.json");

    public AgentState Load(Action<string>? warn = null)
    {
        try
        {
            if (!File.Exists(_path)) return new AgentState();
            var st = JsonSerializer.Deserialize<AgentState>(File.ReadAllText(_path), Json.Options);
            return st ?? new AgentState();
        }
        catch (Exception ex)
        {
            warn?.Invoke($"state.json unlesbar, starte mit leerem Zustand: {ex.Message}");
            return new AgentState();
        }
    }

    public void Save(AgentState st)
    {
        string tmp = _path + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(st, Json.Options));
        File.Move(tmp, _path, overwrite: true);
    }
}

public sealed class AgentConfig
{
    public string ServerUrl { get; set; } = "";
    public string DeviceToken { get; set; } = "";
    public string ChildAccount { get; set; } = "";
    public int PollSeconds { get; set; } = 20;

    public static AgentConfig Load(string dir)
    {
        string path = Path.Combine(dir, "config.json");
        if (!File.Exists(path)) throw new InvalidOperationException($"Konfiguration fehlt: {path}");
        var cfg = JsonSerializer.Deserialize<AgentConfig>(File.ReadAllText(path), Json.Options)
                  ?? throw new InvalidOperationException("config.json ist leer.");
        cfg.Validate();
        return cfg;
    }

    public void Validate()
    {
        if (!Uri.TryCreate(ServerUrl, UriKind.Absolute, out var u) || (u.Scheme != "https" && u.Scheme != "http"))
            throw new InvalidOperationException("serverUrl fehlt oder ist ungültig.");
        if (string.IsNullOrWhiteSpace(DeviceToken)) throw new InvalidOperationException("deviceToken fehlt.");
        if (string.IsNullOrWhiteSpace(ChildAccount)) throw new InvalidOperationException("childAccount fehlt.");
        PollSeconds = Math.Clamp(PollSeconds, 5, 120);
    }

    public static string DefaultDir()
    {
        var env = Environment.GetEnvironmentVariable("MEDIENZEIT_DIR");
        if (!string.IsNullOrWhiteSpace(env)) return env;
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Medienzeit");
    }
}
