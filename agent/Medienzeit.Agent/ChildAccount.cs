using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.Principal;

namespace Medienzeit.Agent;

/// <summary>Das zu überwachende Kind-Konto: Erkennung der Sitzungen, Admin-Prüfung.</summary>
[SupportedOSPlatform("windows")]
public sealed class ChildAccount
{
    public string User { get; }
    public string? Domain { get; }
    public string? Sid { get; private set; }

    public ChildAccount(string configured)
    {
        var parts = configured.Trim().Split('\\', 2);
        if (parts.Length == 2) { Domain = parts[0]; User = parts[1]; }
        else { User = parts[0]; }
    }

    /// <summary>Löst die SID auf. Wirft, wenn das Konto nicht existiert.</summary>
    public string ResolveSid()
    {
        string name = Domain is null ? $"{Environment.MachineName}\\{User}" : $"{Domain}\\{User}";
        try
        {
            Sid = new NTAccount(name).Translate(typeof(SecurityIdentifier)).Value;
        }
        catch (IdentityNotMappedException)
        {
            Sid = new NTAccount(User).Translate(typeof(SecurityIdentifier)).Value;
        }
        return Sid;
    }

    public bool Matches(string user, string domain)
    {
        if (!string.Equals(user, User, StringComparison.OrdinalIgnoreCase)) return false;
        if (Domain is null) return true;
        return string.Equals(domain, Domain, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Prüft, ob das Konto (direkt oder indirekt) zur lokalen Administratorengruppe gehört.</summary>
    public bool IsLocalAdmin()
    {
        string adminGroup = new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null)
            .Translate(typeof(NTAccount)).Value;
        int slash = adminGroup.IndexOf('\\');
        if (slash >= 0) adminGroup = adminGroup[(slash + 1)..];

        string name = Domain is null ? User : $"{Domain}\\{User}";
        int rc = NetUserGetLocalGroups(null, name, 0, LG_INCLUDE_INDIRECT, out var buf, -1, out int read, out _);
        if (rc != 0)
            throw new System.ComponentModel.Win32Exception(rc, "NetUserGetLocalGroups fehlgeschlagen");
        try
        {
            int size = IntPtr.Size;
            for (int i = 0; i < read; i++)
            {
                var p = Marshal.ReadIntPtr(buf, i * size);
                string? g = Marshal.PtrToStringUni(p);
                if (string.Equals(g, adminGroup, StringComparison.OrdinalIgnoreCase)) return true;
            }
            return false;
        }
        finally
        {
            NetApiBufferFree(buf);
        }
    }

    private const int LG_INCLUDE_INDIRECT = 1;

    [DllImport("netapi32.dll", CharSet = CharSet.Unicode)]
    private static extern int NetUserGetLocalGroups(string? server, string user, int level, int flags,
        out IntPtr buffer, int prefMaxLen, out int entriesRead, out int totalEntries);

    [DllImport("netapi32.dll")]
    private static extern int NetApiBufferFree(IntPtr buffer);
}
