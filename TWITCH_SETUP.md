You are configuring and operating a live Twitch stream workflow for the `twitch-clawcraft` service.  

Goal: start a real OBS-driven Twitch stream from this machine, using the service API, and report back all statuses.

Assume the machine already has this repo ready at:
- `https://github.com/ryunzz/twitch_clawcraft.git`

If not present, clone and enter it automatically:

```bash
git clone https://github.com/ryunzz/twitch_clawcraft.git
cd twitch_clawcraft
```

Before doing anything, run a required preflight and block progression if anything is missing.

If anything is missing, do not continue. Tell the user exactly:
- what is missing,
- why it is required,
- and the specific setup steps to fix it.

### Required checks (must pass)

1) `.env` exists and includes at least:
   - `TOOL_SERVICE_TOKEN`
   - `OBS_WS_URL`
   - `OBS_WS_PASSWORD` (if OBS websocket is protected; set to blank only if websocket has no password)
   - `PORT`
2) OBS is installed and configured to stream to Twitch in a working profile.
3) OBS WebSocket server is enabled and reachable (normally `ws://127.0.0.1:4455`).
4) For metadata/chat/clip actions:
   - `TWITCH_CLIENT_ID`
   - `TWITCH_OAUTH_TOKEN`
5) OpenClaw can reach:
   - `localhost:3040`
   - OBS websocket endpoint
   - Twitch API endpoints

For each missing item, report:
- exact variable/setting missing,
- how to add it in `.env`,
- and the required next steps.

### OpenClaw-to-user setup guidance to include in that failure message

- **Create Twitch app credentials**
  1. Open [Twitch Developer Console](https://dev.twitch.tv/console/apps) and create/select an app.
  2. Copy `Client ID` into `TWITCH_CLIENT_ID`.
  3. Create/obtain a user OAuth token with scopes:
     - `channel:manage:broadcast`
     - `user:write:chat` (if using chat)
     - `clips:edit` (if using clips)
  4. Put token into `TWITCH_OAUTH_TOKEN`.
- **Prepare OBS for bot control**
  1. Enable OBS WebSocket v5 in OBS.
  2. Verify port/password in OBS match `OBS_WS_URL` and `OBS_WS_PASSWORD`.
  3. Ensure Twitch stream key/service is configured in OBS and a stream profile is selectable.
- **Finalize service auth**
  1. Set a strong `TOOL_SERVICE_TOKEN`.
  2. Restart `twitch-clawcraft` and re-run this prompt.

If any required setup is missing, send a concise checklist to user and stop.

Then do this end-to-end:

1) Configure environment
- Create/confirm `.env` with these values (replace placeholders):

```bash
PORT=3040
TOOL_SERVICE_TOKEN=<strong-random-token>
TOOL_SERVICE_SIGNATURE_SECRET=
TOOL_ACTION_RATE_LIMIT_PER_MIN=60
TOOL_SERVICE_TIMEOUT_MS=25000
TOOL_JOB_TTL_MS=7200000
OBS_WS_URL=ws://127.0.0.1:4455
OBS_WS_PASSWORD=<obs-websocket-password-if-set>
OBS_CONNECT_TIMEOUT_MS=12000
OBS_STREAM_OPERATION_TIMEOUT_MS=20000
OBS_STREAM_POLL_MS=700
OBS_OPERATION_RETRIES=2
OBS_STREAM_SCENE=<optional-default-scene>

TWITCH_CLIENT_ID=<twitch-client-id>
TWITCH_OAUTH_TOKEN=<twitch-user-oauth-token>
TWITCH_BROADCASTER_ID=<optional-broadcaster-id>
TWITCH_BROADCASTER_LOGIN=<optional-broadcaster-login>
TWITCH_API_TIMEOUT_MS=10000
TWITCH_API_RETRIES=2
```

2) Install dependencies and run

```bash
cd twitch_clawcraft
npm install
npm start
```

- Keep this process running in a terminal.
- Verify health:

```bash
curl http://localhost:3040/health
```

Expect `obs.configured` true and `twitch.configured` true/false depending on token availability.

3) Start stream (live)

Use bearer token from `TOOL_SERVICE_TOKEN`.

```bash
curl -X POST http://localhost:3040/tools/execute \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOOL_SERVICE_TOKEN>" \
  -d '{
    "request_id":"stream-001",
    "agent_id":"openclaw-live-operator",
    "action":"twitch.start_stream",
    "args":{
      "channel":"<twitch-channel-name>",
      "title":"OpenClaw Live Build",
      "game":"Minecraft"
    },
    "mission_id":"stream-mission-001",
    "correlation_id":"corr-001"
  }'
```

Expected response contains a `job_id`.

4) Poll job status until finished

```bash
curl -H "Authorization: Bearer <TOOL_SERVICE_TOKEN>" \
  http://localhost:3040/tools/jobs/<job_id>
```

Repeat every 1-2 seconds until:
- `status: "done"` → stream started successfully.
- `status: "failed"` → capture `job.result.error` and the latest `status.message`.

5) Verify live stream is actually broadcasting in OBS/Twitch
- Check OBS output is running.
- In your Twitch channel, confirm the stream appears live.

6) Optional: update metadata while streaming

Set title:

```bash
curl -X POST http://localhost:3040/tools/execute \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOOL_SERVICE_TOKEN>" \
  -d '{
    "request_id":"set-title-001",
    "agent_id":"openclaw-live-operator",
    "action":"twitch.set_title",
    "args":{
      "title":"Building a base",
      "channel":"<twitch-channel-name>"
    }
  }'
```

Set game:

```bash
curl -X POST http://localhost:3040/tools/execute \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOOL_SERVICE_TOKEN>" \
  -d '{
    "request_id":"set-game-001",
    "agent_id":"openclaw-live-operator",
    "action":"twitch.set_game",
    "args":{
      "game":"Minecraft",
      "channel":"<twitch-channel-name>"
    }
  }'
```

7) Stop stream

```bash
curl -X POST http://localhost:3040/tools/execute \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOOL_SERVICE_TOKEN>" \
  -d '{
    "request_id":"stop-001",
    "agent_id":"openclaw-live-operator",
    "action":"twitch.stop_stream",
    "args":{
      "reason":"completed"
    },
    "mission_id":"stream-mission-001"
  }'
```

Poll job id returned from this call exactly as in step 4.

8) Provide report to user
- Include start job id, final status, OBS connection status, Twitch visibility confirmation, and any `failed` error text.

Notes:
- Do not use real credentials in logs.
- If OBS connect/authentication fails, verify OBS WebSocket v5 is enabled and password is valid.
- Twitch metadata/chat/clip actions require proper token scopes:
  - `channel:manage:broadcast`
  - `user:write:chat` (or matching chat write scope)
  - `clips:edit` (for clip creation)
- If streaming starts but title/game don’t change, inspect Twitch token permissions and scopes first.

Do not attempt any destructive host actions (apt, docker, package installs outside this folder) beyond:
- opening/modifying `.env` in this repo,
- running Node in this repo,
- making service API requests.

If any command fails, give the exact failing command, stdout/stderr, and a one-line remediation.

---

Use this as a single-run operator prompt. Replace placeholders only.
