# Running dedicated server on Linux

## Current Google Cloud host

The current multiplayer host is `34.135.182.35`. Copy
`src/server/.env.google-cloud.example` to `src/server/.env`, fill in the secret
values on the VM, and start the server with:

```sh
npm ci
npm run build
npm run multiplayer
```

Google Cloud firewall rules must allow inbound TCP traffic on port `80` for
the game page and OAuth return, `8080` for the game socket, and `843` for the
Flash socket policy server. Players launch the shared client from:

```text
http://34.135.182.35/
```

The launcher is configured to open this address. Discord and MongoDB secrets
belong only in the VM's untracked `src/server/.env`; never copy them into the
launcher or commit them.

### Prerequisites

Warning: Run everything here within a tmux session if you'd like it to continue running once you log out of ssh

Ensure the following dependencies are installed on your host:

* podman
* tmux
* git
* text editor (e.g. vim)

### Podman Setup

On the machine that will host the dedicated server, execute the following commands individually:

```sh
mkdir -p $HOME/Games/dungeon-blitz-r
git clone https://github.com/minesa-org/dungeon-blitz-r $HOME/Games/dungeon-blitz-r
cd $HOME/Games/dungeon-blitz-r/Container
podman build --no-cache -t dungeon-blitz-r:latest .
```

### Running the Container

Run the container with:

```sh
podman run --replace -it \
  --name dungeon-blitz-r \
  --network=host \
  -v $HOME/Games:/opt/games \
  dungeon-blitz-r:latest
```

Type exit once it gets into a shell.

Start the container by running

```sh
podman start -ai dungeon-blitz-r
```

To start your server, run:
```sh
entrypoint.sh
```

### Required Discord OAuth account bootstrap

Password-created accounts are disabled for new users. Players must bootstrap or sync their game account through Discord OAuth first, then set a password for the Discord-linked account.

Required `.env` values:

```sh
PUBLIC_BASE_URL=http://34.135.182.35
DISCORD_CLIENT_ID=your_discord_application_id
DISCORD_CLIENT_SECRET=your_discord_client_secret
DISCORD_REDIRECT_URI=https://discord-github-assistant-bot.vercel.app/api/discord-oauth-callback
DISCORD_ACCOUNT_LINK_STATE_SECRET=hex_or_long_random_secret
```

Discord OAuth requests the `identify email` scope. Account creation requires a verified Discord email. New OAuth-created accounts use the verified Discord email as the game account email, and Discord profile fields are stored only as account metadata. Password login checks the account email and password hash; Discord metadata is not required for password authentication.

The game host page tries the Discord desktop client protocol first because older FlashBrowser builds cannot render Discord's modern OAuth web page. If the Discord client does not open, copy the shown OAuth URL into a modern external browser.

Do not store Discord client secrets, bot tokens, MongoDB credentials, passwords, OAuth tokens, or session secrets in committed files.

### Optional MongoDB wallet authority

Character saves, inventory, gear, missions, pets, and level state remain JSON-backed. MongoDB is used only for high-value wallet fields when explicitly enabled.

Supported wallet fields:

* `gold`
* `mammothIdols`
* `DragonKeys`
* `DragonOre`
* `SilverSigils`
* `RoyalSigils`
* lockbox counts only

Example `.env`:

```sh
MONGODB_URI=mongodb+srv://user:password@example.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB_NAME=dungeon_blitz_r
MONGODB_WALLET_COLLECTION=wallets
MONGO_WALLET_FLUSH_INTERVAL_MS=5000
ENABLE_MONGO_WALLET=true
ENABLE_MONGO_GAME_DATA=true
MONGODB_ACCOUNTS_COLLECTION=accounts
MONGODB_SAVES_COLLECTION=saves
MONGODB_COUNTERS_COLLECTION=counters
```

`MONGODB_DB_NAME` defaults to `minidb`, `MONGODB_WALLET_COLLECTION` defaults to `wallets`, and `MONGO_WALLET_FLUSH_INTERVAL_MS` defaults to `5000`. `ENABLE_MONGO_WALLET` defaults to true when `MONGODB_URI` is present and false otherwise. If Mongo wallet mode is enabled but the server cannot connect at startup, the game server refuses to start instead of falling back to stale JSON wallet values.

`ENABLE_MONGO_GAME_DATA` makes the `accounts` and `saves` collections authoritative for login and the complete character save object. It defaults to true whenever `MONGODB_URI` or `GAME_MONGODB_URI` is present; set it explicitly to `false` only for a wallet-only deployment. `GAME_MONGODB_DB_NAME` takes precedence over `MONGODB_DB_NAME`, which defaults to `minidb`, so the game server and Discord account service share the same configuration. Legacy `MONGO_DB_NAME` is deliberately ignored for game data because it may point at the sponsor database. Before enabling it against a new database, copy the current `Accounts.json` and every `data/saves/*.json` document:

```bash
npm run migrate:game-data-to-mongo -- --dry-run
npm run migrate:game-data-to-mongo
```

The migration preserves every complete character object in each account save, creates an empty save when an account has no save file, and initializes the shared user-id counter. Save files whose `user_id` is absent from `Accounts.json` are skipped by default so test fixtures and abandoned files cannot become live accounts; use `--include-orphan-saves` only after reviewing them. The migration is insert-only by default, so rerunning it cannot replace newer Mongo saves. Use `--overwrite` only for an intentional pre-cutover refresh. The Discord bot's `/create-account` command writes accounts and saves to these same collections.

Wallet documents are intentionally small. Each wallet document has a deterministic `_id` of `<gameUserId>:<characterNameKey>`, the numeric `gameUserId`, character name fields, wallet currency fields, `lockboxes`, `version`, and `updatedAt`. The wallet collection must not store Discord `accessToken`, `refreshToken`, `scope`, passwords, session secrets, or raw packet data.

Gold grants are buffered in server memory and appended to `data/wallet_journal.jsonl` before the in-memory balance changes. Buffered gold flushes to MongoDB on the configured interval, before character save/level transfer, and during server shutdown. Spends and non-gold wallet changes still use immediate MongoDB atomic updates.
