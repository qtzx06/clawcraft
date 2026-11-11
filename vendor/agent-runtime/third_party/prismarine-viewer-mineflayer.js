/*
MIT License

Copyright (c) 2020 PrismarineJS

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

This file is a lightly modified fork of `prismarine-viewer/lib/mineflayer.js`.
Changes:
- Bind the HTTP server to 127.0.0.1 by default (safer for managed agents).
*/

const EventEmitter = require('events');

module.exports = (bot, { viewDistance = 6, firstPerson = false, port = 3000, prefix = '', host = '0.0.0.0' }) => {
  const express = require('express');
  const { WorldView } = require('prismarine-viewer/viewer');

  const app = express();
  const http = require('http').createServer(app);

  const io = require('socket.io')(http, { path: prefix + '/socket.io' });

  // prismarine-viewer internal helper
  // eslint-disable-next-line global-require
  const { setupRoutes } = require('prismarine-viewer/lib/common');
  setupRoutes(app, prefix);

  const sockets = [];
  const primitives = {};

  bot.viewer = new EventEmitter();

  bot.viewer.erase = (id) => {
    delete primitives[id];
    for (const socket of sockets) socket.emit('primitive', { id });
  };

  bot.viewer.drawBoxGrid = (id, start, end, color = 'aqua') => {
    primitives[id] = { type: 'boxgrid', id, start, end, color };
    for (const socket of sockets) socket.emit('primitive', primitives[id]);
  };

  bot.viewer.drawLine = (id, points, color = 0xff0000) => {
    primitives[id] = { type: 'line', id, points, color };
    for (const socket of sockets) socket.emit('primitive', primitives[id]);
  };

  bot.viewer.drawPoints = (id, points, color = 0xff0000, size = 5) => {
    primitives[id] = { type: 'points', id, points, color, size };
    for (const socket of sockets) socket.emit('primitive', primitives[id]);
  };

  io.on('connection', (socket) => {
    socket.emit('version', bot.version);
    sockets.push(socket);

    const worldView = new WorldView(bot.world, viewDistance, bot.entity.position, socket);
    worldView.init(bot.entity.position);

    worldView.on('blockClicked', (block, face, button) => {
      bot.viewer.emit('blockClicked', block, face, button);
    });

    for (const id in primitives) socket.emit('primitive', primitives[id]);

    function botPosition() {
      const packet = { pos: bot.entity.position, yaw: bot.entity.yaw, addMesh: true };
      if (firstPerson) packet.pitch = bot.entity.pitch;
      socket.emit('position', packet);
      worldView.updatePosition(bot.entity.position);
    }

    bot.on('move', botPosition);
    worldView.listenToBot(bot);
    socket.on('disconnect', () => {
      bot.removeListener('move', botPosition);
      worldView.removeListenersFromBot(bot);
      sockets.splice(sockets.indexOf(socket), 1);
    });
  });

  http.listen(port, host, () => {
    // eslint-disable-next-line no-console
    console.log(`Prismarine viewer web server running on ${host}:${port}`);
  });

  bot.viewer.close = () => {
    http.close();
    for (const socket of sockets) socket.disconnect();
  };

  return { host, port };
};

