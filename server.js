const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.static('public'));

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

app.listen(3000, () => console.log('Proxy running on port 3000'));