const users = [];
const { getProfile } = require('./profiles');

function userJoin(id, username, room) {
  const existingUser = users.find(
    (user) => user.room === room && user.username === username
  );

  if (existingUser) {
    return { error: 'Dieser Benutzername ist in diesem Raum bereits vergeben.' };
  }

  const profile = getProfile(username);
  const user = { id, username, room, role: profile.role || 'user' };
  users.push(user);
  return { user };
}

function getCurrentUser(id) {
  return users.find((user) => user.id === id);
}

function userLeave(id) {
  const index = users.findIndex((user) => user.id === id);
  if (index !== -1) {
    return users.splice(index, 1)[0];
  }
}

function getRoomUsers(room) {
  return users.filter((user) => user.room === room);
}

function getUserByUsername(username, room) {
  return users.find(
    (user) => user.username === username && user.room === room
  );
}

function getAllUsers() {
  return users;
}

module.exports = {
  userJoin,
  getCurrentUser,
  userLeave,
  getRoomUsers,
  getUserByUsername,
  getAllUsers,
};
