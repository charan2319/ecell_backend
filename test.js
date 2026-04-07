const express = require('express');
const app = express();
app.get('/', (req, res) => res.send('ok'));
const server = app.listen(5000, () => console.log('listening'));
server.on('close', () => console.log('closed'));
