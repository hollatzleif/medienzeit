using System.Runtime.Versioning;

namespace Medienzeit.Agent;

/// <summary>Hilfsbefehle für Leif zum Prüfen (als Administrator in einer Konsole ausführen).</summary>
[SupportedOSPlatform("windows")]
internal static class Diagnostics
{
    /// <summary>Medienzeit.Agent.exe --sessions : zeigt alle Sitzungen und ob sie zum Kind-Konto gehören.</summary>
    public static int PrintSessions(string dir)
    {
        ChildAccount? child = null;
        try { child = new ChildAccount(AgentConfig.Load(dir).ChildAccount); }
        catch (Exception ex) { Console.WriteLine($"(Konfiguration nicht lesbar: {ex.Message})"); }

        foreach (var s in Wts.EnumerateSessions())
        {
            string mark = child?.Matches(s.User, s.Domain) == true ? "  <-- Kind-Konto" : "";
            string lockState = s.Unlocked switch { true => "entsperrt", false => "gesperrt", _ => "unbekannt" };
            Console.WriteLine($"Sitzung {s.Id}: {s.Domain}\\{s.User}, {s.State}, {lockState}{mark}");
        }
        return 0;
    }

    /// <summary>Medienzeit.Agent.exe --check : prüft Konfiguration, Kind-Konto und Server-Verbindung.</summary>
    public static async Task<int> CheckAsync(string dir)
    {
        AgentConfig cfg;
        try
        {
            cfg = AgentConfig.Load(dir);
            Console.WriteLine($"Konfiguration ok. Server: {cfg.ServerUrl}, Kind-Konto: {cfg.ChildAccount}");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"FEHLER Konfiguration: {ex.Message}");
            return 2;
        }

        var child = new ChildAccount(cfg.ChildAccount);
        try { Console.WriteLine($"Kind-Konto gefunden, SID {child.ResolveSid()}"); }
        catch (Exception ex) { Console.WriteLine($"FEHLER Kind-Konto: {ex.Message}"); }
        try { Console.WriteLine(child.IsLocalAdmin() ? "FEHLER: Kind-Konto ist Administrator!" : "Kind-Konto ist Standardbenutzer. Gut."); }
        catch (Exception ex) { Console.WriteLine($"Admin-Prüfung nicht möglich: {ex.Message}"); }

        using var client = new ServerClient(cfg);
        var (resp, err) = await client.PollAsync(new PollRequest { AgentVersion = AgentInfo.Version, Session = "none" }, CancellationToken.None);
        if (resp is null)
        {
            Console.WriteLine($"FEHLER Server: {err}");
            return 3;
        }
        Console.WriteLine($"Server ok. Status: {(resp.Allowed ? "erlaubt" : "gesperrt")} – {resp.Text}");
        foreach (var seg in resp.Segments)
            Console.WriteLine($"  {LocalTime.ToLocal(seg.From):dd.MM. HH:mm} – {LocalTime.ToLocal(seg.To):dd.MM. HH:mm}  {(seg.Allowed ? "erlaubt" : "gesperrt")}  {seg.Text}");
        return 0;
    }
}
