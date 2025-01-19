const socket = io();

const usernamePrompt = document.getElementById('username-prompt');
const usernameInput = document.getElementById('username-input');
const joinButton = document.getElementById('join-button');
const chatContainer = document.getElementById('chat-container');
const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');

let username = '';

joinButton.addEventListener('click', () => {
    username = usernameInput.value.trim();
    if (username) {
        socket.emit('join', { username });
        usernamePrompt.style.display = 'none';
        chatContainer.style.display = 'block';
    }
});

socket.on('status', (data) => {
    const statusElement = document.createElement('div');
    statusElement.textContent = data.msg;
    statusElement.style.fontStyle = 'italic';
    messagesDiv.appendChild(statusElement);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
});

socket.on('message', (msg) => {
    const messageElement = document.createElement('div');
    messageElement.textContent = msg;
    messagesDiv.appendChild(messageElement);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
});

sendButton.addEventListener('click', () => {
    const msg = messageInput.value.trim();
    if (msg) {
        socket.emit('message', { msg });
        messageInput.value = '';
    }
});

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendButton.click();
    }
});
