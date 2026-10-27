const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { parse } = require("csv-parse/sync");

const REPO_ROOT = path.join(__dirname, "..");
const PACK_LIST_PATH = path.join(REPO_ROOT, "data", "playlists", "hitster_de_packs.json");

const packIndex = new Map();
const songsByPack = new Map();
let pool = null;
let dbEnabled = false;
let bridgeMode = false;
let bridgeUrl = "";
let bridgeSecret = "";
let lastDbError = "";

function slugifyPackId(name) {
  const base = String(name || "playlist")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 60);
  return `custom-${base || "pack"}-${Date.now().toString(36)}`;
}

function escapeCsvField(value) {
  const str = String(value ?? "");
  if (/[",\r\n]/u.test(str)) {
    return `"${str.replace(/"/gu, '""')}"`;
  }
  return str;
}

function parseCsvSongs(rawCsv, packId) {
  const records = parse(rawCsv, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
  });
  const songs = [];
  for (let i = 0; i < records.length; i += 1) {
    const row = records[i];
    const rawYear = row["Year"] ?? row["year"] ?? row["Jahr"] ?? "";
    const parsedYear = Number.parseInt(rawYear, 10);
    const year = Number.isNaN(parsedYear) ? 0 : parsedYear;
    const cardNumber = String(
      row["Card#"] || row["\uFEFFCard#"] || row["cardNumber"] || String(i + 1).padStart(3, "0")
    ).trim();
    const title = String(row["Title"] ?? row["title"] ?? row["Titel"] ?? "").trim();
    const artist = String(row["Artist"] ?? row["artist"] ?? row["Interpret"] ?? "").trim();
    const url = String(row["URL"] ?? row["url"] ?? row["Url"] ?? row["Link"] ?? "").trim();
    if (!title && !artist && !url) {
      continue;
    }
    songs.push({
      id: `${packId}-${cardNumber || i + 1}`,
      dbId: null,
      packId,
      cardNumber: cardNumber || String(i + 1).padStart(3, "0"),
      title,
      artist,
      year: year || rawYear,
      url,
      youtubeTitle: String(row["Youtube-Title"] ?? row["youtubeTitle"] ?? "").trim(),
      isrc: String(row["ISRC"] ?? row["isrc"] ?? "").trim(),
      isBroken: false,
    });
  }
  return songs;
}

function loadFromDisk() {
  if (!fs.existsSync(PACK_LIST_PATH)) {
    return;
  }
  const raw = fs.readFileSync(PACK_LIST_PATH, "utf-8");
  const packs = JSON.parse(raw);
  for (let idx = 0; idx < packs.length; idx += 1) {
    const pack = packs[idx];
    const songs = [];
    if (pack.file) {
      const csvPath = path.join(REPO_ROOT, pack.file);
      if (fs.existsSync(csvPath)) {
        const csvRaw = fs.readFileSync(csvPath, "utf-8");
        songs.push(...parseCsvSongs(csvRaw, pack.id));
      }
    }
    songsByPack.set(pack.id, songs);
    packIndex.set(pack.id, {
      id: pack.id,
      name: pack.name,
      file: pack.file || `data/playlists/${pack.id}.csv`,
      logo: pack.logo || "",
      songCount: songs.length,
      sortOrder: idx,
    });
  }
}

function savePackToDisk(packId) {
  try {
    const pack = packIndex.get(packId);
    const songs = songsByPack.get(packId) || [];
    if (pack) {
      const relFile = pack.file || `data/playlists/${packId}.csv`;
      pack.file = relFile;
      const csvPath = path.join(REPO_ROOT, relFile);
      const header = "Card#,Title,Artist,Year,URL,Youtube-Title,ISRC";
      const lines = songs.map((song, index) => {
        const cardNum = song.cardNumber || String(index + 1).padStart(3, "0");
        return [
          escapeCsvField(cardNum),
          escapeCsvField(song.title),
          escapeCsvField(song.artist),
          escapeCsvField(song.year),
          escapeCsvField(song.url),
          escapeCsvField(song.youtubeTitle || ""),
          escapeCsvField(song.isrc || ""),
        ].join(",");
      });
      fs.writeFileSync(csvPath, [header, ...lines].join("\n") + "\n", "utf-8");
    }
    const allPacks = Array.from(packIndex.values()).map((p) => {
      const entry = {
        id: p.id,
        name: p.name,
        file: p.file || `data/playlists/${p.id}.csv`,
      };
      if (p.logo) {
        entry.logo = p.logo;
      }
      return entry;
    });
    fs.writeFileSync(PACK_LIST_PATH, JSON.stringify(allPacks, null, 2) + "\n", "utf-8");
  } catch (err) {
    console.warn("Could not persist playlist to local disk:", err.message);
  }
}

async function callBridge(action, payload = {}) {
  const url = `${bridgeUrl}?action=${encodeURIComponent(action)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bridge-Secret": bridgeSecret,
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || data.success === false) {
    throw new Error(data.error || `Bridge Fehler (${res.status})`);
  }
  return data;
}

async function reloadFromBridge() {
  const data = await callBridge("get_all");
  const playlistRows = data.playlists || [];
  const songRows = data.songs || [];

  const groupedSongs = new Map();
  for (const row of songRows) {
    if (!groupedSongs.has(row.pack_id)) {
      groupedSongs.set(row.pack_id, []);
    }
    const list = groupedSongs.get(row.pack_id);
    const cardNumber = row.card_number || String(list.length + 1).padStart(3, "0");
    list.push({
      id: `${row.pack_id}-${row.id}`,
      dbId: row.id,
      packId: row.pack_id,
      cardNumber,
      title: row.title || "",
      artist: row.artist || "",
      year: Number.parseInt(row.release_year, 10) || 0,
      url: row.url || "",
      youtubeTitle: row.youtube_title || "",
      isrc: row.isrc || "",
      isBroken: Boolean(row.is_broken),
    });
  }

  packIndex.clear();
  songsByPack.clear();

  for (const row of playlistRows) {
    const songs = groupedSongs.get(row.id) || [];
    songsByPack.set(row.id, songs);
    packIndex.set(row.id, {
      id: row.id,
      name: row.name,
      file: row.file_path || `data/playlists/${row.id}.csv`,
      logo: row.logo || "",
      songCount: songs.length,
      sortOrder: Number.parseInt(row.sort_order, 10) || 0,
    });
  }
}

async function initDatabase() {
  loadFromDisk();

  bridgeUrl = process.env.DB_BRIDGE_URL || "";
  bridgeSecret = process.env.DB_BRIDGE_SECRET || "";

  if (bridgeUrl && bridgeSecret) {
    console.log(`[DB] Attempting connection via PHP Bridge (${bridgeUrl})...`);
    try {
      const initRes = await callBridge("init");
      const existingIds = new Set(initRes.existingIds || []);

      for (const [packId, pack] of packIndex.entries()) {
        if (!existingIds.has(packId)) {
          const diskSongs = songsByPack.get(packId) || [];
          console.log(`[DB-Bridge] Seeding playlist "${pack.name}" (${diskSongs.length} songs)...`);
          const chunkSize = 100;
          for (let i = 0; i < diskSongs.length; i += chunkSize) {
            const chunk = diskSongs.slice(i, i + chunkSize);
            await callBridge("seed_playlist", {
              pack: i === 0 ? pack : { id: pack.id },
              songs: chunk,
            });
          }
          if (diskSongs.length === 0) {
            await callBridge("seed_playlist", { pack, songs: [] });
          }
        }
      }

      await reloadFromBridge();
      dbEnabled = true;
      bridgeMode = true;
      console.log(`[DB] Connected to MariaDB via PHP Bridge (${packIndex.size} playlists active).`);
      return;
    } catch (err) {
      console.error("[DB] PHP Bridge connection failed:", err.message);
      lastDbError = err.message;
      dbEnabled = false;
      bridgeMode = false;
    }
  }

  const dbUrl = process.env.DATABASE_URL || "";
  const dbHost = process.env.DB_HOST || "";
  if (!dbUrl && !dbHost) {
    console.log("[DB] No DB_BRIDGE_URL or DB_HOST set — using local CSV files.");
    return;
  }

  try {
    if (dbUrl) {
      pool = mysql.createPool(dbUrl);
    } else {
      pool = mysql.createPool({
        host: dbHost,
        port: Number.parseInt(process.env.DB_PORT || "3306", 10),
        user: process.env.DB_USER || "",
        password: process.env.DB_PASSWORD || "",
        database: process.env.DB_NAME || "",
        waitForConnections: true,
        connectionLimit: 5,
        charset: "utf8mb4",
        ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined,
      });
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS playlists (
        id VARCHAR(120) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        logo VARCHAR(512) DEFAULT '',
        file_path VARCHAR(512) DEFAULT '',
        sort_order INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    `);

    await pool.query(`
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
    `);

    const [existingPlaylists] = await pool.query("SELECT id FROM playlists");
    const existingIds = new Set(existingPlaylists.map((row) => row.id));

    for (const [packId, pack] of packIndex.entries()) {
      if (!existingIds.has(packId)) {
        await pool.query(
          "INSERT INTO playlists (id, name, logo, file_path, sort_order) VALUES (?, ?, ?, ?, ?)",
          [pack.id, pack.name, pack.logo || "", pack.file || "", pack.sortOrder || 0]
        );
        const diskSongs = songsByPack.get(packId) || [];
        if (diskSongs.length > 0) {
          const values = diskSongs.map((s) => [
            packId,
            String(s.cardNumber || ""),
            String(s.title || "").slice(0, 255),
            String(s.artist || "").slice(0, 255),
            Number.parseInt(s.year, 10) || 0,
            String(s.url || "").slice(0, 512),
            String(s.youtubeTitle || "").slice(0, 255),
            String(s.isrc || "").slice(0, 64),
            0,
          ]);
          const chunkSize = 100;
          for (let i = 0; i < values.length; i += chunkSize) {
            const chunk = values.slice(i, i + chunkSize);
            await pool.query(
              "INSERT INTO songs (pack_id, card_number, title, artist, release_year, url, youtube_title, isrc, is_broken) VALUES ?",
              [chunk]
            );
          }
          console.log(`[DB] Seeded playlist "${pack.name}" (${diskSongs.length} songs) into MariaDB`);
        }
      }
    }

    await reloadFromDatabase();
    dbEnabled = true;
    console.log(`[DB] Connected to MariaDB (${packIndex.size} playlists loaded).`);
  } catch (err) {
    console.error("[DB] Failed to initialize MariaDB, falling back to CSVs:", err.message);
    pool = null;
    dbEnabled = false;
  }
}

async function reloadFromDatabase() {
  if (!pool) {
    return;
  }
  const [playlistRows] = await pool.query(
    "SELECT id, name, logo, file_path, sort_order FROM playlists ORDER BY sort_order ASC, created_at ASC"
  );
  const [songRows] = await pool.query(
    "SELECT id, pack_id, card_number, title, artist, release_year, url, youtube_title, isrc, is_broken FROM songs ORDER BY id ASC"
  );

  const groupedSongs = new Map();
  for (const row of songRows) {
    if (!groupedSongs.has(row.pack_id)) {
      groupedSongs.set(row.pack_id, []);
    }
    const list = groupedSongs.get(row.pack_id);
    const cardNumber = row.card_number || String(list.length + 1).padStart(3, "0");
    list.push({
      id: `${row.pack_id}-${row.id}`,
      dbId: row.id,
      packId: row.pack_id,
      cardNumber,
      title: row.title || "",
      artist: row.artist || "",
      year: row.release_year || 0,
      url: row.url || "",
      youtubeTitle: row.youtube_title || "",
      isrc: row.isrc || "",
      isBroken: Boolean(row.is_broken),
    });
  }

  packIndex.clear();
  songsByPack.clear();

  for (const row of playlistRows) {
    const songs = groupedSongs.get(row.id) || [];
    songsByPack.set(row.id, songs);
    packIndex.set(row.id, {
      id: row.id,
      name: row.name,
      file: row.file_path || `data/playlists/${row.id}.csv`,
      logo: row.logo || "",
      songCount: songs.length,
      sortOrder: row.sort_order || 0,
    });
  }
}

function getAllPacks() {
  return Array.from(packIndex.values()).map((pack) => ({
    ...pack,
    songCount: (songsByPack.get(pack.id) || []).length,
  }));
}

function getPack(packId) {
  return packIndex.get(packId) || null;
}

function getSongsForPack(packId) {
  const packName = packIndex.get(packId)?.name || packId;
  return (songsByPack.get(packId) || []).map((s) => ({
    ...s,
    packName,
  }));
}

function getAllSongs() {
  const all = [];
  for (const [packId, songs] of songsByPack.entries()) {
    const packName = packIndex.get(packId)?.name || packId;
    for (const song of songs) {
      all.push({
        ...song,
        packName,
      });
    }
  }
  return all;
}

function loadDeckFromPacks(packIds) {
  const cards = [];
  for (const packId of packIds) {
    const songs = songsByPack.get(packId) || [];
    for (const song of songs) {
      cards.push({ ...song });
    }
  }
  return cards;
}

async function createPlaylist({ name, logo = "", csvText = "" }) {
  const trimmedName = String(name || "").trim();
  if (!trimmedName) {
    throw new Error("Playlist name is required");
  }
  const packId = slugifyPackId(trimmedName);
  const sortOrder = packIndex.size;
  const newPack = {
    id: packId,
    name: trimmedName,
    file: `data/playlists/${packId}.csv`,
    logo: String(logo || "").trim(),
    songCount: 0,
    sortOrder,
  };

  const initialSongs = csvText ? parseCsvSongs(csvText, packId) : [];

  if (bridgeMode) {
    await callBridge("create_playlist", {
      pack: newPack,
      songs: initialSongs,
    });
    await reloadFromBridge();
  } else if (dbEnabled && pool) {
    await pool.query(
      "INSERT INTO playlists (id, name, logo, file_path, sort_order) VALUES (?, ?, ?, ?, ?)",
      [newPack.id, newPack.name, newPack.logo, newPack.file, newPack.sortOrder]
    );
    if (initialSongs.length > 0) {
      const values = initialSongs.map((s, idx) => [
        packId,
        String(s.cardNumber || String(idx + 1).padStart(3, "0")),
        String(s.title || "").slice(0, 255),
        String(s.artist || "").slice(0, 255),
        Number.parseInt(s.year, 10) || 0,
        String(s.url || "").slice(0, 512),
        String(s.youtubeTitle || "").slice(0, 255),
        String(s.isrc || "").slice(0, 64),
        0,
      ]);
      const chunkSize = 100;
      for (let i = 0; i < values.length; i += chunkSize) {
        const chunk = values.slice(i, i + chunkSize);
        await pool.query(
          "INSERT INTO songs (pack_id, card_number, title, artist, release_year, url, youtube_title, isrc, is_broken) VALUES ?",
          [chunk]
        );
      }
    }
    await reloadFromDatabase();
  } else {
    packIndex.set(packId, { ...newPack, songCount: initialSongs.length });
    songsByPack.set(packId, initialSongs);
    savePackToDisk(packId);
  }

  return packIndex.get(packId);
}

async function deletePlaylist(packId) {
  if (!packIndex.has(packId)) {
    throw new Error("Playlist not found");
  }
  if (bridgeMode) {
    await callBridge("delete_playlist", { packId });
    await reloadFromBridge();
  } else if (dbEnabled && pool) {
    await pool.query("DELETE FROM songs WHERE pack_id = ?", [packId]);
    await pool.query("DELETE FROM playlists WHERE id = ?", [packId]);
    await reloadFromDatabase();
  } else {
    packIndex.delete(packId);
    songsByPack.delete(packId);
    savePackToDisk(packId);
  }
}

async function addSongsToPlaylist(packId, newSongsInput) {
  const pack = packIndex.get(packId);
  if (!pack) {
    throw new Error("Playlist not found");
  }
  const existing = songsByPack.get(packId) || [];
  let nextNum = existing.length + 1;

  const prepared = newSongsInput
    .map((item) => {
      const cardNumber = String(item.cardNumber || String(nextNum++).padStart(3, "0")).trim();
      const year = Number.parseInt(item.year, 10) || 0;
      return {
        packId,
        cardNumber,
        title: String(item.title || "").trim(),
        artist: String(item.artist || "").trim(),
        year,
        url: String(item.url || "").trim(),
        youtubeTitle: String(item.youtubeTitle || "").trim(),
        isrc: String(item.isrc || "").trim(),
        isBroken: false,
      };
    })
    .filter((s) => s.title && s.artist && s.url && s.year > 0);

  if (prepared.length === 0) {
    throw new Error("Bitte Titel, Interpret, gültiges Jahr und YouTube-URL angeben.");
  }

  if (bridgeMode) {
    await callBridge("add_songs", { packId, songs: prepared });
    await reloadFromBridge();
  } else if (dbEnabled && pool) {
    const values = prepared.map((s) => [
      packId,
      s.cardNumber,
      s.title.slice(0, 255),
      s.artist.slice(0, 255),
      s.year,
      s.url.slice(0, 512),
      s.youtubeTitle.slice(0, 255),
      s.isrc.slice(0, 64),
      0,
    ]);
    await pool.query(
      "INSERT INTO songs (pack_id, card_number, title, artist, release_year, url, youtube_title, isrc, is_broken) VALUES ?",
      [values]
    );
    await reloadFromDatabase();
  } else {
    for (const s of prepared) {
      existing.push({
        ...s,
        id: `${packId}-${s.cardNumber}-${Date.now().toString(36)}`,
      });
    }
    songsByPack.set(packId, existing);
    pack.songCount = existing.length;
    savePackToDisk(packId);
  }

  return getSongsForPack(packId);
}

async function updateSong(packId, songId, updates) {
  const songs = songsByPack.get(packId);
  if (!songs) {
    throw new Error("Playlist not found");
  }
  const song = songs.find((s) => String(s.id) === String(songId) || String(s.dbId) === String(songId));
  if (!song) {
    throw new Error("Song not found");
  }

  const nextTitle = updates.title !== undefined ? String(updates.title).trim() : song.title;
  const nextArtist = updates.artist !== undefined ? String(updates.artist).trim() : song.artist;
  const nextYear = updates.year !== undefined ? Number.parseInt(updates.year, 10) || song.year : song.year;
  const nextUrl = updates.url !== undefined ? String(updates.url).trim() : song.url;
  const nextBroken = updates.isBroken !== undefined ? Boolean(updates.isBroken) : false;

  if (bridgeMode && song.dbId) {
    await callBridge("update_song", {
      songId: song.dbId,
      packId,
      title: nextTitle,
      artist: nextArtist,
      year: nextYear,
      url: nextUrl,
      isBroken: nextBroken,
    });
    await reloadFromBridge();
  } else if (dbEnabled && pool && song.dbId) {
    await pool.query(
      "UPDATE songs SET title = ?, artist = ?, release_year = ?, url = ?, is_broken = ? WHERE id = ? AND pack_id = ?",
      [nextTitle.slice(0, 255), nextArtist.slice(0, 255), nextYear, nextUrl.slice(0, 512), nextBroken ? 1 : 0, song.dbId, packId]
    );
    await reloadFromDatabase();
  } else {
    song.title = nextTitle;
    song.artist = nextArtist;
    song.year = nextYear;
    song.url = nextUrl;
    song.isBroken = nextBroken;
    savePackToDisk(packId);
  }

  return getSongsForPack(packId);
}

async function deleteSong(packId, songId) {
  const songs = songsByPack.get(packId);
  if (!songs) {
    throw new Error("Playlist not found");
  }
  const index = songs.findIndex((s) => String(s.id) === String(songId) || String(s.dbId) === String(songId));
  if (index === -1) {
    throw new Error("Song not found");
  }
  const target = songs[index];

  if (bridgeMode && target.dbId) {
    await callBridge("delete_song", { songId: target.dbId, packId });
    await reloadFromBridge();
  } else if (dbEnabled && pool && target.dbId) {
    await pool.query("DELETE FROM songs WHERE id = ? AND pack_id = ?", [target.dbId, packId]);
    await reloadFromDatabase();
  } else {
    songs.splice(index, 1);
    const pack = packIndex.get(packId);
    if (pack) {
      pack.songCount = songs.length;
    }
    savePackToDisk(packId);
  }

  return getSongsForPack(packId);
}

async function markSongBroken(card) {
  if (!card || !card.packId) {
    return;
  }
  const songs = songsByPack.get(card.packId) || [];
  const match = songs.find((s) => s.id === card.id || (card.dbId && s.dbId === card.dbId));
  if (match) {
    match.isBroken = true;
    if (bridgeMode && match.dbId) {
      try {
        await callBridge("mark_broken", { songId: match.dbId });
      } catch (_err) {
        // Non-critical
      }
    } else if (dbEnabled && pool && match.dbId) {
      try {
        await pool.query("UPDATE songs SET is_broken = 1 WHERE id = ?", [match.dbId]);
      } catch (_err) {
        // Non-critical
      }
    }
  }
}

function isDatabaseConnected() {
  return dbEnabled;
}

function getLastError() {
  return lastDbError || "";
}

module.exports = {
  initDatabase,
  getAllPacks,
  getPack,
  getSongsForPack,
  getAllSongs,
  loadDeckFromPacks,
  createPlaylist,
  deletePlaylist,
  addSongsToPlaylist,
  updateSong,
  deleteSong,
  markSongBroken,
  parseCsvSongs,
  isDatabaseConnected,
  getLastError,
};
