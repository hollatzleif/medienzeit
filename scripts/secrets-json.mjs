// Baut aus Umgebungsvariablen die JSON-Datei für `wrangler secret bulk`.
// Wird nur in der GitHub Action benutzt. Gibt nichts Geheimes ins Log aus.

const names = ['LUDWIG_TOKEN', 'PARENT_TOKEN', 'DEVICE_TOKEN', 'PINS'];
const out = {};
const missing = [];

for (const n of names) {
  const v = (process.env[n] ?? '').trim();
  if (!v) missing.push(n);
  else out[n] = v;
}

if (missing.length) {
  console.error(`Fehlende GitHub-Secrets: ${missing.join(', ')} (README, Schritt 4)`);
  process.exit(1);
}

for (const n of ['LUDWIG_TOKEN', 'PARENT_TOKEN', 'DEVICE_TOKEN']) {
  if (out[n].length < 24) {
    console.error(`${n} ist zu kurz – bitte mindestens 24 Zeichen (README, Schritt 2).`);
    process.exit(1);
  }
}

const people = out.PINS.split(/[,;\n]/).filter((p) => p.includes(':'));
if (!people.length) {
  console.error('PINS hat das falsche Format. Beispiel: Mama:1234,Papa:5678');
  process.exit(1);
}

process.stdout.write(JSON.stringify(out));
