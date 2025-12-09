const path = require("path");
const http = require("http");
const express = require("express");
const socketio = require("socket.io");
const multer = require("multer");
const fs = require("fs");
const formatMessage = require("./utils/messages");
const { getProfile, updateProfile, createProfile, checkPassword, getAllRoles, createRole, updateRole, deleteRole, assignRoleToUser, getRoleByUser } = require("./utils/profiles");
require("dotenv").config();

const {
  userJoin,
  getCurrentUser,
  userLeave,
  getRoomUsers,
  getUserByUsername,
  getAllUsers,
} = require("./utils/users");

const app = express();
const server = http.createServer(app);
const io = socketio(server);

// In-memory reaction store: { messageId: { emoji: Set(usernames) } }
const reactionsStore = {};

// Middleware
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Multer configuration for avatar uploads
const avatarStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, 'public/uploads/avatars');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, file.fieldname + '-' + uniqueSuffix + ext);
    }
});

const avatarUpload = multer({ 
    storage: avatarStorage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    },
    fileFilter: function (req, file, cb) {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Nur Bilddateien sind erlaubt!'), false);
        }
    }
});

// Multer configuration for file uploads (chat files)
const fileStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, 'public/uploads/files');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, 'file-' + uniqueSuffix + ext);
    }
});

const fileUpload = multer({ 
    storage: fileStorage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    },
    fileFilter: function (req, file, cb) {
        // Allow images, documents, and common file types
        const allowedTypes = [
            'image/', 'text/', 'application/pdf', 'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/zip', 'application/x-rar-compressed'
        ];
        
        const isAllowed = allowedTypes.some(type => file.mimetype.startsWith(type) || file.mimetype === type);
        
        if (isAllowed) {
            cb(null, true);
        } else {
            cb(new Error('Dateityp nicht erlaubt!'), false);
        }
    }
});

// Keep the old upload variable for backward compatibility
const upload = avatarUpload;

const botName = "Chat Togehter";

// File cleanup tracking (only for chat files, not avatars)
const uploadedFiles = new Map(); // filename -> uploadTime
const FILE_RETENTION_HOURS = 24; // Chat files are deleted after 24 hours

// Nachrichten-Zähler für den Tag
let dailyMessageCount = 0;
let lastResetDate = new Date().toDateString();

// Funktion zum Zurücksetzen des Zählers um Mitternacht
function resetDailyMessageCount() {
    const currentDate = new Date().toDateString();
    if (currentDate !== lastResetDate) {
        dailyMessageCount = 0;
        lastResetDate = currentDate;
        console.log('Täglicher Nachrichten-Zähler zurückgesetzt');
    }
}

// Funktion zum Löschen alter Chat-Dateien (nicht Avatare)
function cleanupOldFiles() {
    const now = Date.now();
    const cutoffTime = now - (FILE_RETENTION_HOURS * 60 * 60 * 1000);
    
    for (const [filename, uploadTime] of uploadedFiles.entries()) {
        if (uploadTime < cutoffTime) {
            const filePath = path.join(__dirname, 'public/uploads/files', filename);
            
            // Delete file from filesystem
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log(`Gelöschte alte Chat-Datei: ${filename}`);
            }
            
            // Remove from tracking
            uploadedFiles.delete(filename);
        }
    }
}

// Cleanup alle 6 Stunden ausführen
setInterval(cleanupOldFiles, 6 * 60 * 60 * 1000);

// Initial cleanup beim Start
cleanupOldFiles();

// Profile API Routes
app.get('/api/profile/:username', (req, res) => {
    try {
        const username = req.params.username;
        const profile = getProfile(username);
        res.json({
            success: true,
            data: profile
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Fehler beim Laden des Profils'
        });
    }
});

// Room User Counts API Route
app.get('/api/room-users', (req, res) => {
    try {
        const allUsers = getAllUsers();
        
        // Gruppiere User nach Räumen
        const roomUserCounts = {};
        allUsers.forEach(user => {
            if (!roomUserCounts[user.room]) {
                roomUserCounts[user.room] = 0;
            }
            roomUserCounts[user.room]++;
        });
        
        res.json({
            success: true,
            data: roomUserCounts
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Fehler beim Laden der Raum-Statistiken'
        });
    }
});

// Live Stats API Route
app.get('/api/stats', (req, res) => {
    try {
        // Prüfe und setze den täglichen Zähler zurück
        resetDailyMessageCount();
        
        const allUsers = getAllUsers();
        const totalOnlineUsers = allUsers.length;
        
        // Gruppiere User nach Räumen
        const roomStats = {};
        allUsers.forEach(user => {
            if (!roomStats[user.room]) {
                roomStats[user.room] = 0;
            }
            roomStats[user.room]++;
        });
        
        res.json({
            success: true,
            data: {
                onlineUsers: totalOnlineUsers,
                activeRooms: Object.keys(roomStats).length,
                roomStats: roomStats,
                dailyMessages: dailyMessageCount,
                uptime: process.uptime(),
                timestamp: Date.now()
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Fehler beim Laden der Statistiken'
        });
    }
});

// File Upload API Route (only for chat files)
app.post('/api/upload-file', fileUpload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'Keine Datei hochgeladen'
            });
        }

        // Track file for cleanup (only chat files, not avatars)
        uploadedFiles.set(req.file.filename, Date.now());

        const fileInfo = {
            filename: req.file.filename,
            originalName: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size,
            path: `/uploads/files/${req.file.filename}`,
            uploadedBy: req.body.username || 'unknown',
            uploadedAt: new Date().toISOString()
        };

        console.log(`Chat-Datei hochgeladen: ${req.file.originalname} (${req.file.filename})`);

        res.json({
            success: true,
            data: fileInfo
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({
            success: false,
            message: 'Fehler beim Hochladen der Datei'
        });
    }
});

app.post('/api/profile/update', avatarUpload.single('avatar'), (req, res) => {
    try {
        const { username, displayName, bio, location, website } = req.body;
        
        if (!username) {
            return res.status(400).json({
                success: false,
                message: 'Benutzername ist erforderlich'
            });
        }
        
        const profileData = {
            displayName: displayName || username,
            bio: bio || '',
            location: location || '',
            website: website || ''
        };
        
        // Handle avatar upload
        if (req.file) {
            profileData.avatar = req.file.filename;
        }
        
        const success = updateProfile(username, profileData);
        
        if (success) {
            // Avatare werden NICHT für Cleanup getrackt - sie bleiben dauerhaft
            if (req.file) {
                console.log(`Avatar hochgeladen (bleibt dauerhaft): ${req.file.originalname} (${req.file.filename})`);
            }
            
            res.json({
                success: true,
                message: 'Profil erfolgreich aktualisiert'
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Fehler beim Speichern des Profils'
            });
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Fehler beim Aktualisieren des Profils'
        });
    }
});

// Registrierung
app.post('/api/register', (req, res) => {
    const { username, password, displayName } = req.body;
    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Benutzername und Passwort sind erforderlich.' });
    }
    if (username.length < 3 || password.length < 3) {
        return res.status(400).json({ success: false, message: 'Benutzername und Passwort müssen mindestens 3 Zeichen lang sein.' });
    }
    const ok = createProfile(username, password, displayName);
    if (!ok) {
        return res.status(400).json({ success: false, message: 'Benutzername existiert bereits.' });
    }
    return res.json({ success: true, message: 'Registrierung erfolgreich.' });
});
// Login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Benutzername und Passwort sind erforderlich.' });
    }
    if (!checkPassword(username, password)) {
        return res.status(401).json({ success: false, message: 'Benutzername oder Passwort falsch.' });
    }
    return res.json({ success: true, message: 'Login erfolgreich.' });
});

// Farbdefinitionen
const red     = "\x1b[31m";   // Dunkelrot
const green   = "\x1b[32m";   // Dunkelgrün
const yellow  = "\x1b[33m";   // Gelb
const blue    = "\x1b[34m";   // Dunkelblau
const magenta = "\x1b[35m";   // Magenta
const cyan    = "\x1b[36m";   // Cyan
const white   = "\x1b[37m";   // Weiß
const reset   = "\x1b[0m";    // Reset
const bold    = "\x1b[1m";

function logEvent(type, msg, extra = "") {
  let color = white;
  let icon = "";
  switch(type) {
    case "connect": color = green; icon = "[+]"; break;
    case "disconnect": color = red; icon = "[-]"; break;
    case "join": color = cyan; icon = "[⇨]"; break;
    case "msg": color = yellow; icon = "[✉]"; break;
    case "error": color = red; icon = "[!]"; break;
    case "kick": color = magenta; icon = "[KICK]"; break;
    case "edit": color = blue; icon = "[✎]"; break;
    case "delete": color = red; icon = "[✗]"; break;
    case "info": color = blue; icon = "[i]"; break;
    default: color = white; icon = "[ ]";
  }
  console.log(`${color}${icon}${reset} ${msg} ${extra}`);
}

io.on("connection", (socket) => {
  logEvent("connect", `Neue Verbindung: ${magenta}${socket.id}${reset}`);

  socket.on("joinRoom", ({ username, room }) => {
    logEvent("join", `Nutzer ${blue}${username}${reset} (${magenta}${socket.id}${reset}) ist der Gruppe ${cyan}${room}${reset} beigetreten!`);
    const { user, error } = userJoin(socket.id, username, room);

    if (error) {
      logEvent("error", `Fehler beim Beitritt: ${error}`);
      socket.emit("usernameError", error);
      return;
    }

    socket.join(user.room);
    const version = "1.1.6";

    socket.emit("message", formatMessage(botName, `Herzlich willkommen ${user.username}, \nChat Togehter - dein Chat Netzwerk! \nDu befindest dich gerade in der ${user.room} Gruppe! \n\nChat Togehter v${version} Beta`, user.room));

    socket.broadcast
      .to(user.room)
      .emit("message", formatMessage(botName, `${user.username} ist beigetreten.`, user.room));

    io.to(user.room).emit("roomUsers", {
      room: user.room,
      users: getRoomUsers(user.room),
    });
  });

  socket.on("chatMessage", (payload) => {
    const user = getCurrentUser(socket.id);
    if (user) {
      resetDailyMessageCount();
      dailyMessageCount++;

      let text = payload;
      let extra = {};
      if (payload && typeof payload === 'object') {
        text = payload.text;
        if (payload.replyTo) {
          extra.replyTo = payload.replyTo; // { id, username, text }
        }
        if (payload.type === 'file' && payload.fileInfo) {
          extra.fileInfo = payload.fileInfo;
          extra.messageType = 'file';
        }
      }

      logEvent("msg", `Nachricht von ${blue}${user.username}${reset} (${magenta}${socket.id}${reset}) in ${cyan}${user.room}${reset}:`, `${yellow}${text}${reset}`);
      const message = formatMessage(user.username, text, user.room, extra);
      io.to(user.room).emit("message", message);
    }
  });

  // Reactions: add/remove reaction for a message
  socket.on('toggleReaction', ({ messageId, emoji }) => {
    const user = getCurrentUser(socket.id);
    if (!user || !messageId || !emoji) return;

    if (!reactionsStore[messageId]) reactionsStore[messageId] = {};
    if (!reactionsStore[messageId][emoji]) reactionsStore[messageId][emoji] = new Set();

    const usersSet = reactionsStore[messageId][emoji];
    if (usersSet.has(user.username)) {
      usersSet.delete(user.username);
      // remove emoji key if empty
      if (usersSet.size === 0) delete reactionsStore[messageId][emoji];
    } else {
      usersSet.add(user.username);
    }

    // Prepare serializable payload
    const serializable = {};
    Object.keys(reactionsStore[messageId] || {}).forEach(e => {
      serializable[e] = Array.from(reactionsStore[messageId][e]);
    });

    io.to(user.room).emit('reactionsUpdated', { messageId, reactions: serializable });
  });

  // Tipp-Indikator
  socket.on("typing", () => {
    const user = getCurrentUser(socket.id);
    if (!user) return;
    socket.broadcast.to(user.room).emit("typing", { username: user.username });
  });

  socket.on("stopTyping", () => {
    const user = getCurrentUser(socket.id);
    if (!user) return;
    socket.broadcast.to(user.room).emit("stopTyping", { username: user.username });
  });

  // Lesebestätigungen
  socket.on("messageDelivered", ({ messageId }) => {
    const user = getCurrentUser(socket.id);
    if (!user || !messageId) return;
    io.to(user.room).emit("messageReceipt", { messageId, type: "delivered", by: user.username });
  });

  socket.on("messageSeen", ({ messageId }) => {
    const user = getCurrentUser(socket.id);
    if (!user || !messageId) return;
    io.to(user.room).emit("messageReceipt", { messageId, type: "seen", by: user.username });
  });

  socket.on("deleteMessage", ({ id }) => {
    const user = getCurrentUser(socket.id);
    if (!user) return;
    // Nur Admin und Mod dürfen löschen
    if (user.role === "admin" || user.role === "mod") {
      logEvent("delete", `Nachricht ${id} wird global gelöscht durch ${user.username} (${user.role})`);
      io.to(user.room).emit("deleteMessageGlobal", { id });
    }
  });

  socket.on("editMessage", ({ id, newText }) => {
    const user = getCurrentUser(socket.id);
    if (!user) return;
    // Admin, Mod oder der User selbst darf editieren
    // (Im Frontend wird das ohnehin geprüft, aber hier nochmal sicher)
    // Hier müsste man eigentlich die Message-Owner-ID prüfen, aber das ist im aktuellen System nicht gespeichert.
    // Wir lassen erstmal: Jeder kann eigene Nachrichten editieren, Admin/Mod alles (Frontend regelt das UI)
    logEvent("edit", `editMessage von ${user.username} (${user.role}) in ${user.room}: ${id} => ${newText}`);
    io.to(user.room).emit("messageEdited", { id, newText });
  });

  socket.on("kickUser", (targetUsername) => {
    const adminUser = getCurrentUser(socket.id);
    if (!adminUser) return;
    // Nur Admin und Mod dürfen kicken
    if (!(adminUser.role === "admin" || adminUser.role === "mod")) return;
    const targetUser = getUserByUsername(targetUsername, adminUser.room);
    if (!targetUser) return;
    // Mod darf keine Admins/Mods kicken, Admin darf alle kicken
    if (adminUser.role === "mod" && (targetUser.role === "admin" || targetUser.role === "mod")) return;
    logEvent("kick", `Benutzer ${targetUsername} (${targetUser.role}) wird gekickt von ${adminUser.username} (${adminUser.role})`);
    io.to(targetUser.id).emit("usernameError", "Du wurdest aus der Gruppe entfernt.");
    io.sockets.sockets.get(targetUser.id)?.disconnect();
  });

  socket.on("updateUserRole", async ({ username: targetUsername, role: newRole }) => {
    const adminUser = getCurrentUser(socket.id);
    if (!adminUser || adminUser.role !== "admin") {
      logEvent("error", `Rollenänderung verweigert: ${blue}${adminUser?.username || 'Unbekannt'}${reset} ist kein Admin.`);
      return;
    }

    const targetProfile = getProfile(targetUsername);
    if (!targetProfile) {
      logEvent("error", `Rollenänderung fehlgeschlagen: Benutzer ${blue}${targetUsername}${reset} nicht gefunden.`);
      return;
    }

    if (targetProfile.role === "admin" && newRole !== "admin") {
      logEvent("error", `Admin-Rolle von ${blue}${targetUsername}${reset} kann nicht geändert werden, außer zu Admin selbst.`);
      return;
    }

    const success = updateProfile(targetUsername, { role: newRole });
    if (success) {
      logEvent("info", `Rolle von ${blue}${targetUsername}${reset} geändert zu ${cyan}${newRole}${reset} durch ${blue}${adminUser.username}${reset}.`);
      const targetSocketUser = getUserByUsername(targetUsername, adminUser.room);
      if (targetSocketUser) {
        io.to(targetSocketUser.id).emit("usernameError", "Deine Rolle wurde geändert. Bitte logge dich neu ein.");
        io.sockets.sockets.get(targetSocketUser.id)?.disconnect();
      }
    } else {
      logEvent("error", `Fehler beim Speichern der Rolle für ${blue}${targetUsername}${reset}.`);
    }
  });

  socket.on("leaveRoom", () => {
    const user = getCurrentUser(socket.id);
    if (user) {
      logEvent("leave", `Nutzer ${blue}${user.username}${reset} verlässt die Gruppe ${cyan}${user.room}${reset} manuell.`);
      const leftUser = userLeave(socket.id);
      if (leftUser) {
        io.to(user.room).emit("message", formatMessage(botName, `${user.username} hat die Gruppe verlassen.`, user.room));
        io.to(user.room).emit("roomUsers", {
          room: user.room,
          users: getRoomUsers(user.room),
        });
      }
    }
  });

  socket.on("disconnect", () => {
    logEvent("disconnect", `Verbindung getrennt: ${magenta}${socket.id}${reset}`);
    const user = userLeave(socket.id);
    if (user) {
      io.to(user.room).emit("message", formatMessage(botName, `${user.username} hat die Gruppe verlassen.`, user.room));
      io.to(user.room).emit("roomUsers", {
        room: user.room,
        users: getRoomUsers(user.room),
      });
    }
  });
});
// Rollen-API (nur Admin)
app.get('/api/roles', (req, res) => {
  // TODO: Authentifizierung prüfen (hier nur Demo, später erweitern)
  res.json({ success: true, data: getAllRoles() });
});

app.post('/api/roles', (req, res) => {
  // Nur Admins dürfen Rollen anlegen
  const { roleId, name, prefix, color } = req.body;
  if (!roleId || !name || !prefix || !color) {
    return res.status(400).json({ success: false, message: 'Fehlende Felder' });
  }
  const ok = createRole(roleId, { name, prefix, color });
  if (!ok) return res.status(400).json({ success: false, message: 'Rolle existiert bereits' });
  res.json({ success: true });
});

app.put('/api/roles/:roleId', (req, res) => {
  // Nur Admins dürfen Rollen bearbeiten
  const { roleId } = req.params;
  const { name, prefix, color } = req.body;
  const ok = updateRole(roleId, { name, prefix, color });
  if (!ok) return res.status(404).json({ success: false, message: 'Rolle nicht gefunden' });
  res.json({ success: true });
});

app.delete('/api/roles/:roleId', (req, res) => {
  // Nur Admins dürfen Rollen löschen
  const { roleId } = req.params;
  const ok = deleteRole(roleId);
  if (!ok) return res.status(404).json({ success: false, message: 'Rolle nicht gefunden' });
  res.json({ success: true });
});

app.post('/api/roles/assign', (req, res) => {
  // Nur Admins dürfen Rollen zuweisen
  const { roleId, username } = req.body;
  if (!roleId || !username) {
    return res.status(400).json({ success: false, message: 'Fehlende Felder' });
  }
  const ok = assignRoleToUser(roleId, username);
  // Custom: Schreibe die Rollen-ID ins Profil
  const profileOk = updateProfile(username, { role: roleId });
  // User kicken, damit Rolle sofort greift
  let kicked = false;
  const allUsers = getAllUsers();
  const userObj = allUsers.find(u => u.username === username);
  if (userObj) {
    io.to(userObj.id).emit("usernameError", "Deine Rolle wurde geändert. Bitte logge dich neu ein.");
    io.sockets.sockets.get(userObj.id)?.disconnect();
    kicked = true;
  }
  if (!ok || !profileOk) return res.status(400).json({ success: false, message: 'Fehler beim Zuweisen' });
  res.json({ success: true, kicked });
});

app.get('/api/roles/user/:username', (req, res) => {
  const { username } = req.params;
  const role = getRoleByUser(username);
  res.json({ success: true, data: role });
});

const PORT = process.env.PORT || 7070;
server.listen(PORT, () => {
    logEvent("info", `Server läuft auf Port ${blue}${PORT}${reset}`);
    logEvent("info", `File Cleanup aktiviert - Chat-Dateien werden nach ${FILE_RETENTION_HOURS} Stunden gelöscht`);
    logEvent("info", `Avatar Cleanup deaktiviert - Profilbilder bleiben dauerhaft gespeichert`);
});

