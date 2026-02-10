# Songseeker prüfen: Gibt es ein Veröffentlichungsjahr?

Da der Zugriff auf GitHub in dieser Umgebung blockiert ist (HTTP 403), kann ich das Remote-Repo hier nicht direkt klonen.

Ich habe daher ein lokales Prüfskript ergänzt:
- `scripts/check_songseeker_years.py`

## So prüfst du es lokal in 2 Minuten

```bash
git clone https://github.com/andygruber/songseeker.git
python3 scripts/check_songseeker_years.py ./songseeker
```

## Was das Skript ausgibt
- welche Datenfiles es gefunden hat (`.json`, `.jsonl`, `.csv`)
- wie viele Datensätze pro Datei ein Jahr enthalten
- welche Feldnamen für Jahre am häufigsten vorkommen (z. B. `year`, `release_date`, `published_at`)
- ein Gesamtfazit, ob Jahre direkt abfragbar sind

## Wenn Jahre vorhanden sind
Dann kannst du im eigenen Backend direkt so arbeiten:
- beim Import ein kanonisches Feld `release_year` erzeugen
- fehlende Jahre markieren und in der Spielauswahl ggf. filtern

Beispiel-Filterlogik:
- nur Songs mit validem Jahr zwischen 1900 und aktuellem Jahr
- Duplikate nach `artist + title + year` reduzieren

## Wenn Jahre unvollständig sind
- Fallback über zweite Quelle (z. B. MusicBrainz/Discogs/Spotify-Metadaten) nur für fehlende Einträge
- Caching im eigenen DB-Schema, damit du nicht bei jedem Spiel externe Quellen abfragen musst
