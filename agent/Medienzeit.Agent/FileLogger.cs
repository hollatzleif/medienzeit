using Microsoft.Extensions.Logging;

namespace Medienzeit.Agent;

/// <summary>Einfaches Textprotokoll in C:\ProgramData\Medienzeit\agent.log (max. ~1 MB, eine Vorgängerdatei).</summary>
public sealed class FileLoggerProvider : ILoggerProvider
{
    private const long MaxBytes = 1_000_000;
    private readonly string _path;
    private readonly object _gate = new();

    public FileLoggerProvider(string dir)
    {
        Directory.CreateDirectory(dir);
        _path = Path.Combine(dir, "agent.log");
    }

    public ILogger CreateLogger(string categoryName) => new FileLogger(this, categoryName);

    internal void Write(LogLevel level, string category, string message, Exception? ex)
    {
        string line = $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} [{level}] {ShortName(category)}: {message}";
        if (ex is not null) line += Environment.NewLine + ex;
        lock (_gate)
        {
            try
            {
                var fi = new FileInfo(_path);
                if (fi.Exists && fi.Length > MaxBytes)
                    File.Move(_path, Path.Combine(fi.DirectoryName!, "agent.old.log"), overwrite: true);
                File.AppendAllText(_path, line + Environment.NewLine);
            }
            catch
            {
                // Protokollieren darf den Dienst nie stören.
            }
        }
    }

    private static string ShortName(string category)
    {
        int i = category.LastIndexOf('.');
        return i >= 0 ? category[(i + 1)..] : category;
    }

    public void Dispose() { }

    private sealed class FileLogger : ILogger
    {
        private readonly FileLoggerProvider _p;
        private readonly string _cat;
        public FileLogger(FileLoggerProvider p, string cat) { _p = p; _cat = cat; }
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => logLevel >= LogLevel.Information;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            if (!IsEnabled(logLevel)) return;
            _p.Write(logLevel, _cat, formatter(state, exception), exception);
        }
    }
}
