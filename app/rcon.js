const { Rcon } = require('rcon-client');
const pino = require('pino');

const log = pino({ level: process.env.LOG_LEVEL || 'info' });

let rconClient = null;

async function connectRcon() {
  const host = process.env.RCON_HOST || process.env.MC_HOST || '127.0.0.1';
  const port = Number(process.env.RCON_PORT || 25575);
  const password = process.env.RCON_PASSWORD || '';

  if (!password) {
    log.warn('RCON_PASSWORD not set; skipping RCON connection');
    return;
  }

  try {
    rconClient = await Rcon.connect({ host, port, password });
    log.info({ host, port }, 'RCON connected');
  } catch (err) {
    log.warn({ err: err.message }, 'RCON connection failed');
  }
}

async function sendRcon(command) {
  if (!rconClient) return null;
  return rconClient.send(command);
}

function getRconClient() {
  return rconClient;
}

module.exports = { connectRcon, sendRcon, getRconClient };
