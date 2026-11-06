using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace Medienzeit.Agent;

public sealed class ServerClient : IDisposable
{
    private readonly HttpClient _http;
    private readonly Uri _endpoint;

    public ServerClient(AgentConfig cfg)
    {
        _http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", cfg.DeviceToken);
        _http.DefaultRequestHeaders.UserAgent.ParseAdd($"MedienzeitAgent/{AgentInfo.Version}");
        _endpoint = new Uri(cfg.ServerUrl.TrimEnd('/') + "/api/device/poll");
    }

    /// <summary>Sendet eine Abfrage. Gibt null zurück bei Netzwerkfehlern, falschem Token oder kaputter Antwort.</summary>
    public async Task<(PollResponse? Response, string? Error)> PollAsync(PollRequest req, CancellationToken ct)
    {
        try
        {
            var body = new StringContent(JsonSerializer.Serialize(req, Json.Options), Encoding.UTF8, "application/json");
            using var resp = await _http.PostAsync(_endpoint, body, ct).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode)
                return (null, $"HTTP {(int)resp.StatusCode}");
            string text = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            var parsed = JsonSerializer.Deserialize<PollResponse>(text, Json.Options);
            if (parsed is null || parsed.ServerTime <= 0)
                return (null, "Antwort ohne serverTime");
            return (parsed, null);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            return (null, "Zeitüberschreitung");
        }
        catch (HttpRequestException ex)
        {
            return (null, ex.Message);
        }
        catch (JsonException ex)
        {
            return (null, "Antwort unlesbar: " + ex.Message);
        }
    }

    public void Dispose() => _http.Dispose();
}

public static class AgentInfo
{
    public static string Version =>
        typeof(AgentInfo).Assembly.GetName().Version?.ToString(3) ?? "1.0.0";
}
