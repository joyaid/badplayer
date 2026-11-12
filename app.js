/**
 * Bad Player — Complete Client-Side Music Player Web App
 * Creator: Joyaid
 * Runs 100% locally in the browser using IndexedDB and localStorage.
 */

(() => {
  "use strict";

  /* ==========================================================================
   * SECURITY & ADMIN CONSTANTS
   * ==========================================================================
   * NOTE: This is a local-only protection mechanism. Because Bad Player runs
   * entirely in the browser with no backend server or real account system,
   * anyone who inspects the browser DevTools or views this source file can
   * read `ADMIN_PASSWORD` or bypass the check. This is expected and acceptable
   * for a local single-page application.
   */
  const ADMIN_PASSWORD = "333";

  // Storage Keys
  const STORAGE_KEYS = {
    SETTINGS: "badplayer_settings_v1",
    USERS: "badplayer_users_v1",
    ACTIVE_USER_ID: "badplayer_active_user_id_v1",
    BADGES: "badplayer_badges_v1",
    CUSTOM_BADGE_GLOBAL: "badplayer_custom_badge_global_v1",
    CUSTOM_BADGE_USERS: "badplayer_custom_badge_users_v1"
  };

  // IndexedDB Configuration for persistent audio blobs
  const IDB_CONFIG = {
    NAME: "BadPlayerAudioDB",
    VERSION: 1,
    STORE_TRACKS: "tracks"
  };

  // Default visual settings
  const DEFAULT_SETTINGS = {
    accentColor: "#e11d48",
    bgTone: "pitch",
    fontSize: 16,
    density: "comfortable",
    playerPos: "bottom",
    volume: 0.85
  };

  // Application runtime state
  const state = {
    settings: { ...DEFAULT_SETTINGS },
    users: [],
    activeUserId: "user_joyaid",
    badges: {}, // { [userId]: boolean }
    globalBadgeDataUrl: "", // Optional custom global badge image (Data URL)
    userBadgeDataUrls: {}, // Optional per-user custom badge image { [userId]: DataURL }
    adminUnlocked: false, // Session-only; resets on reload
    tracks: [], // Array of { id, title, artist, duration, blob, url, addedAt }
    currentTrackIndex: -1,
    isPlaying: false,
    shuffle: false,
    repeatMode: "off", // 'off' | 'all' | 'one'
    searchQuery: ""
  };

  // Audio Element & Web Audio Visualizer References
  const audio = document.getElementById("audio-element");
  let audioCtx = null;
  let analyser = null;
  let sourceNode = null;
  let visualizerFrameId = null;

  /* ==========================================================================
   * VERIFIED BADGE COMPONENT (Default Inline SVG + Custom Image Support)
   * Strictly constrained to 18x18px badge size!
   * ========================================================================== */
  function getDefaultVerifiedBadgeSVG() {
    return `
      <svg class="verified-badge-svg" width="18" height="18" viewBox="0 0 24 24" title="Verified Profile" aria-label="Verified Profile">
        <circle cx="12" cy="12" r="10" fill="#09090b" stroke="var(--accent)" stroke-width="2.2"></circle>
        <path d="M8 12.3l2.6 2.6L16.2 9.3" fill="none" stroke="var(--accent)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
    `;
  }

  /**
   * Returns the HTML markup for a user's verified badge (or preview).
   * Priority: Per-user custom badge image -> Global custom badge image -> Default SVG checkmark.
   */
  function getBadgeMarkupForUser(userId) {
    const customSrc =
      (userId && state.userBadgeDataUrls[userId]) || state.globalBadgeDataUrl || "";
    if (customSrc) {
      return `<img class="verified-badge-img" src="${customSrc}" width="18" height="18" alt="Verified" title="Verified Profile" />`;
    }
    return getDefaultVerifiedBadgeSVG();
  }

  function hasBadge(userId) {
    return Boolean(state.badges && state.badges[userId]);
  }

  /* ==========================================================================
   * LOCALSTORAGE HELPERS (Settings, Profiles, Badges, Custom Badge Icons)
   * ========================================================================== */
  function loadLocalState() {
    // 1. Load Settings
    try {
      const rawSettings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (rawSettings) {
        state.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(rawSettings) };
      }
    } catch (err) {
      console.warn("Could not read settings from localStorage:", err);
    }

    // 2. Load Users (Ensure creator profile 'Joyaid' always exists)
    try {
      const rawUsers = localStorage.getItem(STORAGE_KEYS.USERS);
      if (rawUsers) {
        state.users = JSON.parse(rawUsers);
      }
    } catch (err) {
      console.warn("Could not read users from localStorage:", err);
    }

    if (!Array.isArray(state.users) || state.users.length === 0) {
      state.users = [
        {
          id: "user_joyaid",
          name: "Joyaid",
          bio: "Creator of Bad Player. Minimalist black & red audio experience.",
          avatarDataUrl: "",
          bannerDataUrl: ""
        }
      ];
      saveUsers();
    }

    // 3. Load Active User ID
    const savedActiveId = localStorage.getItem(STORAGE_KEYS.ACTIVE_USER_ID);
    if (savedActiveId && state.users.some((u) => u.id === savedActiveId)) {
      state.activeUserId = savedActiveId;
    } else {
      state.activeUserId = state.users[0].id;
      localStorage.setItem(STORAGE_KEYS.ACTIVE_USER_ID, state.activeUserId);
    }

    // 4. Load Verified Badges (Joyaid holds a verified badge by default on first run)
    try {
      const rawBadges = localStorage.getItem(STORAGE_KEYS.BADGES);
      if (rawBadges) {
        state.badges = JSON.parse(rawBadges);
      } else {
        state.badges = { user_joyaid: true };
        saveBadges();
      }
    } catch (err) {
      state.badges = { user_joyaid: true };
    }

    // 5. Load Custom Badge Images (Global & Per-User)
    try {
      state.globalBadgeDataUrl = localStorage.getItem(STORAGE_KEYS.CUSTOM_BADGE_GLOBAL) || "";
      const rawUserBadges = localStorage.getItem(STORAGE_KEYS.CUSTOM_BADGE_USERS);
      if (rawUserBadges) {
        state.userBadgeDataUrls = JSON.parse(rawUserBadges) || {};
      }
    } catch (err) {
      state.globalBadgeDataUrl = "";
      state.userBadgeDataUrls = {};
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(state.settings));
    } catch (err) {
      console.error("Failed to save settings:", err);
    }
  }

  function saveUsers() {
    try {
      localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(state.users));
    } catch (err) {
      alert("Storage quota exceeded when saving profile image. Try a smaller image file.");
    }
  }

  function saveBadges() {
    try {
      localStorage.setItem(STORAGE_KEYS.BADGES, JSON.stringify(state.badges));
    } catch (err) {
      console.error("Failed to save badges:", err);
    }
  }

  function saveCustomBadgeIcons() {
    try {
      if (state.globalBadgeDataUrl) {
        localStorage.setItem(STORAGE_KEYS.CUSTOM_BADGE_GLOBAL, state.globalBadgeDataUrl);
      } else {
        localStorage.removeItem(STORAGE_KEYS.CUSTOM_BADGE_GLOBAL);
      }
      localStorage.setItem(STORAGE_KEYS.CUSTOM_BADGE_USERS, JSON.stringify(state.userBadgeDataUrls));
    } catch (err) {
      alert("Failed to save custom badge image to localStorage.");
    }
  }

  function getActiveUser() {
    return state.users.find((u) => u.id === state.activeUserId) || state.users[0];
  }

  /* ==========================================================================
   * THEME & SETTINGS ENGINE
   * ========================================================================== */
  function applySettingsToDOM() {
    const { accentColor, bgTone, fontSize, density, playerPos, volume } = state.settings;
    const root = document.documentElement;

    root.style.setProperty("--accent", accentColor);
    root.style.setProperty("--accent-hover", accentColor);
    root.style.setProperty("--accent-soft", hexToRgba(accentColor, 0.18));
    root.style.setProperty("--accent-glow", hexToRgba(accentColor, 0.45));
    root.style.setProperty("--font-size-base", `${fontSize}px`);

    document.body.setAttribute("data-bg-tone", bgTone);
    document.body.setAttribute("data-density", density);
    document.body.setAttribute("data-player-pos", playerPos);

    // Sync Settings form controls
    const accentInput = document.getElementById("setting-accent");
    const bgToneSelect = document.getElementById("setting-bg-tone");
    const fontSizeSlider = document.getElementById("setting-font-size");
    const fontSizeLabel = document.getElementById("font-size-label");
    const densitySelect = document.getElementById("setting-density");
    const playerPosSelect = document.getElementById("setting-player-pos");
    const volumeSlider = document.getElementById("volume-slider");

    if (accentInput) accentInput.value = accentColor;
    if (bgToneSelect) bgToneSelect.value = bgTone;
    if (fontSizeSlider) fontSizeSlider.value = String(fontSize);
    if (fontSizeLabel) fontSizeLabel.textContent = `${fontSize}px`;
    if (densitySelect) densitySelect.value = density;
    if (playerPosSelect) playerPosSelect.value = playerPos;

    if (typeof volume === "number") {
      audio.volume = Math.min(1, Math.max(0, volume));
      if (volumeSlider) volumeSlider.value = String(audio.volume);
    }
  }

  function hexToRgba(hex, alpha) {
    let clean = (hex || "#e11d48").replace("#", "");
    if (clean.length === 3) {
      clean = clean.split("").map((c) => c + c).join("");
    }
    const num = parseInt(clean, 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  /* ==========================================================================
   * INDEXEDDB PERSISTENT AUDIO LIBRARY
   * ========================================================================== */
  function openAudioDB() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error("IndexedDB is not supported in this browser."));
        return;
      }
      const request = indexedDB.open(IDB_CONFIG.NAME, IDB_CONFIG.VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(IDB_CONFIG.STORE_TRACKS)) {
          db.createObjectStore(IDB_CONFIG.STORE_TRACKS, { keyPath: "id" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function saveTrackToDB(trackRecord) {
    const db = await openAudioDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_CONFIG.STORE_TRACKS, "readwrite");
      const store = tx.objectStore(IDB_CONFIG.STORE_TRACKS);
      store.put(trackRecord);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function deleteTrackFromDB(trackId) {
    const db = await openAudioDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_CONFIG.STORE_TRACKS, "readwrite");
      const store = tx.objectStore(IDB_CONFIG.STORE_TRACKS);
      store.delete(trackId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function clearAllTracksFromDB() {
    const db = await openAudioDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_CONFIG.STORE_TRACKS, "readwrite");
      const store = tx.objectStore(IDB_CONFIG.STORE_TRACKS);
      store.clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function loadTracksFromDB() {
    try {
      const db = await openAudioDB();
      const rawRecords = await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_CONFIG.STORE_TRACKS, "readonly");
        const store = tx.objectStore(IDB_CONFIG.STORE_TRACKS);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });

      const validTracks = [];
      for (const rec of rawRecords) {
        if (!rec || !(rec.blob instanceof Blob) || rec.blob.size === 0) {
          await deleteTrackFromDB(rec?.id).catch(() => {});
          continue;
        }
        try {
          const objectUrl = URL.createObjectURL(rec.blob);
          validTracks.push({
            id: rec.id,
            title: rec.title || "Untitled Track",
            artist: rec.artist || "Unknown Artist",
            duration: Number(rec.duration) || 0,
            addedAt: rec.addedAt || Date.now(),
            blob: rec.blob,
            url: objectUrl
          });
        } catch (err) {
          await deleteTrackFromDB(rec.id).catch(() => {});
        }
      }

      validTracks.sort((a, b) => a.addedAt - b.addedAt);
      state.tracks = validTracks;
    } catch (err) {
      console.warn("Could not load tracks from IndexedDB:", err);
      state.tracks = [];
    }
  }

  /* ==========================================================================
   * METADATA EXTRACTION (ID3v2 + Filename Fallback + Audio Duration)
   * ========================================================================== */
  async function extractAudioMetadata(file) {
    const baseName = file.name.replace(/\.[^/.]+$/, "");
    let fallbackArtist = "Unknown Artist";
    let fallbackTitle = baseName;

    if (baseName.includes(" - ")) {
      const parts = baseName.split(" - ");
      fallbackArtist = parts[0].trim() || "Unknown Artist";
      fallbackTitle = parts.slice(1).join(" - ").trim() || baseName;
    }

    let id3 = { title: "", artist: "" };
    try {
      id3 = await parseID3v2Tags(file);
    } catch (_) {
      // Fallback used
    }

    const duration = await probeAudioDuration(file);

    return {
      title: id3.title || fallbackTitle,
      artist: id3.artist || fallbackArtist,
      duration
    };
  }

  async function parseID3v2Tags(file) {
    const headerSlice = file.slice(0, 10);
    const headerBuf = await headerSlice.arrayBuffer();
    const headerView = new DataView(headerBuf);

    if (
      headerBuf.byteLength < 10 ||
      headerView.getUint8(0) !== 0x49 ||
      headerView.getUint8(1) !== 0x44 ||
      headerView.getUint8(2) !== 0x33
    ) {
      return { title: "", artist: "" };
    }

    const version = headerView.getUint8(3);
    if (version !== 3 && version !== 4) {
      return { title: "", artist: "" };
    }

    const tagSize =
      ((headerView.getUint8(6) & 0x7f) << 21) |
      ((headerView.getUint8(7) & 0x7f) << 14) |
      ((headerView.getUint8(8) & 0x7f) << 7) |
      (headerView.getUint8(9) & 0x7f);

    const maxRead = Math.min(tagSize + 10, 262144, file.size);
    const tagBuf = await file.slice(0, maxRead).arrayBuffer();
    const bytes = new Uint8Array(tagBuf);
    const view = new DataView(tagBuf);

    let offset = 10;
    let title = "";
    let artist = "";

    while (offset + 10 <= bytes.length) {
      const frameId = String.fromCharCode(
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3]
      );

      if (!/^[A-Z0-9]{4}$/.test(frameId)) break;

      let frameSize = 0;
      if (version === 4) {
        frameSize =
          ((view.getUint8(offset + 4) & 0x7f) << 21) |
          ((view.getUint8(offset + 5) & 0x7f) << 14) |
          ((view.getUint8(offset + 6) & 0x7f) << 7) |
          (view.getUint8(offset + 7) & 0x7f);
      } else {
        frameSize = view.getUint32(offset + 4);
      }

      if (frameSize <= 0 || offset + 10 + frameSize > bytes.length) break;

      if (frameId === "TIT2" || frameId === "TPE1") {
        const encoding = bytes[offset + 10];
        const contentBytes = bytes.slice(offset + 11, offset + 10 + frameSize);
        const text = decodeID3Text(contentBytes, encoding);
        if (frameId === "TIT2" && text) title = text;
        if (frameId === "TPE1" && text) artist = text;
      }

      if (title && artist) break;
      offset += 10 + frameSize;
    }

    return { title, artist };
  }

  function decodeID3Text(bytes, encoding) {
    try {
      let decoder;
      if (encoding === 0) {
        decoder = new TextDecoder("iso-8859-1");
      } else if (encoding === 1) {
        decoder = new TextDecoder("utf-16");
      } else if (encoding === 2) {
        decoder = new TextDecoder("utf-16be");
      } else {
        decoder = new TextDecoder("utf-8");
      }
      return decoder.decode(bytes).replace(/\0/g, "").trim();
    } catch (_) {
      return "";
    }
  }

  function probeAudioDuration(file) {
    return new Promise((resolve) => {
      const tempAudio = document.createElement("audio");
      const tempUrl = URL.createObjectURL(file);
      tempAudio.preload = "metadata";

      const cleanup = (dur) => {
        URL.revokeObjectURL(tempUrl);
        resolve(Number.isFinite(dur) && dur > 0 ? dur : 0);
      };

      tempAudio.onloadedmetadata = () => cleanup(tempAudio.duration);
      tempAudio.onerror = () => cleanup(0);
      tempAudio.src = tempUrl;
    });
  }

  async function handleFilesImport(fileList) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList).filter(
      (f) => f.type.startsWith("audio/") || /\.(mp3|wav|ogg|flac|m4a|aac|opus|webm)$/i.test(f.name)
    );

    if (files.length === 0) {
      alert("Please select valid audio files (MP3, WAV, OGG, FLAC, M4A).");
      return;
    }

    for (const file of files) {
      const meta = await extractAudioMetadata(file);
      const id = `trk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const addedAt = Date.now();
      const record = {
        id,
        title: meta.title,
        artist: meta.artist,
        duration: meta.duration,
        blob: file,
        addedAt
      };

      await saveTrackToDB(record);
      const url = URL.createObjectURL(file);
      state.tracks.push({ ...record, url });
    }

    renderAll();

    if (state.currentTrackIndex === -1 && state.tracks.length > 0) {
      loadTrackAtIndex(0, false);
    }
  }

  /* ==========================================================================
   * WEB AUDIO API SPECTRUM VISUALIZER
   * ========================================================================== */
  function ensureAudioVisualizerConnected() {
    if (audioCtx) {
      if (audioCtx.state === "suspended") {
        audioCtx.resume().catch(() => {});
      }
      return;
    }
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      audioCtx = new AudioContextClass();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 128;
      sourceNode = audioCtx.createMediaElementSource(audio);
      sourceNode.connect(analyser);
      analyser.connect(audioCtx.destination);
    } catch (err) {
      // Fallback animation still works if Web Audio API fails
    }
  }

  function startVisualizerLoop() {
    const canvas = document.getElementById("audio-visualizer");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const bufferLength = analyser ? analyser.frequencyBinCount : 36;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      visualizerFrameId = requestAnimationFrame(draw);
      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      const accent = state.settings.accentColor || "#e11d48";
      const barCount = 34;
      const gap = 4;
      const barWidth = (width - gap * (barCount - 1)) / barCount;

      if (analyser && state.isPlaying) {
        analyser.getByteFrequencyData(dataArray);
      }

      for (let i = 0; i < barCount; i++) {
        let ratio = 0.08;
        if (state.isPlaying) {
          if (analyser) {
            const val = dataArray[i % dataArray.length] || 0;
            ratio = Math.max(0.08, val / 255);
          } else {
            ratio = 0.15 + 0.65 * Math.abs(Math.sin(Date.now() * 0.006 + i * 0.45));
          }
        }
        const barHeight = Math.max(4, ratio * (height - 6));
        const x = i * (barWidth + gap);
        const y = height - barHeight;

        const grad = ctx.createLinearGradient(0, y, 0, height);
        grad.addColorStop(0, accent);
        grad.addColorStop(1, "rgba(225, 29, 72, 0.15)");

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 3);
        ctx.fill();
      }
    };

    if (!visualizerFrameId) {
      draw();
    }
  }

  /* ==========================================================================
   * AUDIO PLAYBACK ENGINE
   * ========================================================================== */
  function loadTrackAtIndex(index, autoPlay = true) {
    if (index < 0 || index >= state.tracks.length) return;

    const track = state.tracks[index];
    if (!track) return;

    state.currentTrackIndex = index;
    audio.src = track.url;
    audio.load();

    updatePlayerUI();
    renderLibraryTable();
    renderQueueAndRecent();

    if (autoPlay) {
      ensureAudioVisualizerConnected();
      audio.play().then(() => {
        state.isPlaying = true;
        updatePlayPauseIcons();
      }).catch((err) => {
        console.warn("Playback failed for track, removing if unreadable:", err);
        handleUnreadableTrack(track.id);
      });
    } else {
      state.isPlaying = false;
      updatePlayPauseIcons();
    }
  }

  async function handleUnreadableTrack(trackId) {
    const idx = state.tracks.findIndex((t) => t.id === trackId);
    if (idx === -1) return;

    const [removed] = state.tracks.splice(idx, 1);
    if (removed && removed.url) {
      URL.revokeObjectURL(removed.url);
    }
    await deleteTrackFromDB(trackId).catch(() => {});

    if (state.tracks.length === 0) {
      state.currentTrackIndex = -1;
      state.isPlaying = false;
      audio.removeAttribute("src");
      audio.load();
    } else {
      const nextIdx = idx % state.tracks.length;
      loadTrackAtIndex(nextIdx, false);
    }
    renderAll();
  }

  function togglePlayPause() {
    if (state.tracks.length === 0) return;

    if (state.currentTrackIndex === -1) {
      loadTrackAtIndex(0, true);
      return;
    }

    if (audio.paused) {
      ensureAudioVisualizerConnected();
      audio.play().then(() => {
        state.isPlaying = true;
        updatePlayPauseIcons();
      }).catch(() => {
        const current = state.tracks[state.currentTrackIndex];
        if (current) handleUnreadableTrack(current.id);
      });
    } else {
      audio.pause();
      state.isPlaying = false;
      updatePlayPauseIcons();
    }
  }

  function playNextTrack(fromEndedEvent = false) {
    if (state.tracks.length === 0) return;

    if (fromEndedEvent && state.repeatMode === "one") {
      audio.currentTime = 0;
      audio.play();
      return;
    }

    if (state.shuffle && state.tracks.length > 1) {
      let randIdx = state.currentTrackIndex;
      while (randIdx === state.currentTrackIndex) {
        randIdx = Math.floor(Math.random() * state.tracks.length);
      }
      loadTrackAtIndex(randIdx, true);
      return;
    }

    const nextIndex = state.currentTrackIndex + 1;
    if (nextIndex < state.tracks.length) {
      loadTrackAtIndex(nextIndex, true);
    } else if (state.repeatMode === "all" || !fromEndedEvent) {
      loadTrackAtIndex(0, true);
    } else {
      state.isPlaying = false;
      updatePlayPauseIcons();
    }
  }

  function playPrevTrack() {
    if (state.tracks.length === 0) return;

    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }

    const prevIndex =
      state.currentTrackIndex > 0 ? state.currentTrackIndex - 1 : state.tracks.length - 1;
    loadTrackAtIndex(prevIndex, true);
  }

  async function removeTrackById(trackId) {
    const idx = state.tracks.findIndex((t) => t.id === trackId);
    if (idx === -1) return;

    const wasCurrent = idx === state.currentTrackIndex;
    const [removed] = state.tracks.splice(idx, 1);
    if (removed?.url) URL.revokeObjectURL(removed.url);

    await deleteTrackFromDB(trackId).catch(() => {});

    if (state.tracks.length === 0) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      state.currentTrackIndex = -1;
      state.isPlaying = false;
    } else if (wasCurrent) {
      const nextIdx = idx < state.tracks.length ? idx : 0;
      loadTrackAtIndex(nextIdx, state.isPlaying);
    } else if (idx < state.currentTrackIndex) {
      state.currentTrackIndex -= 1;
    }

    renderAll();
  }

  /* ==========================================================================
   * UI RENDERING FUNCTIONS
   * ========================================================================== */
  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const totalSecs = Math.floor(seconds);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
  }

  function renderIdentityEverywhere() {
    const user = getActiveUser();
    const badgeHTML = hasBadge(user.id) ? getBadgeMarkupForUser(user.id) : "";
    const initial = (user.name || "J").charAt(0).toUpperCase();

    const nameIds = [
      "sidebar-username",
      "home-username",
      "stat-active-profile",
      "library-owner-name",
      "stage-username",
      "profile-display-name"
    ];
    nameIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = user.name;
    });

    const badgeIds = [
      "sidebar-badge",
      "home-badge",
      "stat-active-badge",
      "library-owner-badge",
      "stage-badge",
      "profile-badge"
    ];
    badgeIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = badgeHTML;
    });

    // Live preview inside Admin Panel
    const adminPreviewEl = document.getElementById("admin-badge-live-preview");
    if (adminPreviewEl) {
      adminPreviewEl.innerHTML = getBadgeMarkupForUser(null);
    }

    const bioEl = document.getElementById("profile-display-bio");
    if (bioEl) {
      bioEl.textContent = user.bio || "No bio set.";
    }

    const avatarTargets = [
      document.getElementById("sidebar-avatar"),
      document.getElementById("profile-avatar")
    ];
    avatarTargets.forEach((el) => {
      if (!el) return;
      if (user.avatarDataUrl) {
        el.style.backgroundImage = `url("${user.avatarDataUrl}")`;
        el.textContent = "";
      } else {
        el.style.backgroundImage = "none";
        el.textContent = initial;
      }
    });

    const bannerEl = document.getElementById("profile-banner");
    if (bannerEl) {
      if (user.bannerDataUrl) {
        bannerEl.style.backgroundImage = `url("${user.bannerDataUrl}")`;
      } else {
        bannerEl.style.backgroundImage =
          "linear-gradient(135deg, #2a0610 0%, #09090d 55%, #3b0714 100%)";
      }
    }

    const nameInput = document.getElementById("profile-name-input");
    const bioInput = document.getElementById("profile-bio-input");
    if (nameInput && document.activeElement !== nameInput) {
      nameInput.value = user.name;
    }
    if (bioInput && document.activeElement !== bioInput) {
      bioInput.value = user.bio || "";
    }
  }

  function renderStats() {
    const countEl = document.getElementById("stat-track-count");
    const durationEl = document.getElementById("stat-total-duration");

    if (countEl) countEl.textContent = String(state.tracks.length);

    if (durationEl) {
      const totalSeconds = state.tracks.reduce((acc, t) => acc + (Number(t.duration) || 0), 0);
      durationEl.textContent = formatTime(totalSeconds);
    }
  }

  function renderLibraryTable() {
    const tbody = document.getElementById("library-tbody");
    const emptyEl = document.getElementById("library-empty");
    if (!tbody || !emptyEl) return;

    const query = state.searchQuery.trim().toLowerCase();
    const filtered = state.tracks
      .map((track, originalIndex) => ({ track, originalIndex }))
      .filter(({ track }) => {
        if (!query) return true;
        return (
          track.title.toLowerCase().includes(query) ||
          track.artist.toLowerCase().includes(query)
        );
      });

    tbody.innerHTML = "";

    if (filtered.length === 0) {
      emptyEl.classList.remove("hidden");
      return;
    }

    emptyEl.classList.add("hidden");

    filtered.forEach(({ track, originalIndex }, displayIdx) => {
      const tr = document.createElement("tr");
      if (originalIndex === state.currentTrackIndex) {
        tr.classList.add("playing-row");
      }

      const tdIndex = document.createElement("td");
      tdIndex.className = "col-index";
      tdIndex.textContent =
        originalIndex === state.currentTrackIndex && state.isPlaying
          ? "▶"
          : String(displayIdx + 1);

      const tdTitle = document.createElement("td");
      tdTitle.className = "col-title";
      tdTitle.textContent = track.title;

      const tdArtist = document.createElement("td");
      tdArtist.className = "col-artist";
      tdArtist.textContent = track.artist;

      const tdDuration = document.createElement("td");
      tdDuration.className = "col-duration";
      tdDuration.textContent = formatTime(track.duration);

      const tdActions = document.createElement("td");
      tdActions.className = "col-actions";

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "btn btn-danger-outline btn-xs";
      delBtn.textContent = "Remove";
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        removeTrackById(track.id);
      });

      tdActions.appendChild(delBtn);
      tr.append(tdIndex, tdTitle, tdArtist, tdDuration, tdActions);

      tr.addEventListener("click", () => {
        loadTrackAtIndex(originalIndex, true);
      });

      tbody.appendChild(tr);
    });
  }

  function renderQueueAndRecent() {
    const recentContainer = document.getElementById("home-recent-list");
    const queueContainer = document.getElementById("player-queue-list");
    const queueStatus = document.getElementById("queue-status-text");

    if (queueStatus) {
      queueStatus.textContent = `${state.tracks.length} track${state.tracks.length === 1 ? "" : "s"}`;
    }

    if (recentContainer) {
      recentContainer.innerHTML = "";
      if (state.tracks.length === 0) {
        recentContainer.innerHTML = `<p class="empty-hint">No tracks added yet. Drop some audio files to start listening.</p>`;
      } else {
        const recent = [...state.tracks].slice(-5).reverse();
        recent.forEach((track) => {
          const realIdx = state.tracks.findIndex((t) => t.id === track.id);
          const item = createMiniTrackElement(track, realIdx);
          recentContainer.appendChild(item);
        });
      }
    }

    if (queueContainer) {
      queueContainer.innerHTML = "";
      if (state.tracks.length === 0) {
        queueContainer.innerHTML = `<p class="empty-hint">Queue is empty. Import audio files from the Library tab.</p>`;
      } else {
        state.tracks.forEach((track, idx) => {
          const item = createMiniTrackElement(track, idx);
          queueContainer.appendChild(item);
        });
      }
    }
  }

  function createMiniTrackElement(track, index) {
    const div = document.createElement("div");
    div.className = "mini-track-item" + (index === state.currentTrackIndex ? " active" : "");

    const left = document.createElement("div");
    left.className = "truncate-text";
    left.innerHTML = `<strong>${escapeHTML(track.title)}</strong> <span class="hint">— ${escapeHTML(track.artist)}</span>`;

    const right = document.createElement("span");
    right.className = "time-label";
    right.textContent = formatTime(track.duration);

    div.append(left, right);
    div.addEventListener("click", () => loadTrackAtIndex(index, true));
    return div;
  }

  function renderProfileSwitcher() {
    const listEl = document.getElementById("profile-switcher-list");
    if (!listEl) return;
    listEl.innerHTML = "";

    state.users.forEach((u) => {
      const row = document.createElement("div");
      row.className = "profile-item" + (u.id === state.activeUserId ? " active-profile" : "");

      const left = document.createElement("div");
      left.className = "user-row-left";

      const av = document.createElement("div");
      av.className = "mini-avatar";
      if (u.avatarDataUrl) {
        av.style.backgroundImage = `url("${u.avatarDataUrl}")`;
      } else {
        av.textContent = (u.name || "U").charAt(0).toUpperCase();
      }

      const nameWrap = document.createElement("div");
      nameWrap.innerHTML = `<strong>${escapeHTML(u.name)}</strong><span class="badge-slot">${
        hasBadge(u.id) ? getBadgeMarkupForUser(u.id) : ""
      }</span>`;

      left.append(av, nameWrap);

      const right = document.createElement("div");
      if (u.id === state.activeUserId) {
        const activeTag = document.createElement("span");
        activeTag.className = "hint";
        activeTag.textContent = "Active";
        right.appendChild(activeTag);
      } else {
        const switchBtn = document.createElement("button");
        switchBtn.type = "button";
        switchBtn.className = "btn btn-secondary btn-xs";
        switchBtn.textContent = "Switch";
        switchBtn.addEventListener("click", () => {
          state.activeUserId = u.id;
          localStorage.setItem(STORAGE_KEYS.ACTIVE_USER_ID, u.id);
          renderAll();
        });
        right.appendChild(switchBtn);
      }

      row.append(left, right);
      listEl.appendChild(row);
    });
  }

  function renderAdminPanel() {
    const navAdmin = document.getElementById("nav-admin");
    if (navAdmin) {
      navAdmin.classList.toggle("hidden", !state.adminUnlocked);
    }

    const listEl = document.getElementById("admin-users-list");
    if (!listEl) return;
    listEl.innerHTML = "";

    state.users.forEach((u) => {
      const verified = hasBadge(u.id);
      const hasCustomUserIcon = Boolean(state.userBadgeDataUrls[u.id]);
      const row = document.createElement("div");
      row.className = "admin-user-row";

      const left = document.createElement("div");
      left.className = "user-row-left";

      const av = document.createElement("div");
      av.className = "mini-avatar";
      if (u.avatarDataUrl) {
        av.style.backgroundImage = `url("${u.avatarDataUrl}")`;
      } else {
        av.textContent = (u.name || "U").charAt(0).toUpperCase();
      }

      const info = document.createElement("div");
      info.innerHTML = `
        <div>
          <strong>${escapeHTML(u.name)}</strong>
          <span class="badge-slot">${verified ? getBadgeMarkupForUser(u.id) : ""}</span>
        </div>
        <div class="hint">ID: ${escapeHTML(u.id)}</div>
      `;

      left.append(av, info);

      const actionsWrap = document.createElement("div");
      actionsWrap.className = "admin-row-actions";

      // Per-user custom badge icon upload button
      const fileInputId = `user-badge-file-${u.id}`;
      const uploadLabel = document.createElement("label");
      uploadLabel.className = "btn btn-secondary btn-xs";
      uploadLabel.setAttribute("for", fileInputId);
      uploadLabel.textContent = "Custom Icon";

      const fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.id = fileInputId;
      fileInput.accept = "image/*";
      fileInput.className = "hidden";
      fileInput.addEventListener("change", async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
          const badgeDataUrl = await readBadgeImageNormalized(file);
          state.userBadgeDataUrls[u.id] = badgeDataUrl;
          state.badges[u.id] = true; // Automatically enable badge when uploading custom icon
          saveBadges();
          saveCustomBadgeIcons();
          renderAll();
        } catch (err) {
          alert("Could not load custom badge image.");
        }
        e.target.value = "";
      });

      actionsWrap.append(uploadLabel, fileInput);

      if (hasCustomUserIcon) {
        const resetUserIconBtn = document.createElement("button");
        resetUserIconBtn.type = "button";
        resetUserIconBtn.className = "btn btn-danger-outline btn-xs";
        resetUserIconBtn.textContent = "Reset Icon";
        resetUserIconBtn.addEventListener("click", () => {
          delete state.userBadgeDataUrls[u.id];
          saveCustomBadgeIcons();
          renderAll();
        });
        actionsWrap.appendChild(resetUserIconBtn);
      }

      // Grant / Revoke toggle button
      const actionBtn = document.createElement("button");
      actionBtn.type = "button";
      actionBtn.className = verified ? "btn btn-danger-outline btn-xs" : "btn btn-primary btn-xs";
      actionBtn.textContent = verified ? "Revoke Badge" : "Grant Badge";
      actionBtn.addEventListener("click", () => {
        state.badges[u.id] = !verified;
        saveBadges();
        renderAll();
      });

      actionsWrap.appendChild(actionBtn);
      row.append(left, actionsWrap);
      listEl.appendChild(row);
    });
  }

  function updatePlayerUI() {
    const current = state.tracks[state.currentTrackIndex];
    const titleEl = document.getElementById("player-title");
    const artistEl = document.getElementById("player-artist");
    const stageTitle = document.getElementById("stage-title");
    const stageArtist = document.getElementById("stage-artist");

    if (current) {
      if (titleEl) titleEl.textContent = current.title;
      if (artistEl) artistEl.textContent = current.artist;
      if (stageTitle) stageTitle.textContent = current.title;
      if (stageArtist) stageArtist.textContent = current.artist;
    } else {
      if (titleEl) titleEl.textContent = "No track loaded";
      if (artistEl) artistEl.textContent = "Add local audio files to begin";
      if (stageTitle) stageTitle.textContent = "No Track Selected";
      if (stageArtist) stageArtist.textContent = "Select or drop a track from your library";
    }
  }

  function updatePlayPauseIcons() {
    const iconPlay = document.getElementById("icon-play");
    const iconPause = document.getElementById("icon-pause");
    const stageArt = document.getElementById("player-stage-art");
    const vinylGlow = document.getElementById("vinyl-glow-ring");
    const miniEq = document.getElementById("mini-eq-bars");

    if (iconPlay && iconPause) {
      iconPlay.classList.toggle("hidden", state.isPlaying);
      iconPause.classList.toggle("hidden", !state.isPlaying);
    }

    if (stageArt) {
      stageArt.classList.toggle("spinning", state.isPlaying);
    }

    if (vinylGlow) {
      vinylGlow.classList.toggle("active", state.isPlaying);
    }

    if (miniEq) {
      miniEq.classList.toggle("active", state.isPlaying);
    }
  }

  function renderAll() {
    renderIdentityEverywhere();
    renderStats();
    renderLibraryTable();
    renderQueueAndRecent();
    renderProfileSwitcher();
    renderAdminPanel();
    updatePlayerUI();
    updatePlayPauseIcons();
  }

  function escapeHTML(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ==========================================================================
   * IMAGE PROCESSING HELPERS (Profile Images & Strict 64x64 Badge Icon Normalizer)
   * ========================================================================== */
  function readImageFileAsDataURL(file, maxDimension = 900) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith("image/")) {
        reject(new Error("Invalid image file."));
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          let { width, height } = img;
          if (width > maxDimension || height > maxDimension) {
            if (width > height) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            } else {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", 0.85));
        };
        img.onerror = () => reject(new Error("Could not decode image."));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error("File read error."));
      reader.readAsDataURL(file);
    });
  }

  /**
   * Normalizes any uploaded badge image onto a crisp 64x64 transparent PNG canvas
   * (preserving aspect ratio centered) so it renders sharply at 18x18px and never
   * bloats localStorage or overflows the UI.
   */
  function readBadgeImageNormalized(file) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith("image/")) {
        reject(new Error("Invalid image file."));
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const TARGET_SIZE = 64;
          const canvas = document.createElement("canvas");
          canvas.width = TARGET_SIZE;
          canvas.height = TARGET_SIZE;
          const ctx = canvas.getContext("2d");
          ctx.clearRect(0, 0, TARGET_SIZE, TARGET_SIZE);

          const scale = Math.min(TARGET_SIZE / img.width, TARGET_SIZE / img.height);
          const drawW = Math.round(img.width * scale);
          const drawH = Math.round(img.height * scale);
          const offsetX = Math.round((TARGET_SIZE - drawW) / 2);
          const offsetY = Math.round((TARGET_SIZE - drawH) / 2);

          ctx.drawImage(img, offsetX, offsetY, drawW, drawH);
          resolve(canvas.toDataURL("image/png"));
        };
        img.onerror = () => reject(new Error("Could not decode badge image."));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error("File read error."));
      reader.readAsDataURL(file);
    });
  }

  /* ==========================================================================
   * NAVIGATION & EVENT LISTENERS
   * ========================================================================== */
  function switchView(viewName) {
    if (viewName === "admin" && !state.adminUnlocked) {
      return;
    }

    document.querySelectorAll(".view").forEach((sec) => {
      sec.classList.toggle("active", sec.id === `view-${viewName}`);
    });

    document.querySelectorAll(".side-nav .nav-item").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-view") === viewName);
    });
  }

  function bindEvents() {
    document.querySelectorAll(".side-nav .nav-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = btn.getAttribute("data-view");
        if (target) switchView(target);
      });
    });

    document.querySelectorAll("[data-goto]").forEach((btn) => {
      btn.addEventListener("click", () => {
        switchView(btn.getAttribute("data-goto"));
      });
    });

    const sidebarCard = document.getElementById("sidebar-user-trigger");
    if (sidebarCard) {
      sidebarCard.addEventListener("click", () => switchView("profile"));
    }

    const fileInput = document.getElementById("file-input");
    const triggerFileInput = () => fileInput && fileInput.click();

    document.getElementById("home-add-files-btn")?.addEventListener("click", triggerFileInput);
    document.getElementById("home-browse-btn")?.addEventListener("click", triggerFileInput);
    document.getElementById("library-add-btn")?.addEventListener("click", triggerFileInput);

    fileInput?.addEventListener("change", (e) => {
      handleFilesImport(e.target.files);
      fileInput.value = "";
    });

    ["home-dropzone", "library-dropzone"].forEach((zoneId) => {
      const zone = document.getElementById(zoneId);
      if (!zone) return;

      zone.addEventListener("dragover", (e) => {
        e.preventDefault();
        zone.classList.add("dragover");
      });

      zone.addEventListener("dragleave", () => {
        zone.classList.remove("dragover");
      });

      zone.addEventListener("drop", (e) => {
        e.preventDefault();
        zone.classList.remove("dragover");
        if (e.dataTransfer?.files?.length) {
          handleFilesImport(e.dataTransfer.files);
        }
      });
    });

    const searchInput = document.getElementById("library-search");
    searchInput?.addEventListener("input", (e) => {
      state.searchQuery = e.target.value || "";
      renderLibraryTable();
    });

    document.getElementById("library-clear-btn")?.addEventListener("click", async () => {
      if (state.tracks.length === 0) return;
      if (!confirm("Remove all tracks from your browser library?")) return;

      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      state.tracks.forEach((t) => t.url && URL.revokeObjectURL(t.url));
      state.tracks = [];
      state.currentTrackIndex = -1;
      state.isPlaying = false;

      await clearAllTracksFromDB().catch(() => {});
      renderAll();
    });

    document.getElementById("btn-play")?.addEventListener("click", togglePlayPause);
    document.getElementById("stage-play-btn")?.addEventListener("click", togglePlayPause);

    document.getElementById("btn-next")?.addEventListener("click", () => playNextTrack(false));
    document.getElementById("stage-next-btn")?.addEventListener("click", () => playNextTrack(false));

    document.getElementById("btn-prev")?.addEventListener("click", playPrevTrack);
    document.getElementById("stage-prev-btn")?.addEventListener("click", playPrevTrack);

    const shuffleBtn = document.getElementById("btn-shuffle");
    shuffleBtn?.addEventListener("click", () => {
      state.shuffle = !state.shuffle;
      shuffleBtn.classList.toggle("active", state.shuffle);
    });

    const repeatBtn = document.getElementById("btn-repeat");
    const repeatBadge = document.getElementById("repeat-badge");
    repeatBtn?.addEventListener("click", () => {
      if (state.repeatMode === "off") {
        state.repeatMode = "all";
        repeatBtn.classList.add("active");
        repeatBadge?.classList.add("hidden");
        repeatBtn.title = "Repeat Mode: All";
      } else if (state.repeatMode === "all") {
        state.repeatMode = "one";
        repeatBtn.classList.add("active");
        repeatBadge?.classList.remove("hidden");
        repeatBtn.title = "Repeat Mode: One";
      } else {
        state.repeatMode = "off";
        repeatBtn.classList.remove("active");
        repeatBadge?.classList.add("hidden");
        repeatBtn.title = "Repeat Mode: Off";
      }
    });

    const seekSlider = document.getElementById("seek-slider");
    const timeCurrent = document.getElementById("time-current");
    const timeTotal = document.getElementById("time-total");

    audio.addEventListener("timeupdate", () => {
      if (timeCurrent) timeCurrent.textContent = formatTime(audio.currentTime);
      if (seekSlider && Number.isFinite(audio.duration) && audio.duration > 0) {
        seekSlider.value = String((audio.currentTime / audio.duration) * 100);
      }
    });

    audio.addEventListener("loadedmetadata", () => {
      if (timeTotal) timeTotal.textContent = formatTime(audio.duration);
      const current = state.tracks[state.currentTrackIndex];
      if (current && (!current.duration || current.duration === 0) && Number.isFinite(audio.duration)) {
        current.duration = audio.duration;
        saveTrackToDB({
          id: current.id,
          title: current.title,
          artist: current.artist,
          duration: current.duration,
          blob: current.blob,
          addedAt: current.addedAt
        }).catch(() => {});
        renderStats();
        renderLibraryTable();
      }
    });

    audio.addEventListener("ended", () => {
      playNextTrack(true);
    });

    audio.addEventListener("error", () => {
      const current = state.tracks[state.currentTrackIndex];
      if (current) {
        handleUnreadableTrack(current.id);
      }
    });

    seekSlider?.addEventListener("input", (e) => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        const pct = parseFloat(e.target.value);
        audio.currentTime = (pct / 100) * audio.duration;
      }
    });

    const volumeSlider = document.getElementById("volume-slider");
    volumeSlider?.addEventListener("input", (e) => {
      const val = parseFloat(e.target.value);
      audio.volume = val;
      audio.muted = val === 0;
      state.settings.volume = val;
      saveSettings();
    });

    document.getElementById("btn-mute")?.addEventListener("click", () => {
      audio.muted = !audio.muted;
      const waves = document.getElementById("vol-waves");
      if (waves) waves.classList.toggle("hidden", audio.muted);
    });

    const profileForm = document.getElementById("profile-form");
    profileForm?.addEventListener("submit", (e) => {
      e.preventDefault();
      const nameInput = document.getElementById("profile-name-input");
      const bioInput = document.getElementById("profile-bio-input");
      const errEl = document.getElementById("profile-name-error");
      const msgEl = document.getElementById("profile-save-msg");

      const trimmedName = (nameInput?.value || "").trim();
      if (!trimmedName || trimmedName.length > 32) {
        if (errEl) {
          errEl.textContent = "Display name cannot be empty and must be at most 32 characters.";
          errEl.classList.remove("hidden");
        }
        return;
      }

      errEl?.classList.add("hidden");
      const user = getActiveUser();
      user.name = trimmedName;
      user.bio = (bioInput?.value || "").trim().slice(0, 160);
      saveUsers();
      renderAll();

      if (msgEl) {
        msgEl.textContent = "Saved!";
        setTimeout(() => {
          msgEl.textContent = "";
        }, 2200);
      }
    });

    document.getElementById("avatar-upload-input")?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const dataUrl = await readImageFileAsDataURL(file, 400);
        const user = getActiveUser();
        user.avatarDataUrl = dataUrl;
        saveUsers();
        renderAll();
      } catch (err) {
        alert("Could not load avatar image.");
      }
      e.target.value = "";
    });

    document.getElementById("avatar-remove-btn")?.addEventListener("click", () => {
      const user = getActiveUser();
      user.avatarDataUrl = "";
      saveUsers();
      renderAll();
    });

    document.getElementById("banner-upload-input")?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const dataUrl = await readImageFileAsDataURL(file, 1200);
        const user = getActiveUser();
        user.bannerDataUrl = dataUrl;
        saveUsers();
        renderAll();
      } catch (err) {
        alert("Could not load banner image.");
      }
      e.target.value = "";
    });

    document.getElementById("banner-remove-btn")?.addEventListener("click", () => {
      const user = getActiveUser();
      user.bannerDataUrl = "";
      saveUsers();
      renderAll();
    });

    document.getElementById("create-profile-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = document.getElementById("new-profile-name");
      const errEl = document.getElementById("create-profile-error");
      const trimmed = (input?.value || "").trim();

      if (!trimmed || trimmed.length > 32) {
        if (errEl) {
          errEl.textContent = "Enter a valid profile name (1–32 characters).";
          errEl.classList.remove("hidden");
        }
        return;
      }

      errEl?.classList.add("hidden");
      const newUser = {
        id: `user_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: trimmed,
        bio: "Local listener on Bad Player.",
        avatarDataUrl: "",
        bannerDataUrl: ""
      };

      state.users.push(newUser);
      state.activeUserId = newUser.id;
      saveUsers();
      localStorage.setItem(STORAGE_KEYS.ACTIVE_USER_ID, newUser.id);
      if (input) input.value = "";
      renderAll();
    });

    // Live Settings Customization
    document.getElementById("setting-accent")?.addEventListener("input", (e) => {
      state.settings.accentColor = e.target.value;
      applySettingsToDOM();
      saveSettings();
    });

    document.querySelectorAll(".swatch").forEach((sw) => {
      sw.addEventListener("click", () => {
        const color = sw.getAttribute("data-color");
        if (color) {
          state.settings.accentColor = color;
          applySettingsToDOM();
          saveSettings();
        }
      });
    });

    document.getElementById("setting-bg-tone")?.addEventListener("change", (e) => {
      state.settings.bgTone = e.target.value;
      applySettingsToDOM();
      saveSettings();
    });

    document.getElementById("setting-font-size")?.addEventListener("input", (e) => {
      state.settings.fontSize = Number(e.target.value);
      applySettingsToDOM();
      saveSettings();
    });

    document.getElementById("setting-density")?.addEventListener("change", (e) => {
      state.settings.density = e.target.value;
      applySettingsToDOM();
      saveSettings();
    });

    document.getElementById("setting-player-pos")?.addEventListener("change", (e) => {
      state.settings.playerPos = e.target.value;
      applySettingsToDOM();
      saveSettings();
    });

    document.getElementById("reset-settings-btn")?.addEventListener("click", () => {
      state.settings = { ...DEFAULT_SETTINGS };
      applySettingsToDOM();
      saveSettings();
    });

    // Admin Access Unlock (Password = "333")
    const adminForm = document.getElementById("admin-unlock-form");
    adminForm?.addEventListener("submit", (e) => {
      e.preventDefault();
      const passInput = document.getElementById("admin-password-input");
      const errEl = document.getElementById("admin-password-error");
      const okEl = document.getElementById("admin-unlock-success");

      if (passInput?.value === ADMIN_PASSWORD) {
        state.adminUnlocked = true;
        errEl?.classList.add("hidden");
        okEl?.classList.remove("hidden");
        if (passInput) passInput.value = "";
        renderAdminPanel();
      } else {
        errEl?.classList.remove("hidden");
        okEl?.classList.add("hidden");
      }
    });

    // Admin Global Custom Badge Upload & Reset
    document.getElementById("admin-global-badge-input")?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const normalizedDataUrl = await readBadgeImageNormalized(file);
        state.globalBadgeDataUrl = normalizedDataUrl;
        saveCustomBadgeIcons();
        renderAll();
      } catch (err) {
        alert("Could not process badge image.");
      }
      e.target.value = "";
    });

    document.getElementById("admin-reset-badge-btn")?.addEventListener("click", () => {
      state.globalBadgeDataUrl = "";
      state.userBadgeDataUrls = {};
      saveCustomBadgeIcons();
      renderAll();
    });

    document.getElementById("admin-lock-btn")?.addEventListener("click", () => {
      state.adminUnlocked = false;
      document.getElementById("admin-unlock-success")?.classList.add("hidden");
      renderAdminPanel();
      switchView("settings");
    });
  }

  /* ==========================================================================
   * INITIALIZATION
   * ========================================================================== */
  async function initApp() {
    loadLocalState();
    applySettingsToDOM();
    bindEvents();
    await loadTracksFromDB();
    renderAll();
    startVisualizerLoop();
  }

  document.addEventListener("DOMContentLoaded", initApp);
})();