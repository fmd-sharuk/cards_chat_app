// Automatically detects the server URL whether it's localhost or a cloud IP
const API = window.location.origin;
let socket      = null;
let currentUser = null;
let chatPartner = null;
let searchTimeout = null;

// unread counts per friend loaded from DB on login
const unreadCounts = {};

// ================= AUTH =================

function handleLogin() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();
    if (!username || !password) { showNotification('Please enter username and password'); return; }
    fetch(`${API}/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    })
    .then(r => r.json())
    .then(data => {
        if (data.status === 'success') {
            sessionStorage.setItem('user', data.username || username);
            window.location.href = 'home.html';
        } else { showNotification(data.message || 'Login failed'); }
    })
    .catch(() => showNotification('Network error'));
}

function handleSignup() {
    const username = document.getElementById('signup-username').value.trim();
    const password = document.getElementById('signup-password').value.trim();
    if (!username || !password) { showNotification('Please enter username and password'); return; }
    if (password.length < 4)    { showNotification('Password must be at least 4 characters'); return; }
    fetch(`${API}/signup`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    })
    .then(r => r.json())
    .then(data => {
        if (data.status === 'success') {
            showNotification('Account created! Please login.');
            document.getElementById('login-username').value = username;
            document.getElementById('login-password').value = '';
            toggleAuthTab('login');
        } else { showNotification(data.message || 'Signup failed'); }
    })
    .catch(() => showNotification('Network error'));
}

function handleLogout() {
    sessionStorage.removeItem('user');
    sessionStorage.removeItem('lastChat');
    if (socket) socket.disconnect();
    window.location.href = 'index.html';
}

function toggleAuthTab(tab) {
    const loginForm  = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');
    const tabLogin   = document.getElementById('tab-login');
    const tabSignup  = document.getElementById('tab-signup');
    if (tab === 'login') {
        loginForm.style.display = 'block'; signupForm.style.display = 'none';
        tabLogin.style.borderBottom  = '2px solid #e50914'; tabLogin.style.color  = '#e50914';
        tabSignup.style.borderBottom = '2px solid transparent'; tabSignup.style.color = '#999';
    } else {
        loginForm.style.display = 'none'; signupForm.style.display = 'block';
        tabSignup.style.borderBottom = '2px solid #e50914'; tabSignup.style.color  = '#e50914';
        tabLogin.style.borderBottom  = '2px solid transparent'; tabLogin.style.color = '#999';
    }
}

// ================= SOCKET =================

function initSocket(username) {
    if (socket) socket.disconnect();
    socket = io(API, { reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 5000 });

    socket.on('connect', () => {
        console.log('[SOCKET] connected:', socket.id);
        socket.emit('join_user', { user: username });
        // Re-join all friend rooms on reconnect — loadFriends will also do this, this is the reconnect safety net
    });

    socket.on('disconnect', () => console.log('[SOCKET] disconnected'));

    socket.on('friend_request', (data) => {
        if (data.to === username) {
            showNotification(`${data.from} sent you a friend request!`);
            loadRequests(); loadSentRequests();
        }
    });

    socket.on('friend_accepted', (data) => {
        if (data.user1 === username || data.user2 === username) {
            const other = data.user1 === username ? data.user2 : data.user1;
            showNotification(`${other} accepted your request!`);
            loadFriends(); loadRequests(); loadSentRequests();
        }
    });

    socket.on('receive_message', (data) => {
        const { sender, receiver, message } = data;
        console.log('[SOCKET] receive_message:', sender, '->', receiver, '| me:', username);

        // Ignore messages I sent myself (echo from shared room)
        if (sender === username) return;

        // Which conversation does this belong to?
        const partner = sender; // sender is always the other person here

        if (partner === chatPartner) {
            // Chat is currently open — append live
            appendMessageToDOM(sender, message);
            markRead(sender);
        } else {
            // Chat is in background — increment badge and notify
            unreadCounts[partner] = (unreadCounts[partner] || 0) + 1;
            updateFriendBadge(partner);
            showNotification(`New message from ${sender}`);
        }
    });
}

// ================= HOME PAGE =================

function initHome() {
    currentUser = sessionStorage.getItem('user');
    if (!currentUser) { window.location.href = 'index.html'; return; }

    document.getElementById('username-display').textContent = currentUser;
    document.getElementById('user-avatar').textContent      = currentUser.charAt(0).toUpperCase();
    document.title = `${currentUser} - Cards Chat`;

    initSocket(currentUser);

    // First load: get unread counts, then friends, then reopen last chat
    fetch(`${API}/unread_counts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: currentUser })
    })
    .then(r => r.json())
    .then(counts => {
        Object.assign(unreadCounts, counts);
        loadFriends(true);  // true = auto-reopen last chat
    })
    .catch(() => loadFriends(true));

    loadRequests();
    loadSentRequests();

    // Periodic sidebar refresh — does NOT touch the open chat
    setInterval(() => {
        loadFriends(false);
        loadRequests();
        loadSentRequests();
    }, 5000);
}

function loadFriends(autoOpen = false) {
    fetch(`${API}/get_friends`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: currentUser })
    })
    .then(r => r.json())
    .then(friends => {
        // Join all friend chat rooms for background message delivery
        if (socket) {
            friends.forEach(f => socket.emit('join_chat', { user1: currentUser, user2: f }));
        }
        renderFriendsList(friends);

        if (autoOpen) {
            const lastChat = sessionStorage.getItem('lastChat');
            if (lastChat && friends.includes(lastChat)) {
                openChat(lastChat);
            }
        }
    });
}

function renderFriendsList(friends) {
    const list    = document.getElementById('friends-list');
    const countEl = document.getElementById('friends-count');
    list.innerHTML = '';
    if (countEl) countEl.textContent = friends.length;

    if (friends.length === 0) {
        list.innerHTML = '<div class="friend-item"><div class="friend-info"><h4>No friends yet</h4><p>Search above to add people</p></div></div>';
        return;
    }
    friends.forEach(friend => {
        const unread = unreadCounts[friend] || 0;
        const div = document.createElement('div');
        div.className = 'friend-item' + (chatPartner === friend ? ' active' : '');
        div.id = `friend-item-${friend}`;
        div.innerHTML = `
            <div class="friend-avatar">${friend.charAt(0).toUpperCase()}</div>
            <div class="friend-info">
                <h4>${friend}</h4>
                <p id="friend-sub-${friend}">${unread > 0 ? `<span style="color:#e50914;font-weight:600;">${unread} unread</span>` : 'Click to message'}</p>
            </div>
            <div id="badge-${friend}" class="unread-badge" style="${unread > 0 ? '' : 'display:none'}">${unread}</div>
            <div class="friend-status online"></div>
        `;
        div.onclick = () => openChat(friend);
        list.appendChild(div);
    });
}

function updateFriendBadge(friend) {
    const count = unreadCounts[friend] || 0;
    const badge = document.getElementById(`badge-${friend}`);
    const sub   = document.getElementById(`friend-sub-${friend}`);
    if (badge) { badge.textContent = count; badge.style.display = count > 0 ? 'flex' : 'none'; }
    if (sub)   { sub.innerHTML = count > 0 ? `<span style="color:#e50914;font-weight:600;">${count} unread</span>` : 'Click to message'; }
}

function loadRequests() {
    fetch(`${API}/get_requests`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: currentUser })
    })
    .then(r => r.json())
    .then(requests => {
        const list = document.getElementById('requests-list');
        const countEl = document.getElementById('requests-count');
        list.innerHTML = '';
        if (countEl) countEl.textContent = requests.length;
        if (requests.length === 0) {
            list.innerHTML = '<div class="request-item"><div class="request-info"><h4>No requests</h4></div></div>';
            return;
        }
        requests.forEach(sender => {
            const div = document.createElement('div');
            div.className = 'request-item';
            div.innerHTML = `
                <div class="request-info"><h4>${sender}</h4><p>Wants to be your friend</p></div>
                <div>
                    <button class="btn-accept" onclick="acceptRequest('${sender}')">Accept</button>
                    <button class="btn-decline" onclick="declineRequest('${sender}')">Decline</button>
                </div>`;
            list.appendChild(div);
        });
    });
}

function loadSentRequests() {
    fetch(`${API}/get_sent_requests`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: currentUser })
    })
    .then(r => r.json())
    .then(sent => {
        const list = document.getElementById('sent-list');
        const countEl = document.getElementById('sent-count');
        list.innerHTML = '';
        if (countEl) countEl.textContent = sent.length;
        if (sent.length === 0) { list.innerHTML = '<div class="sent-item">No pending requests</div>'; return; }
        sent.forEach(target => {
            const div = document.createElement('div');
            div.className = 'sent-item';
            div.innerHTML = `
                <div class="sent-info"><h4>${target}</h4><p>Pending</p></div>
                <button class="btn-cancel" onclick="cancelRequest('${target}')">Cancel</button>`;
            list.appendChild(div);
        });
    });
}

function acceptRequest(sender) {
    fetch(`${API}/accept_friend`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: currentUser, sender })
    })
    .then(r => r.json())
    .then(data => { if (data.status === 'success') { loadFriends(); loadRequests(); loadSentRequests(); } });
}

function declineRequest(sender) {
    fetch(`${API}/remove_friend`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user1: currentUser, user2: sender })
    }).then(() => loadRequests());
}

function cancelRequest(target) {
    fetch(`${API}/remove_friend`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user1: currentUser, user2: target })
    }).then(() => loadSentRequests());
}

async function handleSearch() {
    const query = document.getElementById('search-users').value.trim();
    const resultsDiv = document.getElementById('search-results');
    if (!query) { resultsDiv.style.display = 'none'; return; }
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async () => {
        const res   = await fetch(`${API}/search_users`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user: currentUser, query })
        });
        const users = await res.json();
        resultsDiv.innerHTML = users.length > 0
            ? users.map(u => `<div class="friend-item" style="cursor:pointer;" onclick="sendRequest('${u}')">
                    <div class="friend-avatar">${u.charAt(0).toUpperCase()}</div>
                    <div class="friend-info"><h4>${u}</h4></div></div>`).join('')
            : '<div class="request-item"><div class="request-info"><h4>No users found</h4></div></div>';
        resultsDiv.style.display = 'block';
    }, 300);
}

function sendRequest(username) {
    document.getElementById('search-users').value = '';
    document.getElementById('search-results').style.display = 'none';
    fetch(`${API}/add_friend`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user1: currentUser, user2: username })
    })
    .then(r => r.json())
    .then(data => {
        showNotification(data.status === 'success' ? `Request sent to ${username}!` : data.message);
        if (data.status === 'success') loadSentRequests();
    });
}

// ================= CHAT =================

function openChat(friend) {
    chatPartner = friend;
    sessionStorage.setItem('lastChat', friend);

    // Show chat panel
    const emptyChat     = document.getElementById('empty-chat');
    const chatContainer = document.getElementById('chat-container');
    if (emptyChat)     emptyChat.style.display     = 'none';
    if (chatContainer) chatContainer.style.display = 'flex';

    // Update header
    document.getElementById('chat-username').textContent = friend;
    document.getElementById('chat-avatar').textContent   = friend.charAt(0).toUpperCase();
    document.getElementById('chat-status').textContent   = 'Online';

    // Highlight in sidebar
    document.querySelectorAll('.friend-item').forEach(el =>
        el.classList.toggle('active', el.querySelector('h4')?.textContent === friend)
    );

    // Join socket room for this pair
    if (socket) socket.emit('join_chat', { user1: currentUser, user2: friend });

    // Clear unread badge
    unreadCounts[friend] = 0;
    updateFriendBadge(friend);
    markRead(friend);

    // Load full history from DB — this is the ONLY place we populate the chat
    loadMessages(friend);
}

function loadMessages(friend) {
    const container = document.getElementById('messages-container');
    if (!currentUser || !friend) {
        console.error("[ERROR] Missing parameters:", { currentUser, friend });
        return;
    }

    container.innerHTML = '<div style="text-align:center;color:#555;padding:20px;font-size:13px;">Loading history...</div>';

    // Log the URL to your browser console (F12) to make sure it's correct
    console.log(`[FETCH] Requesting: ${API}/messages/${currentUser}/${friend}`);

    fetch(`${API}/messages/${currentUser}/${friend}`)
    .then(async r => {
        const data = await r.json();
        if (!r.ok) {
            // This catches backend 500/404 errors
            throw new Error(data.message || `Server error: ${r.status}`);
        }
        return data;
    })
    .then(messages => {
        if (chatPartner !== friend) return; // Guard against fast switching
        container.innerHTML = '';

        if (!Array.isArray(messages) || messages.length === 0) {
            container.innerHTML = '<div style="text-align:center;color:#666;padding:20px;font-size:13px;">No messages yet. Say hello!</div>';
            return;
        }

        messages.forEach(m => renderMessageInDOM(m.sender, m.message, m.sent_at));
        container.scrollTop = container.scrollHeight;
    })
    .catch(err => {
        console.error('[DEBUG ERROR]:', err);
        if (chatPartner === friend) {
            container.innerHTML = `<div style="text-align:center;color:#e50914;padding:20px;">
                Failed to load messages.<br>
                <small style="color:#888;">${err.message}</small>
            </div>`;
        }
    });
}

function closeChat() {
    chatPartner = null;
    sessionStorage.removeItem('lastChat');
    const emptyChat     = document.getElementById('empty-chat');
    const chatContainer = document.getElementById('chat-container');
    if (emptyChat)     emptyChat.style.display     = 'flex';
    if (chatContainer) chatContainer.style.display = 'none';
    document.querySelectorAll('.friend-item').forEach(el => el.classList.remove('active'));
}

function renderMessageInDOM(sender, message, timestamp) {
    const container = document.getElementById('messages-container');
    if (!container) return;
    const isSent  = sender === currentUser;
    const timeStr = timestamp
        ? new Date(timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
        : new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${isSent ? 'sent' : 'received'}`;
    msgDiv.innerHTML = `
        ${!isSent ? `<div class="message-avatar">${sender.charAt(0).toUpperCase()}</div>` : ''}
        <div class="message-content">${escapeHtml(message)}</div>
        ${isSent  ? `<div class="message-avatar">${sender.charAt(0).toUpperCase()}</div>` : ''}
        <div class="message-time">${timeStr}</div>
    `;
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
}

// For live incoming socket messages only
function appendMessageToDOM(sender, message) {
    // Remove the "no messages yet" placeholder if present
    const container = document.getElementById('messages-container');
    if (container) {
        const placeholder = container.querySelector('div[style*="padding:20px"]');
        if (placeholder) placeholder.remove();
    }
    renderMessageInDOM(sender, message, null);
}

function sendMessage(e) {
    e.preventDefault();
    const input   = document.getElementById('message-input');
    const message = input.value.trim();
    if (!message || !chatPartner || !socket) return;

    // Render for sender immediately (optimistic)
    renderMessageInDOM(currentUser, message, null);
    input.value = '';

    // Send via socket to backend
    socket.emit('send_message', {
        sender: currentUser,
        receiver: chatPartner,
        message: message
    });
}

function markRead(sender) {
    fetch(`${API}/mark_read`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: currentUser, sender })
    }).catch(() => {});
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ================= UTILS =================

function showNotification(message) {
    const n = document.createElement('div');
    n.className = 'notification';
    n.textContent = message;
    document.body.appendChild(n);
    setTimeout(() => {
        n.style.opacity = '0'; n.style.transform = 'translateX(100%)';
        setTimeout(() => n.remove(), 300);
    }, 3000);
}

function goBack() { window.location.href = 'home.html'; }

// ================= AUTO-INIT =================

document.addEventListener('DOMContentLoaded', () => {
    const user = sessionStorage.getItem('user');
    const path = window.location.pathname;

    if (user && path.includes('home.html')) {
        setTimeout(() => initHome(), 100);
    } else if (user && path.includes('chat.html')) {
        currentUser = user;
        document.getElementById('username-display').textContent = user;
        document.getElementById('user-avatar').textContent      = user.charAt(0).toUpperCase();
        initSocket(user);
        loadFriends(false);
        loadRequests();
        const partner = new URLSearchParams(window.location.search).get('with');
        if (partner) setTimeout(() => openChat(partner), 300);
    }
});

// Expose globally
window.handleLogin    = handleLogin;
window.handleSignup   = handleSignup;
window.handleLogout   = handleLogout;
window.toggleAuthTab  = toggleAuthTab;
window.openChat       = openChat;
window.closeChat      = closeChat;
window.sendRequest    = sendRequest;
window.acceptRequest  = acceptRequest;
window.declineRequest = declineRequest;
window.cancelRequest  = cancelRequest;
window.handleSearch   = handleSearch;
window.sendMessage    = sendMessage;
window.goBack         = goBack;