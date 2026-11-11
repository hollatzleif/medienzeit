-- Bewertung des morgendlichen Benehmens (1–10) durch einen Erwachsenen, einmal pro Tag

CREATE TABLE ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  ts INTEGER NOT NULL,
  person TEXT NOT NULL,
  score INTEGER NOT NULL,
  minutes INTEGER NOT NULL DEFAULT 0,
  mode TEXT
);
CREATE UNIQUE INDEX idx_ratings_date ON ratings(date);

-- Pflicht ab dem Tag nach dem Einspielen, damit niemand mitten am Tag gesperrt wird
UPDATE settings
SET value = json_set(
  value,
  '$.ratingRequired', json('true'),
  '$.ratingFrom', date('now', '+1 day'),
  '$.ratingMinutes', json('{"ok":30,"bad":60,"worst":120}')
)
WHERE key = 'main';
