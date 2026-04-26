const API = 'http://127.0.0.1:5000';
let socket = null;
let currentUser = null;
let chatPartner = null;
let searchTimeout = null;

// ================= AUTH =================

function handleLogin() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();

    if (!username || !password) {
        showNotification('Please enter username and password');
        return;
    }

    fetch(`${API}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === 'success') {
            sessionStorage.setItem('user', data.username || username);
            window.location.href = 'home.html';
        } else {
            showNotification(data.message || 'Login failed');
        }
    })
    .catch(err => showNotification('Network error'));
}

function handleSignup() {
    const username = document.getElementById('signup-username').value.trim();
    const password = document.getElementById('signup-password').value.trim();

    if (!username || !password) {
        showNotification('Please enter username and password');
        return;
    }

    if (password.length < 4) {
        showNotification('Password must be at least 4 characters');
        return;
    }

    fetch(`${API}/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === 'success') {
            showNotification('Account created! Please login.');
            document.getElementById('login-username').value = username;
            document.getElementById('login-password').value = '';
            toggleAuthTab('login');
        } else {
            showNotification(data.message || 'Signup failed');
        }
    })
    .catch(err => showNotification('Network error'));
}

function handleLogout() {
    sessionStorage.removeItem('user');
    if (socket) {
        socket.disconnect();
    }
    window.location.href = 'index.html';
}

function toggleAuthTab(tab) {
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');
    const tabLogin = document.getElementById('tab-login');
    const tabSignup = document.getElementById('tab-signup');

    if (tab === 'login') {
        loginForm.style.display = 'block';
        signupForm.style.display = 'none';
        tabLogin.style.background = 'none';
        tabLogin.style.borderBottom = '2px solid #e50914';
        tabLogin.style.color = '#e50914';
        tabSignup.style.background = 'none';
        tabSignup.style.borderBottom = '2px solid transparent';
        tabSignup.style.color = '#999';
    } else {
        loginForm.style.display = 'none';
        signupForm.style.display = 'block';
        tabSignup.style.background = 'none';
        tabSignup.style.borderBottom = '2px solid #e50914';
        tabSignup.style.color = '#e50914';
        tabLogin.style.background = 'none';
        tabLogin.style.borderBottom = '2px solid transparent';
        tabLogin.style.color = '#999';
    }
}

// ================= SOCKET =================

function initSocket(username) {
    if (socket) {
        socket.disconnect();
    }

    socket = io(API, {
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000
    });

    socket.on('connect', () => {
        console.log('Socket connected');
        socket.emit('register_user', { username: username });
        socket.emit('join_user', { user: username });
    });

    socket.on('disconnect', () => {
        console.log('Socket disconnected');
    });

    socket.on('friend_request', (data) => {
        console.log('Friend request received:', data);
        if (data.to === username) {
            showNotification(`${data.from} sent you a friend request!`);
            loadRequests();
            loadSentRequests();
        }
    });

    socket.on('friend_accepted', (data) => {
        console.log('Friend accepted:', data);
        if (data.user1 === username || data.user2 === username) {
            showNotification(`${data.user1 === username ? data.user2 : data.user1} accepted your request!`);
            loadFriends();
            loadRequests();
            loadSentRequests();
        }
    });

    socket.on('receive_message', (data) => {
        console.log('New message:', data);
        if ((data.sender === chatPartner && data.receiver === username) || 
            (data.receiver === chatPartner && data.sender === username)) {
            appendMessage(data.sender, data.message);
        }
    });
}

// ================= HOME PAGE =================

function initHome() {
    currentUser = sessionStorage.getItem('user');
    if (!currentUser) {
        window.location.href = 'index.html';
        return;
    }

    // Setup
    document.getElementById('username-display').textContent = currentUser;
    document.getElementById('user-avatar').textContent = currentUser.charAt(0).toUpperCase();
    document.title = `${currentUser} - Cards Chat`;

    // Init socket
    initSocket(currentUser);

    // Load data
    loadFriends();
    loadRequests();
    loadSentRequests();

    // Auto-refresh every 3 seconds
    setInterval(() => {
        loadFriends();
        loadRequests();
        loadSentRequests();
    }, 3000);
}

function loadFriends() {
    fetch(`${API}/get_friends`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: currentUser })
    })
    .then(res => res.json())
    .then(friends => {
        const list = document.getElementById('friends-list');
        list.innerHTML = '';
        document.getElementById('friends-count').textContent = friends.length;

        // Join chat rooms for real-time messaging
        if (socket && friends.length > 0) {
            friends.forEach(friend => {
                socket.emit('join_chat', { user1: currentUser, user2: friend });
            });
        }

        if (friends.length === 0) {
            list.innerHTML = '<div class="friend-item"><div class="friend-info"><h4>No friends yet</h4><p>Search above to add people</p></div></div>';
            return;
        }

        friends.forEach(friend => {
            const div = document.createElement('div');
            div.className = 'friend-item';
            if (chatPartner === friend) div.classList.add('active');
            div.innerHTML = `
                <div class="friend-avatar">${friend.charAt(0).toUpperCase()}</div>
                <div class="friend-info">
                    <h4>${friend}</h4>
                    <p>Click to message</p>
                </div>
                <div class="friend-status online"></div>
            `;
            div.onclick = () => openChat(friend);
            list.appendChild(div);
        });
    });
}

function loadRequests() {
    fetch(`${API}/get_requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: currentUser })
    })
    .then(res => res.json())
    .then(requests => {
        const list = document.getElementById('requests-list');
        list.innerHTML = '';
        document.getElementById('requests-count').textContent = requests.length;

        if (requests.length === 0) {
            list.innerHTML = '<div class="request-item"><div class="request-info"><h4>No requests</h4></div></div>';
            return;
        }

        requests.forEach(sender => {
            const div = document.createElement('div');
            div.className = 'request-item';
            div.innerHTML = `
                <div class="request-info">
                    <h4>${sender}</h4>
                    <p>Wants to be your friend</p>
                </div>
                <div>
                    <button class="btn-accept" onclick="acceptRequest('${sender}')">Accept</button>
                    <button class="btn-decline" onclick="declineRequest('${sender}')">Decline</button>
                </div>
            `;
            list.appendChild(div);
        });
    });
}

function loadSentRequests() {
    fetch(`${API}/get_sent_requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: currentUser })
    })
    .then(res => res.json())
    .then(sent => {
        const list = document.getElementById('sent-list');
        list.innerHTML = '';
        document.getElementById('sent-count').textContent = sent.length;

        if (sent.length === 0) {
            list.innerHTML = '<div class="sent-item">No pending requests</div>';
            return;
        }

        sent.forEach(target => {
            const div = document.createElement('div');
            div.className = 'sent-item';
            div.innerHTML = `
                <div class="sent-info">
                    <h4>${target}</h4>
                    <p>Pending</p>
                </div>
                <button class="btn-cancel" onclick="cancelRequest('${target}')">Cancel</button>
            `;
            list.appendChild(div);
        });
    });
}

function acceptRequest(sender) {
    fetch(`${API}/accept_friend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: currentUser, sender })
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === 'success') {
            loadFriends();
            loadRequests();
            loadSentRequests();
        }
    });
}

function declineRequest(sender) {
    fetch(`${API}/remove_friend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user1: currentUser, user2: sender })
    })
    .then(res => res.json())
    .then(() => {
        loadRequests();
    });
}

function cancelRequest(target) {
    fetch(`${API}/remove_friend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user1: currentUser, user2: target })
    })
    .then(res => res.json())
    .then(() => {
        loadSentRequests();
    });
}

async function handleSearch() {
    const query = document.getElementById('search-users').value.trim();
    const resultsDiv = document.getElementById('search-results');

    if (!query) {
        resultsDiv.style.display = 'none';
        return;
    }

    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async () => {
        const res = await fetch(`${API}/search_users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user: currentUser, query })
        });
        const users = await res.json();

        if (users.length > 0) {
            resultsDiv.innerHTML = users.map(u => 
                `<div class="friend-item" style="cursor: pointer;" onclick="sendRequest('${u}'); resultsDiv.style.display='none';">
                    <div class="friend-avatar">${u.charAt(0).toUpperCase()}</div>
                    <div class="friend-info"><h4>${u}</h4></div>
                </div>`
            ).join('');
            resultsDiv.style.display = 'block';
        } else {
            resultsDiv.innerHTML = '<div class="request-item"><div class="request-info"><h4>No users found</h4></div></div>';
            resultsDiv.style.display = 'block';
        }
    }, 300);
}

function sendRequest(username) {
    document.getElementById('search-users').value = '';
    document.getElementById('search-results').style.display = 'none';

    fetch(`${API}/add_friend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user1: currentUser, user2: username })
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === 'success') {
            showNotification(`Request sent to ${username}!`);
            loadSentRequests();
        } else if (data.message.includes('already sent')) {
            showNotification(`They already sent you a request! Check your requests`);
        } else if (data.message.includes('Already friends')) {
            showNotification(`You are already friends with ${username}`);
        } else {
            showNotification(data.message);
        }
    });
}

// ================= CHAT =================

function openChat(friend) {
    chatPartner = friend;
    const chatArea = document.getElementById('chat-area');
    const emptyChat = document.getElementById('empty-chat');
    const chatContainer = document.getElementById('chat-container');

    if (chatArea) {
        emptyChat.style.display = 'none';
        chatContainer.style.display = 'flex';
    }

    document.getElementById('chat-username').textContent = friend;
    document.getElementById('chat-avatar').textContent = friend.charAt(0).toUpperCase();
    document.getElementById('chat-status').textContent = 'Online';

    // Join chat room
    if (socket) {
        socket.emit('join_chat', { user1: currentUser, user2: friend });
    }

    loadMessages();
}

function closeChat() {
    chatPartner = null;
    document.getElementById('empty-chat').style.display = 'flex';
    document.getElementById('chat-container').style.display = 'none';
    
    // Update active states
    document.querySelectorAll('.friend-item').forEach(el => el.classList.remove('active'));
}

function loadMessages() {
    if (!chatPartner) return;

    fetch(`${API}/messages/${currentUser}/${chatPartner}`)
    .then(res => res.json())
    .then(messages => {
        const container = document.getElementById('messages-container');
        container.innerHTML = '';

        messages.forEach(msg => {
            appendMessage(msg.sender, msg.message, msg.sent_at);
        });

        container.scrollTop = container.scrollHeight;
    });
}

function appendMessage(sender, message, timestamp) {
    const container = document.getElementById('messages-container');
    const isSent = sender === currentUser;
    const timeStr = timestamp ? new Date(timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${isSent ? 'sent' : 'received'}`;
    msgDiv.innerHTML = `
        ${!isSent ? `<div class="message-avatar">${sender.charAt(0).toUpperCase()}</div>` : ''}
        <div class="message-content">${escapeHtml(message)}</div>
        ${isSent ? `<div class="message-avatar">${sender.charAt(0).toUpperCase()}</div>` : ''}
        <div class="message-time">${timeStr}</div>
    `;
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
}

function sendMessage(e) {
    e.preventDefault();
    const input = document.getElementById('message-input');
    const message = input.value.trim();

    if (!message || !chatPartner) return;

    socket.emit('send_message', {
        sender: currentUser,
        receiver: chatPartner,
        message: message
    });

    input.value = '';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ================= UTILS =================

function showNotification(message) {
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

function goBack() {
    window.location.href = 'home.html';
}

// ================= AUTO-INIT =================

document.addEventListener('DOMContentLoaded', () => {
    // Auto-login if session exists and on home/chat page
    const user = sessionStorage.getItem('user');
    const path = window.location.pathname;

    if (user && (path.includes('home.html') || path.includes('chat.html'))) {
        if (path.includes('home.html')) {
            setTimeout(() => initHome(), 100);
        } else if (path.includes('chat.html')) {
            currentUser = user;
            document.getElementById('username-display').textContent = user;
            document.getElementById('user-avatar').textContent = user.charAt(0).toUpperCase();
            initSocket(user);
            loadFriends();
            loadRequests();

            // Check URL params for chat partner
            const urlParams = new URLSearchParams(window.location.search);
            const partner = urlParams.get('with');
            if (partner) {
                chatPartner = partner;
                setTimeout(() => openChat(partner), 200);
            }
        }
    }
});

// Expose functions globally
window.handleLogin = handleLogin;
window.handleSignup = handleSignup;
window.handleLogout = handleLogout;
window.toggleAuthTab = toggleAuthTab;
window.openChat = openChat;
window.closeChat = closeChat;
window.sendRequest = sendRequest;
window.acceptRequest = acceptRequest;
window.declineRequest = declineRequest;
window.cancelRequest = cancelRequest;
window.handleSearch = handleSearch;
window.goBack = goBack;