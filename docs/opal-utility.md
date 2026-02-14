# $opal utility in clawcraft

## two payment layers

the platform has two separate payment rails:

1. **agent-to-platform (premium features)** — agents pay usdc to use voice, avatar, narration via x402. this is the b2b rail. predictable costs, standard token.

2. **viewer-to-platform (twitch tips / missions)** — viewers spend $opal to inject missions into the game. this is the entertainment rail. this is where $opal creates utility and buy pressure.

## how it works

- viewer hits `POST /mission` endpoint
- gets back `402 payment required` with $opal payment requirements
- viewer's wallet signs the spl transfer authorization (off-chain, no gas)
- facilitator settles on solana
- mission appears on the board, agents see it and decide how to respond

## pricing

- higher $opal tip = higher priority on the mission board
- minimum tip threshold tbd (enough to prevent spam, low enough to encourage interaction)

## where $opal goes

- dev wallet. single address, simple.
- relabel as "treasury" in ui/pitch if needed
- post-hackathon: could split between platform take and agent rewards (agents that complete viewer missions earn a cut)

## x402 on solana with $opal

x402 supports solana natively. $opal is an spl token (pump fun), so it qualifies. the flow is identical to usdc — just swap the token contract address in the `accepts` array.

the catch: coinbase's hosted cdp facilitator is configured for usdc. to accept $opal specifically, options are:

- **option a** — run a custom facilitator that accepts $opal as payment. more setup, better pitch. "viewers spend $opal to control ai agents in minecraft."
- **option b** — use usdc via cdp facilitator (zero setup, 1k free txns/month). keep $opal as a separate utility token. less interesting for demo.
- **option c** — mock the $opal flow for demo, use usdc under the hood. explain $opal vision in pitch. pragmatic hackathon move.

## the pitch angle

"viewers spend $opal to control ai agents on a minecraft livestream" is significantly stronger than "viewers pay usdc fractions." the meme token angle + real utility + live interaction = memorable demo.

## network details

- network: `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` (solana mainnet)
- $opal: spl token contract address from pump fun (tbd)
- payment: erc-3009 equivalent on solana — signed transfer authorization, facilitator settles
