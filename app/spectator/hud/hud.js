(function () {
  var hud = document.getElementById('hud');
  var nameEl = document.getElementById('agent-name');
  var healthEl = document.getElementById('health');
  var foodEl = document.getElementById('food');
  var posEl = document.getElementById('pos');
  var taglineEl = document.getElementById('tagline');

  var wsUrl = 'ws://' + location.host + '/hud/ws';
  var ws;

  function connect() {
    ws = new WebSocket(wsUrl);

    ws.onmessage = function (event) {
      var data = JSON.parse(event.data);
      update(data);
    };

    ws.onclose = function () {
      setTimeout(connect, 2000);
    };

    ws.onerror = function () {
      ws.close();
    };
  }

  function update(data) {
    if (!data.agent) {
      hud.classList.add('hidden');
      return;
    }

    nameEl.textContent = data.agent;
    healthEl.textContent = Math.round(data.health);
    foodEl.textContent = Math.round(data.food);
    posEl.textContent = data.x + ' / ' + data.y + ' / ' + data.z;
    taglineEl.textContent = data.tagline || '';
    taglineEl.style.display = data.tagline ? 'block' : 'none';

    hud.classList.remove('hidden');
  }

  connect();
})();
