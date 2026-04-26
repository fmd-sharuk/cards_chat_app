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
            sessionStorage.setItem("user", username);
            console.log("[LOGIN] User stored:", username);
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
// HOME INIT
// =====================
function initHome() {
    if (!window.location.pathname.includes("home.html")) return;

    const user = sessionStorage.getItem("user");

    if (!user) {
        window.location.href = "index.html";
        return;
    }

    sessionStorage.removeItem("chatWith");

    document.getElementById("userDisplay").innerText = "👤 " + user;

    if (!window.chatSocket) {
        window.chatSocket = io(API);
        
        window.chatSocket.on("connect", () => {
            console.log("[SOCKET] Connected for user:", user);
        });

        window.chatSocket.on("friend_request", (data) => {
            if (data.to === user) {
                console.log("[SOCKET] New friend request for:", user);
                loadRequests();
                loadSentRequests();
                loadFriends();
            }
        });

        window.chatSocket.on("friend_update", (data) => {
            if (data.user === user) {
                console.log("[SOCKET] Friend update for:", user);
                loadFriends();
                loadRequests();
                loadSentRequests();
            }
        });

        window.chatSocket.on("receive_message", (data) => {
            console.log("[SOCKET] Message received for:", user, data);
            if (window.location.pathname.includes("chat.html")) {
                appendMessage(data.sender, data.message);
            }
        });
    }

    function refreshAll() {
        console.log("[HOME] Refreshing UI for user:", user);
        loadFriends();
        loadRequests();
        loadSentRequests();
    }

    refreshAll();

    const intervalId = setInterval(refreshAll, 2000);

    window.addEventListener("beforeunload", () => {
        clearInterval(intervalId);
    });
}

initHome();

function loadAll() {
    const user = sessionStorage.getItem("user");
    console.log("[LOADALL] Loading for:", user);
    loadFriends();
    loadRequests();
    loadSentRequests();
}

// ADD FRIEND
function addFriend() {
    const user1 = sessionStorage.getItem("user");
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
        if (data.status === "success" || data.status === "exists") {
            document.getElementById("friendInput").value = "";
            loadAll();
        }
    })
    .catch(err => console.error("[addFriend] Error:", err));
}

// LOAD REQUESTS
function loadRequests() {
    const user = sessionStorage.getItem("user");
    console.log("[loadRequests] for:", user);

    fetch(API + "/get_requests", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ user })
    })
    .then(res => {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
    })
    .then(data => {
        console.log("[loadRequests] got:", data);
        const list = document.getElementById("requestList");
        list.innerHTML = "";

        if (!Array.isArray(data) || data.length === 0) {
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
    .catch(err => console.error("[loadRequests] Error:", err));
}

// ACCEPT FRIEND
function acceptFriend(sender) {
    const user = sessionStorage.getItem("user");

    fetch(API + "/accept_friend", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ user1: user, user2: sender })
    })
    .then(res => {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
    })
    .then(data => {
        console.log("[acceptFriend] response:", data);
        if (data.status === "accepted") {
            loadFriends();
            loadRequests();
            loadSentRequests();
        }
    })
    .catch(err => console.error("[acceptFriend] Error:", err));
}

// FRIENDS LIST
function loadFriends() {
    const user = sessionStorage.getItem("user");
    console.log("[loadFriends] for:", user);

    fetch(API + "/friends/" + encodeURIComponent(user))
    .then(res => {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
    })
    .then(data => {
        console.log("[loadFriends] got:", data);
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
    .catch(err => console.error("[loadFriends] Error:", err));
}

function openChat(friend) {
    sessionStorage.setItem("chatWith", friend);
    window.location.href = "chat.html";
}

// SENT REQUESTS
function loadSentRequests() {
    const user = sessionStorage.getItem("user");
    console.log("[loadSentRequests] for:", user);

    fetch(API + "/get_sent_requests", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ user })
    })
    .then(res => {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
    })
    .then(data => {
        console.log("[loadSentRequests] got:", data);
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
    .catch(err => console.error("[loadSentRequests] Error:", err));
}

// CHAT
if (window.location.pathname.includes("chat.html")) {
    const user = sessionStorage.getItem("user");
    const friend = sessionStorage.getItem("chatWith");

    if (!user || !friend) {
        window.location.href = "home.html";
    } else {
        if (!window.chatSocket) {
            window.chatSocket = io(API);
        }

        const room = user + "__" + friend;
        console.log("[CHAT] Room:", room);
        window.chatSocket.emit("join", { room });

        loadMessages();

        window.chatSocket.on("receive_message", (data) => {
            console.log("[CHAT] Received:", data);
            appendMessage(data.sender, data.message);
        });
    }
}

function sendMessage() {
    const sender = sessionStorage.getItem("user");
    const receiver = sessionStorage.getItem("chatWith");
    const message = document.getElementById("msgInput").value.trim();

    if (!message) return;

    const room = sender + "__" + receiver;

    fetch(API + "/send_message", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({sender, receiver, message})
    }).catch(err => console.error("[sendMessage] Error:", err));

    if (window.chatSocket) {
        window.chatSocket.emit("send_message", {
            room: room,
            sender: sender,
            message: message
        });
    }

    appendMessage(sender, message);

    document.getElementById("msgInput").value = "";
}

function loadMessages() {
    const user1 = sessionStorage.getItem("user");
    const user2 = sessionStorage.getItem("chatWith");

    console.log("[loadMessages] between:", user1, user2);

    fetch(API + `/messages/${encodeURIComponent(user1)}/${encodeURIComponent(user2)}`)
    .then(res => {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
    })
    .then(data => {
        console.log("[loadMessages] got:", data);
        const box = document.getElementById("messages");
        box.innerHTML = "";
        if (Array.isArray(data)) {
            data.forEach(m => appendMessage(m.sender, m.message));
        }
    })
    .catch(err => console.error("[loadMessages] Error:", err));
}

function appendMessage(sender, message) {
    const box = document.getElementById("messages");
    const isCurrentUser = sender === sessionStorage.getItem("user");

    box.innerHTML += `
        <div class="${isCurrentUser ? "me" : "other"}">
            ${message}
        </div>`;

    box.scrollTop = box.scrollHeight;
}
