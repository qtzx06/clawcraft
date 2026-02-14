# x402 Gateway Starter (Mock)

This repo now includes a lightweight mock gateway at `app/x402-gateway.js` so you can start payment-gated endpoints without waiting on the full x402 stack.

Available endpoints:

- `POST /voice`
- `POST /avatar`
- `POST /narrate`
- `GET /health`
- `GET /metrics`

Behavior:

- If `x402` is enabled, requests without a valid `PAYMENT-SIGNATURE` header receive `402`.
- The response includes `PAYMENT-REQUIRED` as base64 JSON with accepted payment details and a challenge.
- A valid retry header (`PAYMENT-SIGNATURE`) carries a base64 JSON payload signed with the shared secret and is accepted by the mock.
- Signature is an HMAC-SHA256 of the challenge payload with `X402_PAYMENT_SECRET`.
- Set `X402_STRICT_VERIFICATION=1` for strict challenge validation.
- In development, set `X402_MOCK_BYPASS=1` to skip payment checks.

x402 client helper:

`app/x402-client.js` exports `requestWithPayment(url, options, opts)`:

- sends request to a premium endpoint
- if response is `402`, reads `PAYMENT-REQUIRED`
- signs challenge with `opts.paymentSecret` and retries with `PAYMENT-SIGNATURE`

Important:

- This is local gateway bootstrap logic.
- Signature verification is HMAC-based and should be replaced by chain-native checks for production.
- It is intended for early integration and UI flow testing only.

Environment variables:

- `X402_PORT` (default `3100`)
- `X402_VOICE_PRICE`, `X402_AVATAR_PRICE`, `X402_NARRATE_PRICE`
- `X402_FACILITATOR`
- `X402_CHAIN` (default `eip155:8453`)
- `X402_USDC_TOKEN`
- `X402_CHALLENGE_TTL_MS`
- `X402_PAYMENT_SECRET`
- `X402_STRICT_VERIFICATION`
- `X402_MOCK_BYPASS` (`1` to bypass)
- `LOG_LEVEL`

Run:

```bash
npm run start:x402
```

Metrics:

- `/metrics` exports Prometheus counters and request latency for payment attempts and endpoint usage.
