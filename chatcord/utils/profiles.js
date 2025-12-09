const fs = require('fs');
const path = require('path');

const PROFILES_FILE = path.join(__dirname, '../data/profiles.json');
const PROFILES_DIR = path.dirname(PROFILES_FILE);

// Ensure profiles directory exists
if (!fs.existsSync(PROFILES_DIR)) {
    fs.mkdirSync(PROFILES_DIR, { recursive: true });
}

// Initialize profiles file if it doesn't exist
if (!fs.existsSync(PROFILES_FILE)) {
    fs.writeFileSync(PROFILES_FILE, JSON.stringify({}, null, 2));
}

function loadProfiles() {
    try {
        const data = fs.readFileSync(PROFILES_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error loading profiles:', error);
        return {};
    }
}

function saveProfiles(profiles) {
    try {
        fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2));
        return true;
    } catch (error) {
        console.error('Error saving profiles:', error);
        return false;
    }
}

function createProfile(username, password, displayName = "", role = "user") {
    const profiles = loadProfiles();
    if (profiles[username]) {
        return false; // Benutzer existiert schon
    }
    profiles[username] = {
        username: username,
        password: password, // Achtung: Für echte Projekte Hash verwenden!
        displayName: displayName || username,
        bio: '',
        location: '',
        website: '',
        avatar: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        role: role
    };
    return saveProfiles(profiles);
}

function checkPassword(username, password) {
    const profiles = loadProfiles();
    if (!profiles[username]) return false;
    return profiles[username].password === password;
}

function getProfile(username) {
    const profiles = loadProfiles();
    const p = profiles[username] || {
        username: username,
        displayName: username,
        bio: '',
        location: '',
        website: '',
        avatar: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        password: undefined,
        role: 'user'
    };
    // Niemals das Passwort nach außen geben lol
    const { password, ...safeProfile } = p;
    return safeProfile;
}

function updateProfile(username, profileData) {
    const profiles = loadProfiles();
    const existingProfile = profiles[username] || {
        username: username,
        createdAt: new Date().toISOString(),
        password: profileData.password || undefined,
        role: profileData.role || 'user'
    };
    profiles[username] = {
        ...existingProfile,
        ...profileData,
        updatedAt: new Date().toISOString()
    };
    return saveProfiles(profiles);
}

function deleteProfile(username) {
    const profiles = loadProfiles();
    delete profiles[username];
    return saveProfiles(profiles);
}

function getAllProfiles() {
    return loadProfiles();
}

const ROLES_FILE = path.join(__dirname, '../data/roles.json');

function loadRoles() {
    try {
        const data = fs.readFileSync(ROLES_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error loading roles:', error);
        return {};
    }
}

function saveRoles(roles) {
    try {
        fs.writeFileSync(ROLES_FILE, JSON.stringify(roles, null, 2));
        return true;
    } catch (error) {
        console.error('Error saving roles:', error);
        return false;
    }
}

function getAllRoles() {
    return loadRoles();
}

function createRole(roleId, { name, prefix, color }) {
    const roles = loadRoles();
    if (roles[roleId]) return false;
    roles[roleId] = { name, prefix, color, users: [] };
    return saveRoles(roles);
}

function updateRole(roleId, data) {
    const roles = loadRoles();
    if (!roles[roleId]) return false;
    roles[roleId] = { ...roles[roleId], ...data };
    return saveRoles(roles);
}

function deleteRole(roleId) {
    const roles = loadRoles();
    if (!roles[roleId]) return false;
    delete roles[roleId];
    return saveRoles(roles);
}

function assignRoleToUser(roleId, username) {
    const roles = loadRoles();
    // Remove user from all roles first
    Object.keys(roles).forEach(rid => {
        roles[rid].users = roles[rid].users.filter(u => u !== username);
    });
    if (roles[roleId]) {
        roles[roleId].users.push(username);
    }
    return saveRoles(roles);
}

function getRoleByUser(username) {
    const roles = loadRoles();
    for (const [roleId, role] of Object.entries(roles)) {
        if (role.users.includes(username)) {
            return { roleId, ...role };
        }
    }
    return null;
}

module.exports = {
    getProfile,
    updateProfile,
    deleteProfile,
    getAllProfiles,
    createProfile,
    checkPassword,
    // Rollen-API
    getAllRoles,
    createRole,
    updateRole,
    deleteRole,
    assignRoleToUser,
    getRoleByUser
};
