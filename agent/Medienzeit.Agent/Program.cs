using Medienzeit.Agent;

if (!OperatingSystem.IsWindows())
{
    Console.Error.WriteLine("Das Medienzeit-Sperrprogramm läuft nur unter Windows.");
    return 1;
}

string dir = AgentConfig.DefaultDir();

if (args.Contains("--sessions"))
    return Diagnostics.PrintSessions(dir);

if (args.Contains("--check"))
    return await Diagnostics.CheckAsync(dir);

var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddWindowsService(o => o.ServiceName = "MedienzeitAgent");
builder.Logging.AddProvider(new FileLoggerProvider(dir));
builder.Services.AddSingleton(new AgentPaths(dir));
builder.Services.AddHostedService<AgentWorker>();

await builder.Build().RunAsync();
return 0;
