using System.Text.Json;
using System.Text.Json.Serialization;

namespace Medienzeit.Agent;

/// <summary>Zustand der Sitzung des Kind-Kontos (siehe docs/geraete-api.md).</summary>
public enum SessionState
{
    /// <summary>nicht angemeldet</summary>
    None,
    /// <summary>angemeldet und entsperrt</summary>
    Active,
    /// <summary>angemeldet, aber gesperrt oder getrennt</summary>
    Locked,
}

public sealed class TimeRange
{
    public long From { get; set; }
    public long To { get; set; }
}

public sealed class AgentEvent
{
    public long Ts { get; set; }
    public string Type { get; set; } = "";
    public long? From { get; set; }
    public long? To { get; set; }
    public string? Text { get; set; }
}

public sealed class PollRequest
{
    public string AgentVersion { get; set; } = "";
    public string Session { get; set; } = "none";
    public List<TimeRange> Activity { get; set; } = new();
    public List<AgentEvent> Events { get; set; } = new();
}

public sealed class PlanSegment
{
    public long From { get; set; }
    public long To { get; set; }
    public bool Allowed { get; set; }
    public string Kind { get; set; } = "";
    public string Text { get; set; } = "";
}

public sealed class PauseInfo
{
    public int ActiveMinutes { get; set; } = 180;
    public int BreakMinutes { get; set; } = 30;
    public int PauseMinutes { get; set; } = 30;
    public int ActiveSoFarMinutes { get; set; }
}

public sealed class PollResponse
{
    public long ServerTime { get; set; }
    public bool Allowed { get; set; }
    public string Text { get; set; } = "";
    public string Kind { get; set; } = "";
    public string? LockId { get; set; }
    public List<PlanSegment> Segments { get; set; } = new();
    public int OfflineMinutes { get; set; } = 240;
    public int WarnMinutes { get; set; } = 5;
    public int PenaltyGraceSeconds { get; set; } = 60;
    public int ReloginGraceSeconds { get; set; } = 15;
    public PauseInfo Pause { get; set; } = new();
}

public static class Json
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = false,
    };

    public static readonly JsonSerializerOptions Indented = new(Options) { WriteIndented = true };

    public static string SessionToWire(SessionState s) => s switch
    {
        SessionState.Active => "active",
        SessionState.Locked => "locked",
        _ => "none",
    };
}
