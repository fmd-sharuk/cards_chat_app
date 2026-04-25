const API = "http://127.0.0.1:5000";

// AUTH
function login() {
    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value.trim();

    fetch(API + "/login", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({username: username.toLowerCase(), password})
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === "success") {
            localStorage.setItem("user", username);
            window.location.href = "home.html";
        } else alert(data.message || data.status);
    });
}

function signup() {
    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value.trim();

    fetch(API + "/signup", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({username: username.toLowerCase(), password})
    })
    .then(res => res.json())
    .then(data => alert(data.message || data.status));
}

// =====================
// HOME INIT (FINAL FIX)
// =====================
function initHome() {
    if (!window.location.pathname.includes("home.html")) return;

    const user = localStorage.getItem("user");

    if (!user) {
        window.location.href = "index.html";
        return;
    }

    // Clear stale chat state on home load
    localStorage.removeItem("chatWith");

    document.getElementById("userDisplay").innerText = "👤 " + user;

    // Initialize socket connection for this user session
    // Socket is created on-demand to ensure isolation
    if (!window.chatSocket) {
        window.chatSocket = io(API);
        
        window.chatSocket.on("connect", () => {
            console.log("Socket connected for user:", user);
        });

        // Realtime: new friend request received
        window.chatSocket.on("friend_request", (data) => {
            if (data.to === user) {
                console.log("New friend request for:", user);
                loadRequests();
                loadSentRequests();
                loadFriends();
            }
        });

        // Realtime: friend list updated (e.g., after accept)
        window.chatSocket.on("friend_update", (data) => {
            if (data.user === user) {
                console.log("Friend update for:", user);
                loadFriends();
                loadRequests();
                loadSentRequests();
            }
        });

        // Realtime: receive message
        window.chatSocket.on("receive_message", (data) => {
            console.log("Message received for:", user, data);
            if (window.location.pathname.includes("chat.html")) {
                appendMessage(data.sender, data.message);
            }
        });
    }

    function refreshAll() {
        console.log("Refreshing UI for user:", user);
        loadFriends();
        loadRequests();
        loadSentRequests();
    }

    // ✅ LOAD IMMEDIATELY
    refreshAll();

    // ✅ KEEP LIVE UPDATES - poll every 2 seconds
    const intervalId = setInterval(refreshAll, 2000);

    // Cleanup on page leave
    window.addEventListener("beforeunload", () => {
        clearInterval(intervalId);
    });
}

// Run on DOM ready
document.addEventListener("DOMContentLoaded", initHome);

function loadAll() {
    const user = localStorage.getItem("user");
    console.log("Loading all data for:", user);
    loadFriends();
    loadRequests();
    loadSentRequests();
}

// ADD FRIEND
function addFriend() {
    const user1 = localStorage.getItem("user");
    const user2 = document.getElementById("friendInput").value.trim();

    if (!user2 || user1 === user2) return alert("Invalid username");

    fetch(API + "/add_friend", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ user1, user2 })
    })
    .then(res => res.json())
    .then(data => {
        alert(data.message || data.status);
        if (data.status === "success") {
            document.getElementById("friendInput").value = "";
            loadAll();
        } else if (data.status === "exists") {
            loadAll();
        }
    })
    .catch(err => console.error(err));
}

// LOAD REQUESTS
function loadRequests() {
    const user = localStorage.getItem("user");

    fetch(API + "/get_requests", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ user })
    })
    .then(res => res.json())
    .then(data => {
        const list = document.getElementById("requestList");
        list.innerHTML = "";

        if (!data || !Array.isArray(data) || data.length === 0) {
            list.innerHTML = "<p>No requests</p>";
            return;
        }

        data.forEach(sender => {
            list.innerHTML += `
                <div class="request-item">
                    <span>${sender}</span>
                    <button onclick="acceptFriend('${sender}')">Accept</button>
                </div>`;
        });
    })
    .catch(err => console.error(err));
}

// ACCEPT
function acceptFriend(sender) {
    const user = localStorage.getItem("user");

    fetch(API + "/accept_friend", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ user1: user, user2: sender })
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === "accepted") {
            console.log("Friend accepted, refreshing all data");
            loadAll();
        }
    })
    .catch(err => console.error(err));
}

// FRIENDS
function loadFriends() {
    const user = localStorage.getItem("user");

    fetch(API + "/friends/" + encodeURIComponent(user))
    .then(res => res.json())
    .then(data => {
        const list = document.getElementById("friendList");
        list.innerHTML = "";

        if (!Array.isArray(data) || data.length === 0) {
            list.innerHTML = "<p>No friends</p>";
            return;
        }

        data.forEach(f => {
            list.innerHTML += `
                <div class="friend-item" onclick="openChat('${encodeURIComponent(f)}')">
                    💬 ${f}
                </div>`;
        });
    })
    .catch(err => console.error(err));
}

function openChat(friend) {
    localStorage.setItem("chatWith", friend);
    window.location.href = "chat.html";
}

// SENT
function loadSentRequests() {
    const user = localStorage.getItem("user");

    fetch(API + "/get_sent_requests", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ user })
    })
    .then(res => res.json())
    .then(data => {
        const list = document.getElementById("sentList");
        list.innerHTML = "";

        if (!Array.isArray(data) || data.length === 0) {
            list.innerHTML = "<p>No sent</p>";
            return;
        }

        data.forEach(u => {
            list.innerHTML += `<div class="sent-item">⏳ ${u}</div>`;
        });
    })
    .catch(err => console.error(err));
}

// CHAT INIT
if (window.location.pathname.includes("chat.html")) {
    const user = localStorage.getItem("user");
    const friend = localStorage.getItem("chatWith");

    if (!user || !friend) {
        window.location.href = "home.html";
    } else {
        // Initialize socket connection
        if (!window.chatSocket) {
            window.chatSocket = io(API);
        }

        // Room format must match backend: user__receiver (and we join both directions)
        const room = user + "__" + friend;
        window.chatSocket.emit("join", { room });

        loadMessages();

        window.chatSocket.on("receive_message", (data) => {
            console.log("Received message in chat:", data);
            appendMessage(data.sender, data.message);
        });
    }
}

function sendMessage() {
    const sender = localStorage.getItem("user");
    const receiver = localStorage.getItem("chatWith");
    const message = document.getElementById("msgInput").value.trim();

    if (!message) return;

    const room = sender + "__" + receiver;

    // ✅ save to database via HTTP
    fetch(API + "/send_message", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({sender, receiver, message})
    }).catch(err => console.error(err));

    // ✅ real-time emit via socket
    if (window.chatSocket) {
        window.chatSocket.emit("send_message", {
            room: room,
            sender: sender,
            message: message
        });
    }

    // Also append locally for instant feedback
    appendMessage(sender, message);

    document.getElementById("msgInput").value = "";
}

function loadMessages() {
    const u1 = localStorage.getItem("user");
    const u2 = localStorage.getItem("chatWith");

    fetch(API + `/messages/${encodeURIComponent(u1)}/${encodeURIComponent(u2)}`)
    .then(res => res.json())
    .then(data => {
        const box = document.getElementById("messages");
        box.innerHTML = "";
        if (Array.isArray(data)) {
            data.forEach(m => appendMessage(m.sender, m.message));
        }
    })
    .catch(err => console.error(err));
}

function appendMessage(sender, message) {
    const box = document.getElementById("messages");
    const isCurrentUser = sender === localStorage.getItem("user");

    box.innerHTML += `
        <div class="${isCurrentUser ? "me" : "other"}">
            ${message}
        </div>`;

    // Auto-scroll to bottom
    box.scrollTop = box.scrollHeight;
}