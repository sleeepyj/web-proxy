const express = require('express');
const cors = require('cors');
const http = require('http');
const { WebSocketServer } = require('ws');

const app = express();
app.use(cors());
app.use(express.static('public'));

// Proxy route
app.get('/proxy', async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).send('Missing ?url= parameter');
  try {
    const fetch = (await import('node-fetch')).default;
    const response = await fetch(target);
    const contentType = response.headers.get('content-type') || 'text/plain';
    const body = await response.text();
    res.setHeader('Content-Type', contentType);
    res.send(body);
  } catch (err) {
    res.status(500).send('Proxy error: ' + err.message);
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Store connected clients: { ws, username }
const clients = new Map();
// Store DM history: { "user1:user2": [...messages] }
const dmHistory = {};
// Public chat history (last 100)
const publicHistory = [];

function broadcast(data, excludeWs = null) {
  const msg = JSON.stringify(data);
  for (const [ws] of clients) {
    if (ws !== excludeWs && ws.readyState === 1) {
      ws.send(msg);
    }
  }
}

function sendTo(username, data) {
  for (const [ws, info] of clients) {
    if (info.username === username && ws.readyState === 1) {
      ws.send(JSON.stringify(data));
    }
  }
}

function getUserList() {
  return [...new Set([...clients.values()].map(c => c.username))];
}

function dmKey(a, b) {
  return [a, b].sort().join(':');
}

wss.on('connection', (ws) => {
  let username = null;

  ws.on('message', (raw) => {
    let data;
    try { data = JSON.parse(raw); } catch { return; }

    if (data.type === 'join') {
      // Check if username taken
      const taken = getUserList().includes(data.username);
      if (taken) {
        ws.send(JSON.stringify({ type: 'error', message: 'Username already taken' }));
        return;
      }
      username = data.username;
      clients.set(ws, { username });

      // Send them join confirmation + history + user list
      ws.send(JSON.stringify({ type: 'joined', username }));
      ws.send(JSON.stringify({ type: 'history', messages: publicHistory }));
      ws.send(JSON.stringify({ type: 'users', users: getUserList() }));

      // Tell everyone else
      broadcast({ type: 'users', users: getUserList() }, ws);
      broadcast({ type: 'public', from: 'System', text: username + ' joined the chat', ts: Date.now() }, ws);

      // Add to public history
      publicHistory.push({ from: 'System', text: username + ' joined the chat', ts: Date.now() });
      if (publicHistory.length > 100) publicHistory.shift();
    }

    else if (data.type === 'public') {
      if (!username) return;
      const msg = { type: 'public', from: username, text: data.text, ts: Date.now() };
      publicHistory.push(msg);
      if (publicHistory.length > 100) publicHistory.shift();
      broadcast(msg);
    }

    else if (data.type === 'dm') {
      if (!username) return;
      const key = dmKey(username, data.to);
      if (!dmHistory[key]) dmHistory[key] = [];
      const msg = { type: 'dm', from: username, to: data.to, text: data.text, ts: Date.now() };
      dmHistory[key].push(msg);
      if (dmHistory[key].length > 200) dmHistory[key].shift();
      // Send to both parties
      sendTo(data.to, msg);
      ws.send(JSON.stringify(msg));
    }

    else if (data.type === 'dm_history') {
      if (!username) return;
      const key = dmKey(username, data.with);
      ws.send(JSON.stringify({ type: 'dm_history', with: data.with, messages: dmHistory[key] || [] }));
    }
  });

  ws.on('close', () => {
    if (username) {
      clients.delete(ws);
      broadcast({ type: 'users', users: getUserList() });
      broadcast({ type: 'public', from: 'System', text: username + ' left the chat', ts: Date.now() });
      publicHistory.push({ from: 'System', text: username + ' left the chat', ts: Date.now() });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Nebula running on port ' + PORT));
