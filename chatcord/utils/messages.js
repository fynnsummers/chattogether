const { v4: uuidv4 } = require("uuid");

function formatMessage(username, text, room = null, extra = {}) {
  return {
    id: uuidv4(),
    username,
    text,
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    ...(room ? { room } : {}),
    ...(extra && typeof extra === 'object' ? extra : {})
  };
}

module.exports = formatMessage;
