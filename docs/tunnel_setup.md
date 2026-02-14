# Externe Mitspieler via Tunnel (ohne eigene Domain)

Ja: Mit einem Tunnel-Link müssen Mitspieler in der Regel **nur den Invite-Link öffnen**.

## Was wurde im Projekt vorbereitet

- Vite proxyt `/packs`, `/health` und `/socket.io` auf den Node-Server (`localhost:3001`).
- Dadurch reicht für Browser-Clients **eine einzige öffentliche Frontend-URL**.

## Schnellstart (Cloudflare Tunnel)

1. `cloudflared` installieren.
2. Abhängigkeiten installieren:
   - `npm --prefix server install`
   - `npm --prefix client install`
3. Tunnel-Dev-Stack starten:
   - `./scripts/start_tunnel_and_update_env.sh`
4. In der `cloudflared` Ausgabe die `https://...trycloudflare.com` URL kopieren.
5. Erstelle ein Spiel, der Invite-Link nutzt diese URL (nicht localhost, sofern `VITE_PUBLIC_APP_URL` gesetzt ist).

## Empfohlen für korrekte Invite-Links

Setze beim Frontend-Start (oder Build) zusätzlich:

```bash
export VITE_PUBLIC_APP_URL="https://<deine-tunnel-url>"
```

Dann generiert die App Invite-Links direkt mit der Tunnel-URL.

## Müssen Mitspieler etwas installieren?

Nein. Sie brauchen nur:
- den Invite-Link,
- einen Browser,
- Internetzugang.

## Typische Stolperfallen

- Tunnel-URL ändert sich bei jedem Neustart (bei kostenloser Quick-Tunnel-Nutzung).
- Falls Audio/Embeds blockieren, Browser-Tracking-/Popup-Einstellungen prüfen.
- Läuft der lokale Host-Rechner nicht mehr, ist der Link offline.
