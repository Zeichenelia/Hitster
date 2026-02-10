# Einschätzung: "Online-Hitster" als WebApp oder Unity

## Kurzfazit
Ja, dein Plan ist grundsätzlich **gut umsetzbar** – technisch sowohl als WebApp als auch als Unity-Spiel.

Der größte Engpass ist **nicht die Spielmechanik**, sondern die **Musik-/Streaming-Rechte**.

## Was am einfachsten ist
Für den Start ist eine **WebApp** meist schneller:
- gemeinsamer Room/Lobby
- Karten-/Song-Metadaten laden
- Timeline-Logik (vorher/nachher einordnen)
- Punkte und Runden
- Realtime via WebSockets

Typischer Stack:
- Frontend: React/Next.js oder Vue
- Backend: Node.js (Nest/Express/Fastify) oder Go
- Realtime: Socket.IO / WebSocket
- DB: Postgres
- Optional: Redis für Room-State

## Unity vs. WebApp
- **WebApp**: schneller MVP, einfacher Deployment/Onboarding, ideal für Browser + Mobile Browser.
- **Unity**: gut für 3D/FX/Game-Feel, aber höherer Entwicklungs- und Deployment-Aufwand.

Für "mit Freunden online spielen" ist Web meistens der bessere erste Schritt.

## Rolle der Song-Datenbank (z. B. Songseeker)
Eine Song-Datenbank hilft für:
- Titel
- Artist
- Release-Jahr
- ggf. Cover/Links

Das reicht für Hitster-ähnliche Logik bereits weitgehend aus.

Wichtig: Die Datenbank selbst löst **nicht automatisch**:
- legale Audio-Preview-Auslieferung
- stabile Verfügbarkeit der Preview-URLs
- Rechte für öffentliches Bereitstellen von Musik

## Rechtlich/praktisch entscheidend
Du musst zwischen zwei Modi unterscheiden:

1. **Privates Hobby-Projekt (kleiner Kreis)**
   - deutlich unkritischer
   - trotzdem keine urheberrechtswidrige Audioverteilung

2. **Öffentliches/kommerzielles Projekt**
   - klarer Rechte- und Lizenz-Check nötig
   - TOS der Musik-APIs strikt einhalten

Sicherster Weg: Nur erlaubte Quellen nutzen (z. B. offizielle API-Previews, wo Nutzungsbedingungen es erlauben) und keine kompletten Tracks hosten.

## Technische Architektur für ein MVP
1. Room erstellen/joinen
2. Runde startet -> Server zieht zufälligen Song aus DB
3. Client bekommt Song-Metadaten + (optional) erlaubte Preview-URL
4. Spieler ordnet Song in persönliche Timeline ein
5. Server validiert Jahr und vergibt Punkte
6. Nächste Runde

Server sollte die "Wahrheit" besitzen (Year/Order/Score), damit nicht clientseitig gecheatet wird.

## Realistische Roadmap (4–8 Wochen nebenbei)
- Woche 1: Datenmodell, Importer, Seed-Daten
- Woche 2: Room + Realtime + Auth light (Nickname/Invite-Code)
- Woche 3: Kern-Gameplay + Scoring
- Woche 4: UI/UX + Mobile Layout
- Woche 5+: Audio-Provider-Integration, Moderation, ELO/Statistiken

## Risiken
- instabile externe Musik-APIs
- fehlende oder fehlerhafte Release-Jahre
- Rechts-/Lizenzthemen bei Audio
- schlechte Latenz bei internationalen Spielern

## Empfehlung
- Starte mit **WebApp-MVP ohne eigene Audio-Hosts**.
- Nutze Song-Metadaten zuerst (Titel/Artist/Jahr), Audio als optionales Modul.
- Baue das System so, dass Audio-Provider später austauschbar sind.

Wenn du willst, kann ich dir als nächsten Schritt eine konkrete technische Zielarchitektur (Tabellen, Endpunkte, Events, Match-State) für deinen MVP skizzieren.
