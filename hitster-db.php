<?php
/**
 * Hitster MariaDB Bridge for Wint / Plesk Webhosting
 * 
 * Lade diese Datei über die Plesk Dateiverwaltung in deinen "httpdocs"-Ordner hoch.
 * Trage unten dein Datenbank-Passwort und einen geheimen Schlüssel ein.
 */

// =============================================================================
// KONFIGURATION
// =============================================================================
define('DB_HOST', '62.108.32.155');
define('DB_PORT', 3306);
define('DB_NAME', 'yufhqmko_songster_db');
define('DB_USER', 'yufhqmko_songster');
define('DB_PASS', 'HIER_DEIN_DATENBANK_PASSWORT_EINTRAGEN');
define('BRIDGE_SECRET', 'hitster-secret-change-me-12345'); // Beliebiges Geheimwort (in Render eintragen)

// =============================================================================
// HEADER & CORS
// =============================================================================
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Bridge-Secret');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// =============================================================================
// SICHERHEITSPRÜFUNG (SECRET)
// =============================================================================
$rawInput = file_get_contents('php://input');
$body = json_decode($rawInput, true) ?: [];

$clientSecret = '';
if (isset($_SERVER['HTTP_X_BRIDGE_SECRET'])) {
    $clientSecret = trim($_SERVER['HTTP_X_BRIDGE_SECRET']);
} elseif (isset($body['secret'])) {
    $clientSecret = trim($body['secret']);
} elseif (isset($_GET['secret'])) {
    $clientSecret = trim($_GET['secret']);
}

if (!$clientSecret || $clientSecret !== BRIDGE_SECRET) {
    http_response_code(403);
    echo json_encode([
        'success' => false,
        'error' => 'Ungueltiger oder fehlender Bridge-Secret-Schluessel.'
    ]);
    exit;
}

// =============================================================================
// DATENBANK-VERBINDUNG (PDO)
// =============================================================================
$hostsToTry = array_unique([DB_HOST, '127.0.0.1', 'localhost']);
$pdo = null;
$lastPdoError = null;

foreach ($hostsToTry as $hostCandidate) {
    try {
        $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $hostCandidate, DB_PORT, DB_NAME);
        $pdo = new PDO($dsn, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
        break;
    } catch (PDOException $e) {
        $lastPdoError = $e;
    }
}

if (!$pdo) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => 'Datenbankverbindung fehlgeschlagen: ' . ($lastPdoError ? $lastPdoError->getMessage() : 'Unbekannter Fehler')
    ]);
    exit;
}

// =============================================================================
// ROUTING DER AKTIONEN
// =============================================================================
$action = isset($_GET['action']) ? $_GET['action'] : (isset($body['action']) ? $body['action'] : '');

try {
    switch ($action) {
        case 'ping':
            echo json_encode(['success' => true, 'status' => 'connected', 'version' => '1.0']);
            break;

        case 'init':
            // Tabellen anlegen falls nicht existent
            $pdo->exec("
                CREATE TABLE IF NOT EXISTS playlists (
                    id VARCHAR(120) PRIMARY KEY,
                    name VARCHAR(255) NOT NULL,
                    logo VARCHAR(512) DEFAULT '',
                    file_path VARCHAR(512) DEFAULT '',
                    sort_order INT DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
            ");

            $pdo->exec("
                CREATE TABLE IF NOT EXISTS songs (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    pack_id VARCHAR(120) NOT NULL,
                    card_number VARCHAR(64) DEFAULT '',
                    title VARCHAR(255) NOT NULL,
                    artist VARCHAR(255) NOT NULL,
                    release_year INT NOT NULL DEFAULT 0,
                    url VARCHAR(512) NOT NULL,
                    youtube_title VARCHAR(255) DEFAULT '',
                    isrc VARCHAR(64) DEFAULT '',
                    is_broken TINYINT(1) DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_pack_id (pack_id)
                ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
            ");

            $pdo->exec("
                CREATE TABLE IF NOT EXISTS song_stats (
                  song_key VARCHAR(255) PRIMARY KEY,
                  artist VARCHAR(255) DEFAULT '',
                  title VARCHAR(255) DEFAULT '',
                  release_year INT DEFAULT 0,
                  times_played INT NOT NULL DEFAULT 0,
                  times_correct INT NOT NULL DEFAULT 0,
                  year_error_sum INT NOT NULL DEFAULT 0,
                  year_error_count INT NOT NULL DEFAULT 0,
                  too_old_count INT NOT NULL DEFAULT 0,
                  too_new_count INT NOT NULL DEFAULT 0,
                  artist_attempts INT NOT NULL DEFAULT 0,
                  artist_correct INT NOT NULL DEFAULT 0,
                  title_attempts INT NOT NULL DEFAULT 0,
                  title_correct INT NOT NULL DEFAULT 0,
                  decision_ms_sum BIGINT NOT NULL DEFAULT 0,
                  decision_count INT NOT NULL DEFAULT 0,
                  timeouts INT NOT NULL DEFAULT 0,
                  last_played_at TIMESTAMP NULL DEFAULT NULL
                ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
            ");

            $stmt = $pdo->query("SELECT id FROM playlists");
            $existingIds = $stmt->fetchAll(PDO::FETCH_COLUMN);

            echo json_encode(['success' => true, 'existingIds' => $existingIds]);
            break;

        case 'seed_playlist':
            $pack = isset($body['pack']) ? $body['pack'] : null;
            $songs = isset($body['songs']) && is_array($body['songs']) ? $body['songs'] : [];

            if (!$pack || empty($pack['id'])) {
                throw new Exception('Pack-Daten fehlen');
            }

            // Playlist anlegen falls noch nicht da
            $stmt = $pdo->prepare("
                INSERT IGNORE INTO playlists (id, name, logo, file_path, sort_order)
                VALUES (?, ?, ?, ?, ?)
            ");
            $stmt->execute([
                $pack['id'],
                $pack['name'] ?? 'Playlist',
                $pack['logo'] ?? '',
                $pack['file'] ?? '',
                intval($pack['sortOrder'] ?? 0)
            ]);

            // Songs einfügen
            if (!empty($songs)) {
                $insertSong = $pdo->prepare("
                    INSERT INTO songs (pack_id, card_number, title, artist, release_year, url, youtube_title, isrc, is_broken)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
                ");
                $pdo->beginTransaction();
                foreach ($songs as $s) {
                    $insertSong->execute([
                        $pack['id'],
                        strval($s['cardNumber'] ?? ''),
                        substr(strval($s['title'] ?? ''), 0, 255),
                        substr(strval($s['artist'] ?? ''), 0, 255),
                        intval($s['year'] ?? 0),
                        substr(strval($s['url'] ?? ''), 0, 512),
                        substr(strval($s['youtubeTitle'] ?? ''), 0, 255),
                        substr(strval($s['isrc'] ?? ''), 0, 64)
                    ]);
                }
                $pdo->commit();
            }

            echo json_encode(['success' => true]);
            break;

        case 'get_all':
            $pStmt = $pdo->query("SELECT id, name, logo, file_path, sort_order FROM playlists ORDER BY sort_order ASC, created_at ASC");
            $playlists = $pStmt->fetchAll();

            $sStmt = $pdo->query("SELECT id, pack_id, card_number, title, artist, release_year, url, youtube_title, isrc, is_broken FROM songs ORDER BY id ASC");
            $songs = $sStmt->fetchAll();

            echo json_encode([
                'success' => true,
                'playlists' => $playlists,
                'songs' => $songs
            ]);
            break;

        case 'create_playlist':
            $pack = isset($body['pack']) ? $body['pack'] : null;
            $songs = isset($body['songs']) && is_array($body['songs']) ? $body['songs'] : [];
            if (!$pack || empty($pack['id']) || empty($pack['name'])) {
                throw new Exception('Playlist-Daten unvollstaendig');
            }

            $stmt = $pdo->prepare("
                INSERT INTO playlists (id, name, logo, file_path, sort_order)
                VALUES (?, ?, ?, ?, ?)
            ");
            $stmt->execute([
                $pack['id'],
                $pack['name'],
                $pack['logo'] ?? '',
                $pack['file'] ?? '',
                intval($pack['sortOrder'] ?? 0)
            ]);

            if (!empty($songs)) {
                $insertSong = $pdo->prepare("
                    INSERT INTO songs (pack_id, card_number, title, artist, release_year, url, youtube_title, isrc, is_broken)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
                ");
                $pdo->beginTransaction();
                foreach ($songs as $s) {
                    $insertSong->execute([
                        $pack['id'],
                        strval($s['cardNumber'] ?? ''),
                        substr(strval($s['title'] ?? ''), 0, 255),
                        substr(strval($s['artist'] ?? ''), 0, 255),
                        intval($s['year'] ?? 0),
                        substr(strval($s['url'] ?? ''), 0, 512),
                        substr(strval($s['youtubeTitle'] ?? ''), 0, 255),
                        substr(strval($s['isrc'] ?? ''), 0, 64)
                    ]);
                }
                $pdo->commit();
            }

            echo json_encode(['success' => true]);
            break;

        case 'delete_playlist':
            $packId = isset($body['packId']) ? $body['packId'] : '';
            if (!$packId) {
                throw new Exception('packId fehlt');
            }
            $pdo->prepare("DELETE FROM songs WHERE pack_id = ?")->execute([$packId]);
            $pdo->prepare("DELETE FROM playlists WHERE id = ?")->execute([$packId]);
            echo json_encode(['success' => true]);
            break;

        case 'add_songs':
            $packId = isset($body['packId']) ? $body['packId'] : '';
            $songs = isset($body['songs']) && is_array($body['songs']) ? $body['songs'] : [];
            if (!$packId || empty($songs)) {
                throw new Exception('Ungueltige Song-Daten');
            }

            $insertSong = $pdo->prepare("
                INSERT INTO songs (pack_id, card_number, title, artist, release_year, url, youtube_title, isrc, is_broken)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
            ");
            $pdo->beginTransaction();
            foreach ($songs as $s) {
                $insertSong->execute([
                    $packId,
                    strval($s['cardNumber'] ?? ''),
                    substr(strval($s['title'] ?? ''), 0, 255),
                    substr(strval($s['artist'] ?? ''), 0, 255),
                    intval($s['year'] ?? 0),
                    substr(strval($s['url'] ?? ''), 0, 512),
                    substr(strval($s['youtubeTitle'] ?? ''), 0, 255),
                    substr(strval($s['isrc'] ?? ''), 0, 64)
                ]);
            }
            $pdo->commit();
            echo json_encode(['success' => true]);
            break;

        case 'update_song':
            $songId = intval($body['songId'] ?? 0);
            $packId = strval($body['packId'] ?? '');
            $title = substr(strval($body['title'] ?? ''), 0, 255);
            $artist = substr(strval($body['artist'] ?? ''), 0, 255);
            $year = intval($body['year'] ?? 0);
            $url = substr(strval($body['url'] ?? ''), 0, 512);
            $isBroken = !empty($body['isBroken']) ? 1 : 0;

            if (!$songId || !$packId) {
                throw new Exception('songId oder packId fehlt');
            }

            $stmt = $pdo->prepare("
                UPDATE songs
                SET title = ?, artist = ?, release_year = ?, url = ?, is_broken = ?
                WHERE id = ? AND pack_id = ?
            ");
            $stmt->execute([$title, $artist, $year, $url, $isBroken, $songId, $packId]);
            echo json_encode(['success' => true]);
            break;

        case 'delete_song':
            $songId = intval($body['songId'] ?? 0);
            $packId = strval($body['packId'] ?? '');
            if (!$songId || !$packId) {
                throw new Exception('songId oder packId fehlt');
            }
            $stmt = $pdo->prepare("DELETE FROM songs WHERE id = ? AND pack_id = ?");
            $stmt->execute([$songId, $packId]);
            echo json_encode(['success' => true]);
            break;

        case 'get_stats':
            $pdo->exec("
                CREATE TABLE IF NOT EXISTS song_stats (
                    song_key VARCHAR(255) PRIMARY KEY,
                    artist VARCHAR(255) DEFAULT '',
                    title VARCHAR(255) DEFAULT '',
                    release_year INT DEFAULT 0,
                    times_played INT NOT NULL DEFAULT 0,
                    times_correct INT NOT NULL DEFAULT 0,
                    year_error_sum INT NOT NULL DEFAULT 0,
                    year_error_count INT NOT NULL DEFAULT 0,
                    too_old_count INT NOT NULL DEFAULT 0,
                    too_new_count INT NOT NULL DEFAULT 0,
                    artist_attempts INT NOT NULL DEFAULT 0,
                    artist_correct INT NOT NULL DEFAULT 0,
                    title_attempts INT NOT NULL DEFAULT 0,
                    title_correct INT NOT NULL DEFAULT 0,
                    decision_ms_sum BIGINT NOT NULL DEFAULT 0,
                    decision_count INT NOT NULL DEFAULT 0,
                    timeouts INT NOT NULL DEFAULT 0,
                    last_played_at TIMESTAMP NULL DEFAULT NULL
                ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
            ");
            $stmt = $pdo->query("SELECT * FROM song_stats");
            echo json_encode(['success' => true, 'stats' => $stmt->fetchAll()]);
            break;

        case 'record_play':
            $pdo->exec("
                CREATE TABLE IF NOT EXISTS song_stats (
                    song_key VARCHAR(255) PRIMARY KEY,
                    artist VARCHAR(255) DEFAULT '',
                    title VARCHAR(255) DEFAULT '',
                    release_year INT DEFAULT 0,
                    times_played INT NOT NULL DEFAULT 0,
                    times_correct INT NOT NULL DEFAULT 0,
                    year_error_sum INT NOT NULL DEFAULT 0,
                    year_error_count INT NOT NULL DEFAULT 0,
                    too_old_count INT NOT NULL DEFAULT 0,
                    too_new_count INT NOT NULL DEFAULT 0,
                    artist_attempts INT NOT NULL DEFAULT 0,
                    artist_correct INT NOT NULL DEFAULT 0,
                    title_attempts INT NOT NULL DEFAULT 0,
                    title_correct INT NOT NULL DEFAULT 0,
                    decision_ms_sum BIGINT NOT NULL DEFAULT 0,
                    decision_count INT NOT NULL DEFAULT 0,
                    timeouts INT NOT NULL DEFAULT 0,
                    last_played_at TIMESTAMP NULL DEFAULT NULL
                ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
            ");
            $key = substr(strval($body['key'] ?? ''), 0, 255);
            if ($key === '') {
                throw new Exception('key fehlt');
            }
            $d = isset($body['delta']) && is_array($body['delta']) ? $body['delta'] : [];
            $num = function ($name) use ($d) {
                return max(0, intval($d[$name] ?? 0));
            };
            $stmt = $pdo->prepare("
                INSERT INTO song_stats (
                    song_key, artist, title, release_year, times_played, times_correct, year_error_sum, year_error_count,
                    too_old_count, too_new_count, artist_attempts, artist_correct, title_attempts, title_correct,
                    decision_ms_sum, decision_count, timeouts, last_played_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
                ON DUPLICATE KEY UPDATE
                    artist = VALUES(artist),
                    title = VALUES(title),
                    release_year = VALUES(release_year),
                    times_played = times_played + VALUES(times_played),
                    times_correct = times_correct + VALUES(times_correct),
                    year_error_sum = year_error_sum + VALUES(year_error_sum),
                    year_error_count = year_error_count + VALUES(year_error_count),
                    too_old_count = too_old_count + VALUES(too_old_count),
                    too_new_count = too_new_count + VALUES(too_new_count),
                    artist_attempts = artist_attempts + VALUES(artist_attempts),
                    artist_correct = artist_correct + VALUES(artist_correct),
                    title_attempts = title_attempts + VALUES(title_attempts),
                    title_correct = title_correct + VALUES(title_correct),
                    decision_ms_sum = decision_ms_sum + VALUES(decision_ms_sum),
                    decision_count = decision_count + VALUES(decision_count),
                    timeouts = timeouts + VALUES(timeouts),
                    last_played_at = NOW()
            ");
            $stmt->execute([
                $key,
                substr(strval($body['artist'] ?? ''), 0, 255),
                substr(strval($body['title'] ?? ''), 0, 255),
                intval($body['year'] ?? 0),
                $num('played'),
                $num('correct'),
                $num('yearErrorSum'),
                $num('yearErrorCount'),
                $num('tooOld'),
                $num('tooNew'),
                $num('artistAttempts'),
                $num('artistCorrect'),
                $num('titleAttempts'),
                $num('titleCorrect'),
                $num('decisionMsSum'),
                $num('decisionCount'),
                $num('timeouts')
            ]);
            echo json_encode(['success' => true]);
            break;

        case 'mark_broken':
            $songId = intval($body['songId'] ?? 0);
            if ($songId > 0) {
                $pdo->prepare("UPDATE songs SET is_broken = 1 WHERE id = ?")->execute([$songId]);
            }
            echo json_encode(['success' => true]);
            break;

        default:
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'Unbekannte Aktion']);
            break;
    }
} catch (Exception $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
