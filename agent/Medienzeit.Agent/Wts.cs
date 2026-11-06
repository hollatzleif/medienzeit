using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace Medienzeit.Agent;

/// <summary>P/Invoke auf die Windows-Terminaldienste-API (wtsapi32). Funktioniert auf Home und Pro.</summary>
[SupportedOSPlatform("windows")]
internal static class Wts
{
    public static readonly IntPtr CurrentServer = IntPtr.Zero;

    public enum ConnectState
    {
        Active = 0, Connected = 1, ConnectQuery = 2, Shadow = 3, Disconnected = 4,
        Idle = 5, Listen = 6, Reset = 7, Down = 8, Init = 9,
    }

    public enum InfoClass
    {
        UserName = 5,
        DomainName = 7,
        SessionInfoEx = 25,
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WTS_SESSION_INFO
    {
        public int SessionId;
        public IntPtr pWinStationName;
        public ConnectState State;
    }

    [DllImport("wtsapi32.dll", SetLastError = true, CharSet = CharSet.Unicode, EntryPoint = "WTSEnumerateSessionsW")]
    private static extern bool WTSEnumerateSessions(IntPtr hServer, int reserved, int version, out IntPtr ppSessionInfo, out int count);

    [DllImport("wtsapi32.dll", SetLastError = true, CharSet = CharSet.Unicode, EntryPoint = "WTSQuerySessionInformationW")]
    private static extern bool WTSQuerySessionInformation(IntPtr hServer, int sessionId, InfoClass infoClass, out IntPtr buffer, out int bytes);

    [DllImport("wtsapi32.dll")]
    private static extern void WTSFreeMemory(IntPtr memory);

    [DllImport("wtsapi32.dll", SetLastError = true, CharSet = CharSet.Unicode, EntryPoint = "WTSSendMessageW")]
    private static extern bool WTSSendMessage(IntPtr hServer, int sessionId, string title, int titleLength,
        string message, int messageLength, int style, int timeout, out int response, bool wait);

    [DllImport("wtsapi32.dll", SetLastError = true)]
    private static extern bool WTSLogoffSession(IntPtr hServer, int sessionId, bool wait);

    public sealed record SessionInfo(int Id, ConnectState State, string User, string Domain, bool? Unlocked);

    public static List<SessionInfo> EnumerateSessions()
    {
        var result = new List<SessionInfo>();
        if (!WTSEnumerateSessions(CurrentServer, 0, 1, out var ptr, out int count))
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "WTSEnumerateSessions fehlgeschlagen");
        try
        {
            int size = Marshal.SizeOf<WTS_SESSION_INFO>();
            for (int i = 0; i < count; i++)
            {
                var info = Marshal.PtrToStructure<WTS_SESSION_INFO>(ptr + i * size);
                if (info.SessionId == 0 || info.State == ConnectState.Listen) continue;
                string user = QueryString(info.SessionId, InfoClass.UserName);
                if (string.IsNullOrEmpty(user)) continue;
                string domain = QueryString(info.SessionId, InfoClass.DomainName);
                result.Add(new SessionInfo(info.SessionId, info.State, user, domain, QueryUnlocked(info.SessionId)));
            }
        }
        finally
        {
            WTSFreeMemory(ptr);
        }
        return result;
    }

    private static string QueryString(int sessionId, InfoClass cls)
    {
        if (!WTSQuerySessionInformation(CurrentServer, sessionId, cls, out var buf, out _)) return "";
        try { return Marshal.PtrToStringUni(buf) ?? ""; }
        finally { WTSFreeMemory(buf); }
    }

    /// <summary>
    /// Sperrstatus über WTSSessionInfoEx. WTSINFOEXW: DWORD Level, danach die Union (8-Byte-ausgerichtet wegen LARGE_INTEGER).
    /// WTSINFOEX_LEVEL1_W beginnt mit SessionId, SessionState, SessionFlags.
    /// SessionFlags: 0 = WTS_SESSIONSTATE_LOCK, 1 = WTS_SESSIONSTATE_UNLOCK (gilt so ab Windows 8/10).
    /// </summary>
    private static bool? QueryUnlocked(int sessionId)
    {
        if (!WTSQuerySessionInformation(CurrentServer, sessionId, InfoClass.SessionInfoEx, out var buf, out int bytes)) return null;
        try
        {
            if (bytes < 20) return null;
            int level = Marshal.ReadInt32(buf, 0);
            if (level != 1) return null;
            int flags = Marshal.ReadInt32(buf, 16);
            return flags switch
            {
                1 => true,
                0 => false,
                _ => null,
            };
        }
        finally
        {
            WTSFreeMemory(buf);
        }
    }

    // MessageBox-Stile
    private const int MB_OK = 0x0;
    private const int MB_ICONWARNING = 0x30;
    private const int MB_SYSTEMMODAL = 0x1000;
    private const int MB_SETFOREGROUND = 0x10000;
    private const int MB_TOPMOST = 0x40000;

    public static bool SendMessage(int sessionId, string title, string message, int timeoutSeconds)
    {
        return WTSSendMessage(CurrentServer, sessionId, title, title.Length * 2, message, message.Length * 2,
            MB_OK | MB_ICONWARNING | MB_SYSTEMMODAL | MB_SETFOREGROUND | MB_TOPMOST,
            Math.Max(0, timeoutSeconds), out _, false);
    }

    public static bool Logoff(int sessionId) => WTSLogoffSession(CurrentServer, sessionId, false);
}
