const chatForm = document.getElementById('chat-form');
const chatMessages = document.querySelector('.chat-messages');
const roomName = document.getElementById('room-name');
const userList = document.getElementById('users');

const newMessageSound = document.getElementById('new-message-sound');
const newUserSound = document.getElementById('new-user-sound');
const selfMessageSound = document.getElementById('self-message-sound');

const { username, room } = Qs.parse(location.search, {
  ignoreQueryPrefix: true,
});

const socket = io();
let previousUsers = [];
let currentUserRole = 'user';
let currentReply = null; // { id, username, text }
let typingTimer;
const TYPING_DEBOUNCE = 2500; // ms

socket.emit('joinRoom', { username, room });

socket.on('usernameError', (errorMessage) => {
  alert(errorMessage);
  window.location = '../index.html';
});

socket.on('roomUsers', ({ room, users }) => {
  outputRoomName(room);

  if (previousUsers.length && users.length > previousUsers.length) {
    newUserSound.play().catch((e) => console.log("Audio error:", e));
  }

  outputUsers(users);
  previousUsers = users;
  
  // Update online users count
  const _onlineUsersEl = document.getElementById('online-users');
  if (_onlineUsersEl) _onlineUsersEl.innerText = users.length;
  
  // Update mod panel if it's open (guard in case element missing)
  try {
    if (typeof modPanelOverlay !== 'undefined' && modPanelOverlay && modPanelOverlay.style && modPanelOverlay.style.display === 'flex') {
      renderModPanel(users);
    }
  } catch (e) { /* ignore if modPanelOverlay missing */ }

  // Update server switch modal if it's open (guard element access)
  const _serverSwitchOverlay = document.getElementById('server-switch-overlay');
  if (_serverSwitchOverlay && _serverSwitchOverlay.style && _serverSwitchOverlay.style.display === 'flex') {
    updateServerUserCounts();
  }
});

socket.on('message', (message) => {
  // Remove any typing indicator before appending message
  const existingTyping = chatMessages.querySelector('.typing-indicator');
  if (existingTyping) existingTyping.remove();
  outputMessage(message);

  if (message.username !== username) {
    newMessageSound.play().catch((e) => console.log("Audio error:", e));
  }

  chatMessages.scrollTop = chatMessages.scrollHeight;
  // Sende Zustellbestätigung für nicht eigene Nachrichten
  if (message.username !== username) {
    socket.emit('messageDelivered', { messageId: message.id });
  }
  
  // Update message counter
  totalMessages++;
  const _totalMessagesEl = document.getElementById('total-messages');
  if (_totalMessagesEl) _totalMessagesEl.innerText = totalMessages;
});

// Reactions update from server
socket.on('reactionsUpdated', ({ messageId, reactions }) => {
  const msg = document.querySelector(`.message[data-id="${messageId}"]`);
  if (!msg) return;

    // read previous counts to animate differences
    const existing = msg.querySelector('.reactions');
    const prevCounts = {};
    if (existing) {
      existing.querySelectorAll('.reaction-btn').forEach(b => {
        const em = b.dataset.emoji;
        if (em) {
          // try parsing trailing number
          const txt = b.innerText || '';
          const m = txt.match(/\s(\d+)$/);
          prevCounts[em] = m ? parseInt(m[1], 10) : 0;
        }
      });
      existing.remove();
    }

    // build reactions container
    const rc = document.createElement('div');
    rc.className = 'reactions';
    Object.keys(reactions || {}).forEach(emoji => {
      const users = reactions[emoji] || [];
      const btn = document.createElement('button');
      btn.className = 'reaction-btn';
      btn.dataset.emoji = emoji;
      // emoji label
      btn.textContent = emoji + ' ';

      // count span (animated on change)
      const countSpan = document.createElement('span');
      countSpan.className = 'reaction-count';
      countSpan.innerText = users.length;
      btn.appendChild(countSpan);

      // mark if current user reacted
      if (users.includes(username)) btn.classList.add('reacted');

      // animate if count changed
      const prev = typeof prevCounts[emoji] !== 'undefined' ? prevCounts[emoji] : null;
      if (prev !== null && prev !== users.length) {
        if (users.length > prev) {
          countSpan.classList.add('count-bounce-up');
        } else {
          countSpan.classList.add('count-bounce-down');
        }
        // small pop on the whole button as well
        btn.classList.add('count-pop');
        // remove animation classes after animation ends so future changes animate again
        countSpan.addEventListener('animationend', () => { countSpan.classList.remove('count-bounce-up', 'count-bounce-down'); });
        btn.addEventListener('animationend', () => { btn.classList.remove('count-pop'); });
      }

      btn.addEventListener('click', () => {
        socket.emit('toggleReaction', { messageId, emoji });
      });
      rc.appendChild(btn);
    });
    // Prefer inserting reactions before the toggle button so they appear under the text
    const toggle = msg.querySelector('.reaction-toggle-btn');
    if (toggle && toggle.parentNode === msg) {
      msg.insertBefore(rc, toggle);
    } else {
      msg.appendChild(rc);
    }
});

socket.on('deleteMessageGlobal', ({ id }) => {
  const msg = document.querySelector(`.message[data-id="${id}"]`);
  if (msg) {
    msg.remove();
  }
});

socket.on('messageEdited', ({ id, newText }) => {
  const messageDiv = document.querySelector(`.message[data-id="${id}"]`);
  if (messageDiv) {
    const textP = messageDiv.querySelector('.text');
    if (textP && textP.innerText !== newText) {
      textP.innerText = newText;
    }
  }
});


chatForm.addEventListener('submit', (e) => {
  e.preventDefault();

  let msg = e.target.elements.msg.value.trim();
  if (!msg) return false;

  selfMessageSound.play().catch((e) => console.log("Audio error:", e));
  // wenn Reply aktiv, Metadaten mitsenden
  if (currentReply) {
    socket.emit('chatMessage', { text: msg, replyTo: currentReply });
  } else {
    socket.emit('chatMessage', msg);
  }

  e.target.elements.msg.value = '';
  e.target.elements.msg.focus();
  hideReplyBar();
  // Stop typing indicator when sending a message
  try {
    socket.emit('stopTyping');
  } catch (err) {
    console.warn('socket stopTyping emit failed', err);
  }
  if (typeof isTyping !== 'undefined') {
    isTyping = false;
  }
  if (typeof typingTimer !== 'undefined') {
    clearTimeout(typingTimer);
  }
});

function outputMessage(message) {
  const div = document.createElement('div');
  div.classList.add('message');
  div.setAttribute('data-id', message.id);

  // For now, use username as display name to avoid blocking
  let displayName = message.username;
  
  // Load profile data in background (non-blocking)
  fetch(`/api/profile/${encodeURIComponent(message.username)}`)
    .then(response => response.json())
    .then(async profile => {
      if (profile.success) {
        if (profile.data.displayName) {
          // Update display name if available
          const nameSpan = div.querySelector('.meta span:first-child');
          if (nameSpan && !nameSpan.classList.contains('admin-name') && !nameSpan.classList.contains('mod-name') && !nameSpan.classList.contains('bot-name')) {
            nameSpan.textContent = profile.data.displayName;
          }
        }
        if (profile.data.role) {
          // Update role tag - insert before the first span (username)
          const firstSpan = div.querySelector('.meta span:first-child');
          if (firstSpan && profile.data.role !== 'user') {
            const roleSpan = document.createElement('span');
            if (profile.data.role === 'admin') {
              roleSpan.className = 'admin-name';
              roleSpan.textContent = 'ADMIN';
            } else if (profile.data.role === 'mod') {
              roleSpan.className = 'mod-name';
              roleSpan.textContent = 'MODERATOR';
            } else {
              // Custom-Rolle: Hole Prefix/Farbe
              const allRoles = await fetchAllRoles();
              const r = allRoles[profile.data.role];
              if (r) {
                roleSpan.className = 'custom-role-tag';
                roleSpan.textContent = r.prefix;
                roleSpan.style.background = r.color;
                roleSpan.style.color = '#fff';
                roleSpan.style.borderRadius = '8px';
                roleSpan.style.padding = '2px 8px';
              }
            }
            div.querySelector('.meta').insertBefore(roleSpan, firstSpan);
          }
        }
        if (profile.data.avatar) {
          // Add avatar to message
          const existingAvatar = div.querySelector('.message-avatar');
          if (existingAvatar) {
            existingAvatar.remove();
          }
          
          const avatarImg = document.createElement('img');
          avatarImg.src = `/uploads/avatars/${profile.data.avatar}`;
          avatarImg.alt = `${message.username} Avatar`;
          avatarImg.classList.add('message-avatar');
          div.insertBefore(avatarImg, div.firstChild);
        }
      }
    })
    .catch(error => {
      console.log('Error loading profile:', error);
    });

  const p = document.createElement('p');
  p.classList.add('meta');

  if (message.username === 'Chat Togehter') {
    p.innerHTML = `<span class="bot-name">BOT</span> <span>${displayName}</span> <span>${message.time}</span>`;
  } else {
    p.innerHTML = `<span>${displayName}</span> <span>${message.time}</span>`;
  }

  // Delete button - only for admin/mod
  if (currentUserRole === 'admin' || currentUserRole === 'mod') {
    const deleteBtn = document.createElement('span');
    deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
    deleteBtn.style.cursor = 'pointer';
    deleteBtn.style.marginLeft = '10px';
    deleteBtn.style.color = 'rgb(255, 79, 79)';
    deleteBtn.addEventListener('click', () => {
      socket.emit('deleteMessage', {
        id: message.id,
      });
    });
    p.appendChild(deleteBtn);
  }

  // Edit button - for own messages or admin/mod
  if (message.username === username || currentUserRole === 'admin' || currentUserRole === 'mod') {
    const editBtn = document.createElement('span');
    editBtn.innerHTML = '<i class="fas fa-pencil-alt"></i>';
    editBtn.style.cursor = 'pointer';
    editBtn.style.marginLeft = '10px';
    editBtn.style.color = 'gray';
    editBtn.classList.add('edit-message'); 

    editBtn.addEventListener('click', () => {
      const textP = div.querySelector('.text');
      const originalText = textP.innerText;

      const input = document.createElement('div');
      input.contentEditable = true;
      input.innerText = originalText;
      input.className = 'text edit-message';

      div.replaceChild(input, textP);
      input.focus();

      let hasSaved = false;

      const saveEdit = () => {
        if (hasSaved) return;
        hasSaved = true;

        const newText = input.innerText.trim();
        if (newText && newText !== originalText) {
          socket.emit('editMessage', {
            id: message.id,
            newText
          });
        }

        const newTextP = document.createElement('p');
        newTextP.className = 'text';
        newTextP.innerText = newText || originalText;

        if (input.parentNode === div) {
          div.replaceChild(newTextP, input);
        }
      };

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          saveEdit();
          input.blur();
        }
      });

      input.addEventListener('blur', saveEdit);
    });

    p.appendChild(editBtn);
  }


  div.appendChild(p);

  if (message.replyTo && message.replyTo.id) {
    const replyBox = document.createElement('div');
    replyBox.className = 'reply-box';
    replyBox.innerHTML = `<i class="fas fa-reply"></i> <strong>${message.replyTo.username}</strong>: ${escapeHtml(message.replyTo.text).slice(0, 140)}`;
    div.appendChild(replyBox);
  }

  const para = document.createElement('p');
  para.classList.add('text');
  para.innerText = message.text;
  div.appendChild(para);

  // Handle file messages
  if (message.fileInfo) {
    const fileInfo = message.fileInfo;
    const isImage = fileInfo.mimetype.startsWith('image/');
    
    if (isImage) {
      // Image preview
      const imagePreview = document.createElement('div');
      imagePreview.className = 'image-preview';
      imagePreview.onclick = () => openImageModal(fileInfo.path);
      
      const img = document.createElement('img');
      img.src = fileInfo.path;
      img.alt = fileInfo.originalName;
      img.loading = 'lazy';
      
      imagePreview.appendChild(img);
      div.appendChild(imagePreview);
    } else {
      // File download
      const fileContainer = document.createElement('div');
      fileContainer.className = 'message-file';
      
      const filePreview = document.createElement('div');
      filePreview.className = 'file-preview';
      filePreview.onclick = () => downloadFile(fileInfo.path, fileInfo.originalName);
      
      const fileIcon = document.createElement('div');
      fileIcon.className = 'file-icon';
      fileIcon.innerHTML = getFileTypeIcon(fileInfo.mimetype, fileInfo.originalName);
      
      const fileInfoDiv = document.createElement('div');
      fileInfoDiv.className = 'file-info';
      
      const fileName = document.createElement('div');
      fileName.className = 'file-name';
      fileName.textContent = fileInfo.originalName;
      
      const fileSize = document.createElement('div');
      fileSize.className = 'file-size';
      fileSize.textContent = formatFileSize(fileInfo.size);
      
      fileInfoDiv.appendChild(fileName);
      fileInfoDiv.appendChild(fileSize);
      
      const downloadBtn = document.createElement('button');
      downloadBtn.className = 'file-download';
      downloadBtn.innerHTML = '<i class="fas fa-download"></i>';
      
      filePreview.appendChild(fileIcon);
      filePreview.appendChild(fileInfoDiv);
      filePreview.appendChild(downloadBtn);
      fileContainer.appendChild(filePreview);
      div.appendChild(fileContainer);
    }
  }

  const replyBtn = document.createElement('span');
  replyBtn.innerHTML = '<i class="fas fa-reply"></i>';
  replyBtn.style.cursor = 'pointer';
  replyBtn.style.marginLeft = '4px';
  replyBtn.style.color = '#5874ff';
  replyBtn.title = 'Antworten';
  replyBtn.addEventListener('click', () => {
    const previewText = div.querySelector('.text')?.innerText || '';
    currentReply = { id: message.id, username: message.username, text: previewText };
    showReplyBar(currentReply);
    msgInput.focus();
  });
  p.appendChild(replyBtn);

  // Reaction UI: single toggle button bottom-right that opens a small picker
  const reactionToggle = document.createElement('button');
  reactionToggle.className = 'reaction-toggle-btn';
  reactionToggle.title = 'React';
  // Use Font Awesome smile instead of heart
  reactionToggle.innerHTML = '<i class="fas fa-smile"></i>';

  // Picker popup (hidden initially)
  const picker = document.createElement('div');
  picker.className = 'reaction-picker-popup';
  picker.style.display = 'none';
  const quick = ['👍','❤️','😂','😮','😢','🎉','👑','🔥'];
  quick.forEach(emo => {
    const b = document.createElement('button');
    b.className = 'reaction-small';
    b.innerText = emo;
    b.title = `React with ${emo}`;
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      socket.emit('toggleReaction', { messageId: message.id, emoji: emo });
      picker.style.display = 'none';
    });
    picker.appendChild(b);
  });

  // Toggle picker visibility
  reactionToggle.addEventListener('click', (ev) => {
    ev.stopPropagation();
    picker.style.display = picker.style.display === 'none' ? 'flex' : 'none';
  });

  // Close picker when clicking outside
  document.addEventListener('click', () => {
    if (picker) picker.style.display = 'none';
  });

  // Ensure message container is positioned relative for absolute children
  div.style.position = 'relative';
  div.appendChild(picker);
  div.appendChild(reactionToggle);

  chatMessages.appendChild(div);

  // Ensure typing indicator (if any) stays after last message
  const existingTyping = chatMessages.querySelector('.typing-indicator');
  if (existingTyping) {
    chatMessages.appendChild(existingTyping);
  }
}


function outputRoomName(room) {
  roomName.innerText = `# ${room}`;
}

// outputUsers: User-Liste mit Rolle für Mod-Panel bereitstellen
function outputUsers(users) {
  userList.innerHTML = '';
  previousUsers = users;
  
  for (const user of users) {
    const li = document.createElement('li');
    li.className = 'user-item';
    
    // For now, use username as display name to avoid blocking
    let displayName = user.username;
    let userRole = user.role || 'user';
    
    // Create user content
    const userContent = document.createElement('div');
    userContent.className = 'user-content';
    
    const userNameSpan = document.createElement('span');
    userNameSpan.textContent = displayName;
    userNameSpan.className = 'user-name';
    userContent.appendChild(userNameSpan);
    
    li.appendChild(userContent);
    
    // Load profile data in background (non-blocking)
    fetch(`/api/profile/${encodeURIComponent(user.username)}`)
      .then(response => response.json())
      .then(async profile => {
        if (profile.success) {
          if (profile.data.displayName) {
            userNameSpan.textContent = profile.data.displayName;
          }
          if (profile.data.role) {
            userRole = profile.data.role;
            // Update user object with current role
            user.role = userRole;
            // Add role tag to user list
            if (userRole !== 'user') {
              const roleSpan = document.createElement('span');
              roleSpan.style.marginLeft = '5px';
              roleSpan.style.fontSize = '12px';
              if (userRole === 'admin') {
                roleSpan.className = 'admin-name';
                roleSpan.textContent = 'ADMIN';
              } else if (userRole === 'mod') {
                roleSpan.className = 'mod-name';
                roleSpan.textContent = 'MOD';
              } else if (allRoles[userRole]) {
                const r = allRoles[userRole];
                roleSpan.className = 'custom-role-tag';
                roleSpan.textContent = r.prefix;
                roleSpan.style.background = r.color;
                roleSpan.style.color = '#fff';
                roleSpan.style.borderRadius = '8px';
                roleSpan.style.fontSize = '12px';
              }
              userContent.appendChild(roleSpan);
            }
          }
          if (profile.data.avatar) {
            // Remove existing avatar if any
            const existingAvatar = userContent.querySelector('.user-avatar');
            if (existingAvatar) {
              existingAvatar.remove();
            }
            
            const avatarImg = document.createElement('img');
            avatarImg.src = `/uploads/avatars/${profile.data.avatar}`;
            avatarImg.alt = `${user.username} Avatar`;
            avatarImg.className = 'user-avatar';
            userContent.insertBefore(avatarImg, userNameSpan);
          }
        }
      })
      .catch(error => {
        console.log('Error loading user profile:', error);
      });

    userList.appendChild(li);
  }
}

// Patch outputUsers für Custom-Rollen (Sidebar)
outputUsers = function(users) {
  userList.innerHTML = '';
  fetchAllRoles().then(allRoles => {
    for (const user of users) {
      const li = document.createElement('li');
      li.className = 'user-item';
      let displayName = user.username;
      let userRole = user.role || 'user';
      const userContent = document.createElement('div');
      userContent.className = 'user-content';
      const userNameSpan = document.createElement('span');
      userNameSpan.textContent = displayName;
      userNameSpan.className = 'user-name';
      userContent.appendChild(userNameSpan);
      
      // Add click event for profile preview
      li.addEventListener('click', () => {
        showProfilePreview(user.username);
      });
      
      // Profile laden
      fetch(`/api/profile/${encodeURIComponent(user.username)}`)
        .then(response => response.json())
        .then(profile => {
          if (profile.success) {
            if (profile.data.displayName) {
              userNameSpan.textContent = profile.data.displayName;
            }
            if (profile.data.role) {
              userRole = profile.data.role;
              user.role = userRole;
              // Custom-Tag
              if (userRole === 'admin') {
                const roleSpan = document.createElement('span');
                roleSpan.className = 'admin-name';
                roleSpan.textContent = 'ADMIN';
                roleSpan.style.marginLeft = '5px';
                roleSpan.style.fontSize = '12px';
                userContent.appendChild(roleSpan);
              } else if (userRole === 'mod') {
                const roleSpan = document.createElement('span');
                roleSpan.className = 'mod-name';
                roleSpan.textContent = 'MOD';
                roleSpan.style.marginLeft = '5px';
                roleSpan.style.fontSize = '12px';
                userContent.appendChild(roleSpan);
              } else if (allRoles[userRole]) {
                const r = allRoles[userRole];
                const roleSpan = createCustomRoleTag(r.prefix, r.color);
                roleSpan.style.marginLeft = '5px';
                roleSpan.style.fontSize = '12px';
                userContent.appendChild(roleSpan);
              }
            }
            if (profile.data.avatar) {
              const existingAvatar = userContent.querySelector('.user-avatar');
              if (existingAvatar) existingAvatar.remove();
              const avatarImg = document.createElement('img');
              avatarImg.src = `/uploads/avatars/${profile.data.avatar}`;
              avatarImg.alt = `${user.username} Avatar`;
              avatarImg.className = 'user-avatar';
              userContent.insertBefore(avatarImg, userNameSpan);
            }
          }
        })
        .catch(error => {
          console.log('Error loading user profile:', error);
        });
      li.appendChild(userContent);
      userList.appendChild(li);
    }
  });
};


// Profile button functionality
const _profileBtn = document.getElementById('profile-btn');
if (_profileBtn) {
  _profileBtn.addEventListener('click', (e) => {
  // Open the full profile page for editing instead of the inline preview
  window.location = `profile.html?username=${encodeURIComponent(username)}&room=${encodeURIComponent(room)}`;
  });
}

const _leaveBtn = document.getElementById('leave-btn');
const _popupOverlay = document.getElementById('popup-overlay');
const _confirmBtn = document.getElementById('confirm-btn');
const _cancelBtn = document.getElementById('cancel-btn');
if (_leaveBtn && _popupOverlay) {
  _leaveBtn.addEventListener('click', () => {
    _popupOverlay.style.display = 'flex';

    if (_confirmBtn) {
      _confirmBtn.addEventListener('click', () => {
        window.location = '../index.html';
      });
    }

    if (_cancelBtn) {
      _cancelBtn.addEventListener('click', () => {
        _popupOverlay.style.display = 'none';
      });
    }
  });
}

const emojiBtn = document.getElementById('emoji-btn');
const emojiPicker = document.getElementById('emoji-picker');
const msgInput = document.getElementById('msg');
const replyBar = document.getElementById('reply-bar');
const replyPreview = document.getElementById('reply-preview');
const replyCancel = document.getElementById('reply-cancel');

const emojis = [
  "😀","😁","😂","🤣","😃","😄","😅","😆","😉","😊","😋","😎","😍","😘","🥰","😗","😙","😚","🙂","🤗",
  "🤩","🤔","🤨","😐","😑","😶","🙄","😏","😣","😥","😮","🤐","😯","😪","😫","😴","😌","😛","😜","😝",
  "🤤","😒","😓","😔","😕","🙃","🤑","😲","☹️","🙁","😖","😞","😟","😤","😢","😭","😦","😧","😨","😩",
  "🤯","😬","😰","😱","🥵","🥶","😳","🤪","😵","😡","😠","🤬","😷","🤒","🤕","🤢","🤮","🤧","😇","🥳",
  "🥺","🤠","😈","👿","👹","👺","💀","👻","👽","👾","🤖","💩","😺","😸","😹","😻","😼","😽","🙀","😿",
  "😾","🙈","🙉","🙊","🐵","🐒","🦍","🦧","🐶","🐕","🦮","🐕‍🦺","🐩","🐺","🦊","🦝","🐱","🐈","🐈‍","🦁",
  "🐯","🐅","🐆","🐴","🐎","🦄","🦓","🦌","🐮","🐂","🐃","🐄","🐷","🐖","🐗","🐽","🐏","🐑","🐐","🐪",
  "🐫","🦙","🦒","🐘","🦣","🦏","🦛","🐭","🐁","🐀","🐹","🐰","🐇","🐿️","🦫","🦔","🦇","🐻","🐨",
  "🐼","🦥","🦦","🦨","🦘","🦡","🐾","🦃","🐔","🐓","🐣","🐤","🐥","🐦","🐧","🕊️","🦅","🦆","🦢","🦉",
  "🦤","🪶","🦩","🦚","🦜","🐸","🐊","🐢","🦎","🐍","🐲","🐉","🦕","🦖","🐳","🐋","🐬","🦭","🐟","🐠",
  "🐡","🦈","🐙","🐚","🪸","🐌","🦋","🐛","🐜","🐝","🪲","🐞","🦗","🪳","🕷️","🕸️","🦂","🦟","🪰","🪱",
  "🦠","💐","🌸","💮","🏵️","🌹","🥀","🌺","🌻","🌼","🌷","🌱","🪴","🌲","🌳","🌴","🌵","🌾","🌿","☘️",
  "🍀","🍁","🍂","🍃","🍄","🌰","🦀","🦞","🦐","🦑","🦪","🌍","🌎","🌏","🌐","🗺️","🧭","🏔️","⛰️","🌋",
  "🗻","🏕️","🏖️","🏜️","🏝️","🏞️","🏟️","🏛️","🏗️","🧱","🪨","🪵","🛖","🏘️","🏚️","🏠","🏡","🏢","🏣",
  "🏤","🏥","🏦","🏨","🏩","🏪","🏫","🏬","🏭","🏯","🏰","💒","🗼","🗽","⛪","🕌","🛕","🕍","⛩️","🕋",
  "⛲","⛺","🌁","🌃","🏙️","🌄","🌅","🌆","🌇","🌉","♨️","🎠","🎡","🎢","💈","🎪","🛝","🛞","🛷","🎿",
  "⛷️","🏂","🪂","🏋️","🏋️‍♂️","🏋️‍♀️","🤼","🤼‍♂️","🤼‍♀️","🤸","🤸‍♂️","🤸‍♀️","⛹️","⛹️‍♂️","⛹️‍♀️","🤺","🤾","🤾‍♂️","🤾‍♀️","🏌️",
  "🏌️‍♂️","🏌️‍♀️","🏇","🧘","🧘‍♂️","🧘‍♀️","🏄","🏄‍♂️","🏄‍♀️","🏊","🏊‍♂️","🏊‍♀️","🤽","🤽‍♂️","🤽‍♀️","🚣","🚣‍♂️","🚣‍♀️","🧗","🧗‍♂️",
  "🧗‍♀️","🚵","🚵‍♂️","🚵‍♀️","🚴","🚴‍♂️","🚴‍♀️","🏆","🥇","🥈","🥉","🏅","🎖️","🏵️","🎗️","🎫","🎟️","🎪","🤹","🤹‍♂️","🤹‍♀️",
];

if (emojiPicker && msgInput) {
  emojis.forEach(emoji => {
    const span = document.createElement('span');
    span.textContent = emoji;
    span.addEventListener('click', () => {
      msgInput.value += emoji;
      emojiPicker.style.display = 'none';
    });
    emojiPicker.appendChild(span);
  });

  if (emojiBtn) {
    emojiBtn.addEventListener('click', () => {
      emojiPicker.style.display = emojiPicker.style.display === 'none' ? 'flex' : 'none';
    });
  }

  document.addEventListener('click', function (e) {
    if (!emojiPicker.contains(e.target) && e.target !== emojiBtn && !(emojiBtn && emojiBtn.contains(e.target))) {
      emojiPicker.style.display = 'none';
    }
  });
}

// Typing indicator handling: debounce input, emit typing/stopTyping and show indicator under last message
let isTyping = false;
const typingUsers = new Set();

function updateTypingIndicator() {
  // remove existing indicator
  const existing = chatMessages.querySelector('.typing-indicator');
  if (existing) existing.remove();

  if (typingUsers.size === 0) return;

  const names = Array.from(typingUsers);
  let text = '';
  if (names.length === 1) {
    text = `${names[0]} schreibt...`;
  } else if (names.length === 2) {
    text = `${names[0]} und ${names[1]} schreiben...`;
  } else {
    text = `${names[0]} und ${names.length - 1} weitere schreiben...`;
  }

  const div = document.createElement('div');
  div.className = 'typing-indicator';
  div.innerText = text;
  // Append under the last message
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function scheduleStopTyping() {
  if (typingTimer) clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    if (isTyping) {
      try { socket.emit('stopTyping'); } catch (e) { /* ignore */ }
      isTyping = false;
    }
  }, TYPING_DEBOUNCE);
}

if (msgInput) {
  msgInput.addEventListener('input', () => {
    try {
      if (!isTyping) {
        socket.emit('typing');
        isTyping = true;
      }
    } catch (e) {
      // ignore if socket not ready
    }
    scheduleStopTyping();
  });

  msgInput.addEventListener('blur', () => {
    try { socket.emit('stopTyping'); } catch (e) {}
    isTyping = false;
    if (typingTimer) clearTimeout(typingTimer);
  });
}

socket.on('typing', ({ username: typingUser }) => {
  if (!typingUser || typingUser === username) return;
  typingUsers.add(typingUser);
  updateTypingIndicator();
});

socket.on('stopTyping', ({ username: typingUser }) => {
  if (!typingUser) return;
  typingUsers.delete(typingUser);
  updateTypingIndicator();
});


// Reply Bar helpers
function showReplyBar(reply) {
  replyPreview.textContent = `${reply.username}: ${reply.text.slice(0, 140)}`;
  replyBar.style.display = '';
  replyCancel.style.display = '';
}

function hideReplyBar() {
  currentReply = null;
  replyBar.style.display = 'none';
  replyCancel.style.display = 'none';
  replyPreview.textContent = '';
}

replyCancel.addEventListener('click', hideReplyBar);

// Read receipts per Sichtbarkeit
// Deaktiviert: Seen-Event (nur zugestellt bleibt aktiv)
const observer = new IntersectionObserver((entries) => {
  // no-op
}, { root: chatMessages, threshold: 1.0 });

const _appendChild = chatMessages.appendChild.bind(chatMessages);
chatMessages.appendChild = function(child) {
  const el = _appendChild(child);
  if (el?.classList?.contains('message')) {
    observer.observe(el);
  }
  return el;
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
let totalMessages = 0;
let startTime = Date.now();

  function formatElapsedTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
  }

  function updateActiveTime() {
    const now = Date.now();
    const elapsed = now - startTime;
    document.getElementById('active-time').innerText = formatElapsedTime(elapsed);
  }

  setInterval(updateActiveTime, 1000);

  // Update message counter and online users count (moved to existing listeners)
  // These are now handled in the main socket listeners above
  // Handler for Times

function isMobile() {
  return window.innerWidth <= 900;
}

const sidebar = document.querySelector('.chat-sidebar');
const headerImg = document.querySelector('.chat-header img');
const overlay = document.getElementById('overlay');

if (headerImg) {
  headerImg.addEventListener('click', () => {
    if (!isMobile()) return;

    if (sidebar) sidebar.classList.toggle('show');
    if (overlay) overlay.classList.toggle('active');

    if (sidebar && sidebar.classList.contains('show')) {
      document.body.classList.add('sidebar-open');
    } else {
      document.body.classList.remove('sidebar-open');
    }
  });
}

if (overlay) {
  overlay.addEventListener('click', () => {
    if (sidebar) sidebar.classList.remove('show');
    overlay.classList.remove('active');
    document.body.classList.remove('sidebar-open');
  });
}

window.addEventListener('load', () => {
  if (isMobile()) {
    sidebar.classList.remove('show');
    overlay.classList.remove('active');
    document.body.classList.remove('sidebar-open');
  }
});

window.addEventListener('resize', () => {
  if (!isMobile()) {
    sidebar.classList.remove('show');
    overlay.classList.remove('active');
    document.body.classList.remove('sidebar-open');
  } else {
    sidebar.classList.remove('show');
    overlay.classList.remove('active');
    document.body.classList.remove('sidebar-open');
  }
});

// Rolle des eingeloggten Users holen
fetch(`/api/profile/${encodeURIComponent(username)}`)
  .then(res => res.json())
  .then(data => {
    if (data.success && data.data.role) {
      currentUserRole = data.data.role;
        if (currentUserRole === 'admin' || currentUserRole === 'mod') {
          const _modBtn = document.getElementById('modpanel-btn');
          if (_modBtn) _modBtn.style.display = '';
        }
    }
  });

// Mod-Panel öffnen/schließen
const modPanelBtn = document.getElementById('modpanel-btn');
const modPanelOverlay = document.getElementById('modpanel-overlay');
const modPanelContent = document.getElementById('modpanel-content');
const closeModPanelBtn = document.getElementById('close-modpanel');

if (modPanelBtn) {
  modPanelBtn.addEventListener('click', () => {
    // User-Liste für das Panel holen (aus previousUsers)
    renderModPanel(previousUsers || []);
  if (modPanelOverlay) modPanelOverlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  });
}
if (closeModPanelBtn) {
  closeModPanelBtn.addEventListener('click', () => {
  if (modPanelOverlay) modPanelOverlay.style.display = 'none';
  document.body.style.overflow = '';
  });
}

// Mod-Panel Tabs: User & Rollen
function renderModPanel(users) {
  let roles = [];
  fetch('/api/roles')
    .then(res => res.json())
    .then(data => {
      if (data.success) roles = Object.entries(data.data || {});
      renderModPanelTabs(users, roles);
    });
}

function renderModPanelTabs(users, roles) {
  let html = `<div class="tab-container">
    <button class="tab-btn" id="modpanel-users-tab">Benutzer</button>
    <button class="tab-btn" id="modpanel-roles-tab">Rollen</button>
  </div>
  <div id="modpanel-tab-content"></div>`;
  modPanelContent.innerHTML = html;

  const usersTab = document.getElementById('modpanel-users-tab');
  const rolesTab = document.getElementById('modpanel-roles-tab');
  const tabContent = document.getElementById('modpanel-tab-content');

  usersTab.addEventListener('click', () => {
    usersTab.classList.add('active');
    rolesTab.classList.remove('active');
    renderUserTab(tabContent, users, roles);
  });
  rolesTab.addEventListener('click', () => {
    rolesTab.classList.add('active');
    usersTab.classList.remove('active');
    renderRolesTab(tabContent, roles, users);
  });
  usersTab.classList.add('active');
  renderUserTab(tabContent, users, roles);
}

function renderUserTab(tabContent, users, roles) {
  let html = '<div class="mod-panel-users">';
  html += '<div class="mod-panel-header">';
  html += '<h3><i class="fas fa-users"></i> Benutzer verwalten</h3>';
  html += '<p>Hier kannst du Benutzer kicken oder ihre Rollen ändern</p>';
  html += '</div>';
  // Async: Profile für alle User laden, damit aktuelle Rolle stimmt
  Promise.all(users.map(user => fetch(`/api/profile/${encodeURIComponent(user.username)}`).then(r => r.json()).then(p => ({...user, profile: p.success ? p.data : {}})))).then(usersWithProfiles => {
    usersWithProfiles.forEach(user => {
      html += '<div class="mod-user-item">';
      html += '<div class="mod-user-info">';
      html += `<span class="mod-username">${user.username}</span>`;
      // Rolle anzeigen
      const userRole = user.profile.role || 'user';
      const roleObj = roles.find(([rid, r]) => rid === userRole);
      if (userRole !== 'user' && roleObj) {
        html += `<span class="custom-role-tag" style="color:${roleObj[1].color};">${roleObj[1].prefix}</span>`;
      } else if (userRole === 'admin') {
        html += '<span class="admin-name">ADMIN</span>';
      } else if (userRole === 'mod') {
        html += '<span class="mod-name">MOD</span>';
      } else {
        html += '<span class="user-role">User</span>';
      }
      html += '</div>';
      html += '<div class="mod-user-actions">';
      // Kick-Button
      if ((currentUserRole === 'admin' && userRole !== 'admin') || (currentUserRole === 'mod' && userRole === 'user')) {
        html += `<button class='mod-kick-btn' data-username='${user.username}' title='${user.username} kicken'>`;
        html += '<i class="fas fa-user-times"></i> Kicken';
        html += '</button>';
      }
      // Rollen-Auswahl (nur Admin)
      if (currentUserRole === 'admin' && userRole !== 'admin') {
        html += '<div class="mod-role-selector">';
        html += `<select class='mod-role-select' data-username='${user.username}'>`;
        html += `<option value='user' ${userRole === 'user' ? 'selected' : ''}>User</option>`;
        html += `<option value='mod' ${userRole === 'mod' ? 'selected' : ''}>Mod</option>`;
        // Custom Rollen mit Farbpunkten
        roles.forEach(([rid, r]) => {
          html += `<option value='${rid}' data-color='${r.color}' ${userRole === rid ? 'selected' : ''}>\u25CF ${r.prefix} (${r.name})</option>`;
        });
        html += '</select>';
        html += '</div>';
      }
      html += '</div>';
      html += '</div>';
    });
    html += '</div>';
    tabContent.innerHTML = html;
    // Kick-Buttons
    tabContent.querySelectorAll('.mod-kick-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        const uname = this.getAttribute('data-username');
        if (uname && confirm(`${uname} wirklich kicken?`)) {
          socket.emit('kickUser', uname);
        }
      });
    });
    // Rollen ändern
    tabContent.querySelectorAll('.mod-role-select').forEach(sel => {
      sel.addEventListener('change', function() {
        const uname = this.getAttribute('data-username');
        const newRole = this.value;
        if (uname && newRole) {
          if (['user', 'mod'].includes(newRole)) {
            socket.emit('updateUserRole', { username: uname, role: newRole });
          } else {
            // Custom Rolle zuweisen
            fetch('/api/roles/assign', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ roleId: newRole, username: uname })
            }).then(res => res.json()).then(data => {
              if (data.success) {
                alert(`Rolle zugewiesen!`);
                renderModPanel(previousUsers);
              } else {
                alert('Fehler beim Zuweisen!');
              }
            });
          }
        }
      });
    });
  });
}

function renderRolesTab(tabContent, roles, users) {
  let html = '<div class="mod-panel-header">';
  html += '<h3><i class="fas fa-id-badge"></i> Rollen verwalten</h3>';
  html += '<p>Lege neue Rollen an, ändere Prefix/Farbe oder lösche Rollen.</p>';
  html += '</div>';
  html += '<div class="roles-list">';
  roles.forEach(([rid, r]) => {
    html += `<div class='role-item' style='display:flex;align-items:center;gap:14px;margin-bottom:14px;'>`;
    html += `<span class='custom-role-tag' style='color:${r.color};'>${r.prefix}</span>`;
    html += `<span style='font-weight:600;'>${r.name}</span>`;
    html += `<button class='icon-btn edit-role-btn' title='Bearbeiten' data-roleid='${rid}'><i class='fas fa-pen'></i></button>`;
    html += `<button class='icon-btn delete-role-btn' title='Löschen' data-roleid='${rid}'><i class='fas fa-trash'></i></button>`;
    html += '</div>';
  });
  html += '</div>';
  // Neue Rolle anlegen
  html += `<div class='role-create-box' style='margin-top:20px;padding:18px;border:2px dashed #5874ff;border-radius:16px;display:flex;align-items:center;gap:10px;'>`;
  html += `<input type='text' id='new-role-name' placeholder='Rollenname' class='role-input'>`;
  html += `<input type='text' id='new-role-prefix' placeholder='Prefix (z.B. VIP)' maxlength='8' class='role-input' style='width:80px;'>`;
  html += `<input type='color' id='new-role-color' value='#5874ff' class='role-color-input'>`;
  html += `<button id='create-role-btn' class='icon-btn create'><i class='fas fa-plus'></i></button>`;
  html += '</div>';
  tabContent.innerHTML = html;
  // Rolle anlegen
  tabContent.querySelector('#create-role-btn').addEventListener('click', () => {
    const name = tabContent.querySelector('#new-role-name').value.trim();
    const prefix = tabContent.querySelector('#new-role-prefix').value.trim();
    const color = tabContent.querySelector('#new-role-color').value;
    if (!name || !prefix || !color) return alert('Bitte alle Felder ausfüllen!');
    const roleId = prefix.toLowerCase().replace(/[^a-z0-9]/g, '') + '-' + Date.now();
    fetch('/api/roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roleId, name, prefix, color })
    }).then(res => res.json()).then(data => {
      if (data.success) {
        alert('Rolle angelegt!');
        renderModPanel(previousUsers);
      } else {
        alert('Fehler: ' + (data.message || 'Unbekannt'));
      }
    });
  });
  // Rolle löschen
  tabContent.querySelectorAll('.delete-role-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const rid = this.getAttribute('data-roleid');
      if (rid && confirm('Rolle wirklich löschen?')) {
        fetch(`/api/roles/${rid}`, { method: 'DELETE' })
          .then(res => res.json())
          .then(data => {
            if (data.success) {
              alert('Rolle gelöscht!');
              renderModPanel(previousUsers);
            } else {
              alert('Fehler beim Löschen!');
            }
          });
      }
    });
  });
  // Rolle bearbeiten (nur Farbe/Prefix/Name)
  tabContent.querySelectorAll('.edit-role-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const rid = this.getAttribute('data-roleid');
      const role = roles.find(([id]) => id === rid);
      if (!role) return;
      const r = role[1];
      const newName = prompt('Neuer Rollenname:', r.name) || r.name;
      const newPrefix = prompt('Neuer Prefix:', r.prefix) || r.prefix;
      const newColor = prompt('Neue Farbe (Hex):', r.color) || r.color;
      fetch(`/api/roles/${rid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, prefix: newPrefix, color: newColor })
      }).then(res => res.json()).then(data => {
        if (data.success) {
          alert('Rolle aktualisiert!');
          renderModPanel(previousUsers);
        } else {
          alert('Fehler beim Aktualisieren!');
        }
      });
    });
  });
}

// Hilfsfunktion: Hole alle Rollen (Promise)
function fetchAllRoles() {
  return fetch('/api/roles').then(res => res.json()).then(data => data.success ? data.data : {});
}

// Hilfsfunktion für Custom-Tag
function createCustomRoleTag(prefix, color) {
  const span = document.createElement('span');
  span.className = 'custom-role-tag';
  span.textContent = prefix;
  span.style.color = color;
  return span;
}

// Patch outputMessage für Custom-Rollen
outputMessage = function(message) {
  const div = document.createElement('div');
  div.classList.add('message');
  div.setAttribute('data-id', message.id);
  let displayName = message.username;
  fetch(`/api/profile/${encodeURIComponent(message.username)}`)
    .then(response => response.json())
    .then(async profile => {
      if (profile.success) {
        if (profile.data.displayName) {
          const nameSpan = div.querySelector('.meta span:first-child');
          if (nameSpan && !nameSpan.classList.contains('admin-name') && !nameSpan.classList.contains('mod-name') && !nameSpan.classList.contains('bot-name')) {
            nameSpan.textContent = profile.data.displayName;
          }
        }
        if (profile.data.role) {
          const firstSpan = div.querySelector('.meta span:first-child');
          if (firstSpan && profile.data.role !== 'user') {
            let roleSpan;
            if (profile.data.role === 'admin') {
              roleSpan = document.createElement('span');
              roleSpan.className = 'admin-name';
              roleSpan.textContent = 'ADMIN';
            } else if (profile.data.role === 'mod') {
              roleSpan = document.createElement('span');
              roleSpan.className = 'mod-name';
              roleSpan.textContent = 'MODERATOR';
            } else {
              // Custom-Rolle: Hole Prefix/Farbe
              const allRoles = await fetchAllRoles();
              const r = allRoles[profile.data.role];
              if (r) {
                roleSpan = createCustomRoleTag(r.prefix, r.color);
              }
            }
            if (roleSpan && roleSpan.textContent) div.querySelector('.meta').insertBefore(roleSpan, firstSpan);
          }
        }
        if (profile.data.avatar) {
          const existingAvatar = div.querySelector('.message-avatar');
          if (existingAvatar) existingAvatar.remove();
          const avatarImg = document.createElement('img');
          avatarImg.src = `/uploads/avatars/${profile.data.avatar}`;
          avatarImg.alt = `${message.username} Avatar`;
          avatarImg.classList.add('message-avatar');
          div.insertBefore(avatarImg, div.firstChild);
        }
      }
    })
    .catch(error => {
      console.log('Error loading profile:', error);
    });
  // Rest wie original
  const p = document.createElement('p');
  p.classList.add('meta');
  if (message.username === 'Chat Togehter') {
    p.innerHTML = `<span class="bot-name">BOT</span> <span>${displayName}</span> <span>${message.time}</span>`;
  } else {
    p.innerHTML = `<span>${displayName}</span> <span>${message.time}</span>`;
  }
  if (currentUserRole === 'admin' || currentUserRole === 'mod') {
    const deleteBtn = document.createElement('span');
    deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
    deleteBtn.style.cursor = 'pointer';
    deleteBtn.style.marginLeft = '10px';
    deleteBtn.style.color = 'rgb(255, 79, 79)';
    deleteBtn.addEventListener('click', () => {
      socket.emit('deleteMessage', {
        id: message.id,
      });
    });
    p.appendChild(deleteBtn);
  }
  if (message.username === username || currentUserRole === 'admin' || currentUserRole === 'mod') {
    const editBtn = document.createElement('span');
    editBtn.innerHTML = '<i class="fas fa-pencil-alt"></i>';
    editBtn.style.cursor = 'pointer';
    editBtn.style.marginLeft = '10px';
    editBtn.style.color = 'gray';
    editBtn.classList.add('edit-message');
    editBtn.addEventListener('click', () => {
      const textP = div.querySelector('.text');
      const originalText = textP.innerText;
      const input = document.createElement('div');
      input.contentEditable = true;
      input.innerText = originalText;
      input.className = 'text edit-message';
      div.replaceChild(input, textP);
      input.focus();
      let hasSaved = false;
      const saveEdit = () => {
        if (hasSaved) return;
        hasSaved = true;
        const newText = input.innerText.trim();
        if (newText && newText !== originalText) {
          socket.emit('editMessage', {
            id: message.id,
            newText
          });
        }
        const newTextP = document.createElement('p');
        newTextP.className = 'text';
        newTextP.innerText = newText || originalText;
        if (input.parentNode === div) {
          div.replaceChild(newTextP, input);
        }
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          saveEdit();
          input.blur();
        }
      });
      input.addEventListener('blur', saveEdit);
    });
    p.appendChild(editBtn);
  }
  div.appendChild(p);
  if (message.replyTo && message.replyTo.id) {
    const replyBox = document.createElement('div');
    replyBox.className = 'reply-box';
    replyBox.innerHTML = `<i class="fas fa-reply"></i> <strong>${message.replyTo.username}</strong>: ${escapeHtml(message.replyTo.text).slice(0, 140)}`;
    div.appendChild(replyBox);
  }
  const para = document.createElement('p');
  para.classList.add('text');
  para.innerText = message.text;
  div.appendChild(para);
  const replyBtn = document.createElement('span');
  replyBtn.innerHTML = '<i class="fas fa-reply"></i>';
  replyBtn.style.cursor = 'pointer';
  replyBtn.style.marginLeft = '4px';
  replyBtn.style.color = '#5874ff';
  replyBtn.title = 'Antworten';
  replyBtn.addEventListener('click', () => {
    const previewText = div.querySelector('.text')?.innerText || '';
    currentReply = { id: message.id, username: message.username, text: previewText };
    showReplyBar(currentReply);
    msgInput.focus();
  });
  p.appendChild(replyBtn);
  // Reaction UI: single toggle button bottom-right that opens a small picker
  const reactionToggle = document.createElement('button');
  reactionToggle.className = 'reaction-toggle-btn';
  reactionToggle.title = 'React';
  // Use Font Awesome smile instead of heart
  reactionToggle.innerHTML = '<i class="fas fa-smile"></i>';

  const picker = document.createElement('div');
  picker.className = 'reaction-picker-popup';
  picker.style.display = 'none';
  const quick = ['👍','❤️','😂','😮','😢','🎉','👑','🔥'];
  quick.forEach(emo => {
    const b = document.createElement('button');
    b.className = 'reaction-small';
    b.innerText = emo;
    b.title = `React with ${emo}`;
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      socket.emit('toggleReaction', { messageId: message.id, emoji: emo });
      picker.style.display = 'none';
    });
    picker.appendChild(b);
  });

  reactionToggle.addEventListener('click', (ev) => {
    ev.stopPropagation();
    picker.style.display = picker.style.display === 'none' ? 'flex' : 'none';
  });
  document.addEventListener('click', () => { if (picker) picker.style.display = 'none'; });
  div.style.position = 'relative';
  div.appendChild(picker);
  div.appendChild(reactionToggle);

  chatMessages.appendChild(div);
};


// Profile Preview Functionality
function showProfilePreview(username) {
  console.log('showProfilePreview called for', username);
  const profilePreviewSidebar = document.getElementById('profile-preview-sidebar');
  const previewDisplayName = document.getElementById('preview-display-name');
  const previewUsername = document.getElementById('preview-username');
  const previewAvatar = document.getElementById('preview-avatar');
  const previewRole = document.getElementById('preview-role');
  const previewBioContainer = document.getElementById('preview-bio-container');
  const previewLocationContainer = document.getElementById('preview-location-container');
  const previewWebsiteContainer = document.getElementById('preview-website-container');

  // If required elements are missing, bail out to avoid TypeErrors
  if (!profilePreviewSidebar || !previewDisplayName || !previewUsername || !previewAvatar || !previewRole) return;

  // Show loading state
  profilePreviewSidebar.classList.add('show');

  // Attach close button handler if present
  const closeBtn = document.getElementById('close-profile-preview');
  if (closeBtn) {
    closeBtn.onclick = () => {
      profilePreviewSidebar.classList.remove('show');
    };
  }

  // Reset content
  previewDisplayName.textContent = username;
  previewUsername.textContent = `@${username}`;
  previewAvatar.src = 'imgs/logo.png';
  previewRole.innerHTML = '';
  
  // Hide all detail containers initially (guarded)
  if (previewBioContainer) previewBioContainer.style.display = 'none';
  if (previewLocationContainer) previewLocationContainer.style.display = 'none';
  if (previewWebsiteContainer) previewWebsiteContainer.style.display = 'none';
  
  // First fetch all roles, then fetch profile data
  fetchAllRoles().then(allRoles => {
    // Fetch profile data
    fetch(`/api/profile/${encodeURIComponent(username)}`)
      .then(response => response.json())
      .then(profile => {
        if (profile.success && profile.data) {
          const data = profile.data;
          
          // Update display name
          if (data.displayName && data.displayName !== username) {
            if (previewDisplayName) previewDisplayName.textContent = data.displayName;
          }
          
          // Update avatar
          if (data.avatar) {
            if (previewAvatar) previewAvatar.src = `/uploads/avatars/${data.avatar}`;
          }
          
          // Update role
          if (data.role && data.role !== 'user') {
            const roleElement = previewRole;
            if (roleElement) {
              roleElement.className = 'preview-role';
              // Reset all styles first
              roleElement.style.background = '';
              roleElement.style.borderColor = '';
              roleElement.style.color = '';
              roleElement.style.borderRadius = '';
              roleElement.style.padding = '';
              roleElement.style.fontSize = '';
              roleElement.style.fontWeight = '';
              roleElement.style.letterSpacing = '';
              roleElement.style.marginLeft = '';
              roleElement.style.marginRight = '';
              roleElement.style.marginTop = '';
              
              if (data.role === 'admin') {
                roleElement.textContent = 'ADMIN';
                roleElement.classList.add('admin');
              } else if (data.role === 'mod') {
                roleElement.textContent = 'MODERATOR';
                roleElement.classList.add('mod');
              } else if (allRoles[data.role]) {
                const role = allRoles[data.role];
                roleElement.textContent = role.prefix;
                roleElement.classList.add('custom');
                // Verwende die gleichen Styles wie in der Seitenleiste
                roleElement.style.background = role.color;
                roleElement.style.borderColor = role.color;
                roleElement.style.color = '#fff';
                roleElement.style.borderRadius = '15px';
                roleElement.style.padding = '5px 6px';
                roleElement.style.fontSize = '12px';
                roleElement.style.fontWeight = 'bold';
                roleElement.style.letterSpacing = '1px';
                roleElement.style.marginLeft = '0';
                roleElement.style.marginRight = '4px';
                roleElement.style.marginTop = '8px';
              }
            }
          }
          
                  // Update bio
        if (data.bio && data.bio.trim()) {
          const bioEl = document.getElementById('preview-bio');
          if (bioEl) bioEl.textContent = data.bio;
          if (previewBioContainer) previewBioContainer.style.display = 'flex';
        }
        
        // Update location
        if (data.location && data.location.trim()) {
          const locEl = document.getElementById('preview-location');
          if (locEl) locEl.textContent = data.location;
          if (previewLocationContainer) previewLocationContainer.style.display = 'flex';
        }
        
        // Update website
        if (data.website && data.website.trim()) {
          const websiteElement = document.getElementById('preview-website');
          const websiteContainer = previewWebsiteContainer;
          
          // Ensure website has protocol
          let websiteUrl = data.website;
          if (!websiteUrl.startsWith('http://') && !websiteUrl.startsWith('https://')) {
            websiteUrl = 'https://' + websiteUrl;
          }
          
          if (websiteElement) {
            websiteElement.href = websiteUrl;
            websiteElement.textContent = data.website;
          }
          if (websiteContainer) websiteContainer.style.display = 'flex';
        }
        
        // Add some debug logging
        console.log('Profile data loaded:', data);
        console.log('All roles loaded:', allRoles);
        if (data.role && allRoles[data.role]) {
          console.log('Role data for', data.role, ':', allRoles[data.role]);
        }
        }
      })
      .catch(error => {
        console.log('Error loading profile for preview:', error);
      });
  }).catch(error => {
    console.log('Error loading roles for preview:', error);
  });
}

// Close profile preview
document.addEventListener('DOMContentLoaded', function() {
  const closeProfilePreviewBtn = document.getElementById('close-profile-preview');
  const profilePreviewSidebar = document.getElementById('profile-preview-sidebar');
  
  if (closeProfilePreviewBtn) {
    closeProfilePreviewBtn.addEventListener('click', () => {
      if (profilePreviewSidebar) profilePreviewSidebar.classList.remove('show');
    });
  }
  
  // Close on escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && profilePreviewSidebar && profilePreviewSidebar.classList.contains('show')) {
      profilePreviewSidebar.classList.remove('show');
    }
  });
  
  // Close on click outside
  if (profilePreviewSidebar) {
    profilePreviewSidebar.addEventListener('click', (e) => {
      if (e.target === profilePreviewSidebar) {
        profilePreviewSidebar.classList.remove('show');
      }
    });
  }
  
  // Close on overlay click
  const overlay = document.getElementById('overlay');
  if (overlay) {
    overlay.addEventListener('click', () => {
      if (profilePreviewSidebar) profilePreviewSidebar.classList.remove('show');
    });
  }
});

// Server Switch Functionality
document.addEventListener('DOMContentLoaded', function() {
  const serverSwitchBtn = document.getElementById('server-switch-btn');
  const serverSwitchOverlay = document.getElementById('server-switch-overlay');
  const closeServerSwitchBtn = document.getElementById('close-server-switch');
  const serverItems = document.querySelectorAll('.server-item');
  
  // Open server switch modal
  if (serverSwitchBtn) {
    serverSwitchBtn.addEventListener('click', () => {
  if (serverSwitchOverlay) serverSwitchOverlay.style.display = 'flex';
      
      // Highlight current room
      const currentRoom = room;
  serverItems.forEach(item => {
        item.classList.remove('active');
        if (item.dataset.room === currentRoom) {
          item.classList.add('active');
        }
      });
      
      // Update online user counts
      updateServerUserCounts();
    });
  }
  
  // Close server switch modal
  if (closeServerSwitchBtn) {
    closeServerSwitchBtn.addEventListener('click', () => {
  if (serverSwitchOverlay) serverSwitchOverlay.style.display = 'none';
    });
  }
  
  // Close on overlay click
  if (serverSwitchOverlay) {
    serverSwitchOverlay.addEventListener('click', (e) => {
      if (e.target === serverSwitchOverlay) {
  serverSwitchOverlay.style.display = 'none';
      }
    });
  }
  
  // Handle server selection
  serverItems.forEach(item => {
    item.addEventListener('click', () => {
      const selectedRoom = item.dataset.room;
      
      // Don't switch if already in the same room
      if (selectedRoom === room) {
        serverSwitchOverlay.style.display = 'none';
        return;
      }
      
      // Show confirmation dialog
      if (confirm(`Möchtest du wirklich zu "${selectedRoom}" wechseln?`)) {
        // Leave current room
        socket.emit('leaveRoom');
        
        // Update URL and reload to join new room
        const urlParams = new URLSearchParams(window.location.search);
        urlParams.set('room', selectedRoom);
        window.location.search = urlParams.toString();
      }
    });
  });
  
  // Close on escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && serverSwitchOverlay.style.display === 'flex') {
      serverSwitchOverlay.style.display = 'none';
    }
  });
});

// File Upload Functionality
document.addEventListener('DOMContentLoaded', function() {
  const fileUploadBtn = document.getElementById('file-upload-btn');
  const fileInput = document.getElementById('file-input');
  const uploadProgress = document.getElementById('file-upload-progress');
  const progressFill = document.getElementById('upload-progress-fill');
  const progressText = document.getElementById('upload-progress-text');

  // File upload button click
  if (fileUploadBtn) {
    fileUploadBtn.addEventListener('click', () => {
      fileInput.click();
    });
  }

  // File input change
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        uploadFile(file);
      }
    });
  }

  // Upload file function
  function uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('username', username || 'unknown');

    // Show progress modal
    uploadProgress.classList.add('show');
    progressFill.style.width = '0%';
    progressText.textContent = '0%';

    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const percentComplete = (e.loaded / e.total) * 100;
        progressFill.style.width = percentComplete + '%';
        progressText.textContent = Math.round(percentComplete) + '%';
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status === 200) {
        try {
          const response = JSON.parse(xhr.responseText);
          if (response.success) {
            // Send file message to chat
            socket.emit('chatMessage', {
              type: 'file',
              fileInfo: response.data
            });
            
            // Hide progress modal
            setTimeout(() => {
              uploadProgress.classList.remove('show');
            }, 1000);
          } else {
            alert('Fehler beim Hochladen: ' + (response.message || 'Unbekannter Fehler'));
            uploadProgress.classList.remove('show');
          }
        } catch (error) {
          console.error('Error parsing response:', error);
          alert('Fehler beim Verarbeiten der Server-Antwort');
          uploadProgress.classList.remove('show');
        }
      } else {
        alert('Fehler beim Hochladen der Datei (Status: ' + xhr.status + ')');
        uploadProgress.classList.remove('show');
      }
    });

    xhr.addEventListener('error', () => {
      alert('Fehler beim Hochladen der Datei');
      uploadProgress.classList.remove('show');
    });

    xhr.open('POST', '/api/upload-file');
    xhr.send(formData);
  }
});

// Function to format file size
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Function to get file type icon
function getFileTypeIcon(mimetype, filename) {
  if (mimetype.startsWith('image/')) {
    return '<i class="fas fa-image file-type-icon"></i>';
  } else if (mimetype === 'application/pdf') {
    return '<i class="fas fa-file-pdf file-type-icon file-type-pdf"></i>';
  } else if (mimetype.includes('word') || filename.endsWith('.doc') || filename.endsWith('.docx')) {
    return '<i class="fas fa-file-word file-type-icon file-type-doc"></i>';
  } else if (mimetype.includes('excel') || filename.endsWith('.xls') || filename.endsWith('.xlsx')) {
    return '<i class="fas fa-file-excel file-type-icon file-type-xls"></i>';
  } else if (mimetype.includes('zip') || filename.endsWith('.zip') || filename.endsWith('.rar')) {
    return '<i class="fas fa-file-archive file-type-icon file-type-zip"></i>';
  } else if (mimetype.startsWith('text/') || filename.endsWith('.txt')) {
    return '<i class="fas fa-file-alt file-type-icon file-type-txt"></i>';
  } else {
    return '<i class="fas fa-file file-type-icon"></i>';
  }
}

// Function to download file
function downloadFile(filePath, fileName) {
  const link = document.createElement('a');
  link.href = filePath;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Function to open image modal
function openImageModal(imagePath) {
  const modal = document.createElement('div');
  modal.className = 'image-modal-overlay';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.9);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    cursor: pointer;
  `;
  
  const img = document.createElement('img');
  img.src = imagePath;
  img.style.cssText = `
    max-width: 90%;
    max-height: 90%;
    object-fit: contain;
    border-radius: 8px;
  `;
  
  modal.appendChild(img);
  document.body.appendChild(modal);
  
  modal.addEventListener('click', () => {
    document.body.removeChild(modal);
  });
}

// Function to update online user counts in server switch modal
function updateServerUserCounts() {
  fetch('/api/room-users')
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        const roomUserCounts = data.data;
        
        // Update each server item with user count
        const serverItems = document.querySelectorAll('.server-item');
        serverItems.forEach(item => {
          const roomName = item.dataset.room;
          const countElement = item.querySelector('.online-count');
          const userCount = roomUserCounts[roomName] || 0;
          if (countElement) countElement.innerHTML = `<span class="online-dot"></span>${userCount} online`;
        });
      }
    })
    .catch(error => {
      console.log('Error fetching room user counts:', error);
    });
}
