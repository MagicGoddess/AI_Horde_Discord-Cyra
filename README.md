# AI Horde Discord Bot - Cyra Edition

A personal fork of ZeldaFan0225/AI_Horde_Discord, with added features.

> **Disclaimer:** This fork uses AI-generated code and has not been thoroughly tested. Use it at your own risk.

## Changes in this Fork

- New command `/alter_party`: Change a party's end date, style, resolution, and advanced generation setting.
  - Only the party creator can run it (same permissions as `/end_party`).
  - Optional argument `date`: ISO datetime (e.g. `2025-12-31T23:59:59Z`) or UNIX timestamp (seconds or milliseconds). Must be in the future if provided.
  - Optional argument `style`: a valid style or category name; validates against configured lists and blacklists.
  - Optional arguments `width` and `height`: override the party's generation resolution (px). You can set one or both.
  - Optional argument `advanced_generation_allowed`: allows `/advanced_generate` inside the party when enabled.
  - At least one option is required; the command errors if none are provided.
  - Announces changes in the party thread and attempts to update the initial pinned message to reflect the new end time, style, resolution, and advanced generation setting.
  - Can revive an already expired party as long as it still exists in the database (i.e., not yet cleaned up or ended).
  - Note: This does not update any associated shared key expiry.
- New command `/party_revive`: Revive a purged party using its pinned settings.
  - Use inside the original party thread after it was purged from the DB (clean-up or manual end+purge).
  - Required argument `duration` (days) for how long the revived party should last.
  - Parses the first pinned party announcement to restore: creator, name, style/category, resolution (if any), kudos award, recurring flag, advanced generation setting, wordlist, and whether the creator paid for generations.
  - If the original party paid for generations, the creator must be logged in so a new shared key can be created.
  - If a party already exists in the thread, it will ask you to use `/alter_party` instead.
  - Posts and pins a fresh announcement reflecting the new end time.
- Database backend support now includes SQLite next to PostgreSQL.
  - Select the backend with `database.type` in `config.json`.
  - SQLite uses a local file at `database.sqlite.path` and is intended for fresh, single-instance deployments.
  - Existing SQLite databases are migrated automatically on startup when new party columns are added.
  - Runtime database files under `data/` are ignored by git.
- Progressive generation previews: `/generate` and `/advanced_generate` now attach completed images to the same generation message as soon as each image is finished, instead of waiting for the full batch.
- Generation timing: `/generate`, `/advanced_generate`, and remix now show how long a generation took when it completes successfully, and include elapsed time in system/API failure messages.
- Failed generation summaries: `/generate` and `/advanced_generate` now keep a final failure embed with request details such as prompt, style, kudos consumed, elapsed time, and generation ID instead of dropping the embed entirely when the request faults or times out.
- Completed `/advanced_generate` results include owner-only iteration controls.
  - **Reroll** repeats the submitted options with a new random seed.
  - Results made with a personal LoRA preset also include **Tweak & Generate**, which reopens the strength editor with the exact LoRA versions and strengths used. An explicitly submitted seed is retained for controlled comparisons.
  - Replay setups are retained for 30 days by default. Database-backed setups survive restarts; without a database, controls work until the process restarts.
  - Image-to-image results retain `original.webp` for replay when Discord's ten-attachment limit allows it.
- Personal LoRA presets provide reusable multi-LoRA setups for `/advanced_generate`.
  - Generation summaries display each applied LoRA on its own line for readability.
  - Use `/lora_preset create`, `edit`, `list`, and `delete` to manage private presets through an ephemeral editor.
  - `/lora_preset share` posts an immutable preset snapshot with a button other users can use to copy it into their own presets. The sharer can delete the shared message.
  - Each LoRA has one strength from -5 to 5 applied to both model and CLIP, and Horde automatically injects an available trigger word.
  - New LoRAs follow the latest CivitAI version automatically. Use **Version** in the preset editor to pin a specific version (including its base model), or switch it back to **Always use latest** later. If the latest release is not Horde-eligible but an older release is, the editor requires an eligible exact version when adding it.
  - Pinned version choices are retained when temporarily adjusting strengths and when sharing or copying a preset. Mixed base-model families show a warning but can still be saved.
  - In `/advanced_generate`, set `adjust_lora_strengths` when selecting a preset to temporarily change its strengths for that generation without creating or modifying a preset.
  - Presets with up to five LoRAs use one modal field per LoRA; larger configured presets use `CivitAI_ID=strength` lines in one field.
  - The existing `lora` generation option lists personal presets first while retaining direct single CivitAI model-page IDs for one-off use.
  - Presets require a configured database; direct LoRA selection remains available when the database is disabled.
  - Defaults allow 25 presets per user and five LoRAs per preset; both limits are configurable under `advanced_generate.lora_presets`.
- Graceful Discord gateway recovery prevents temporary DNS or network failures from leaving the bot online but unresponsive.
  - Monitors gateway readiness and acknowledged heartbeats while allowing discord.js to perform its native reconnection first.
  - Exits with an error when the gateway remains unhealthy beyond `connection_health.grace_period_seconds`, allowing PM2 to restart the bot with exponential backoff.
  - Logs gateway disconnect, reconnect, resume, invalid-session, and shard error events.
  - Restarts after failed startup logins or uncaught exceptions, while logging unrelated unhandled promise rejections without treating transient API failures as gateway failures.
  - Keeps ready-time initialization idempotent so reconnects do not duplicate background maintenance intervals.

---
Original desc:
# AI_Horde_Discord

A basic Discord bot to generate images using the AI Horde API.

**DISCLAIMER:** THIS REPOSITORY IS IN NO WAY ASSOCIATED TO THE CREATORS OF AI HORDE  
OFFERING THIS CODE IN FORM OF A PUBLIC DISCORD BOT WHICH CAN BE INVITED BY EVERYBODY IS NOT SUPPORTED.  
THE SCALE OF A BOT USING THIS CODE IS 1 SERVER, EVERYTHING ABOVE IS NOT SUPPORTED.  

## Features

View [the changelog](changelog.md) to see what has been added

This package includes the code for a discord bot which interacts with the ai horde api.
The bot has the following features:

- /generate command with all options the api supports at the time of creating this file
- /login, /logout and /updatetoken for users to add and manage their account which they can create at https://aihorde.net/register
- /userinfo (Userinfo context command) which shows your ai horde user information and the user information of anybody else who is logged in
- /terms which shows how the bot currently handles the api token and further information
- /models which shows all currently available models
- /worker which lets you see information on an active worker
- /team which lets you see information on a team
- /news which shows latest news about the horde
- /transferkudos (Transfer Kudos context command) to send somebody kudos
- /interrogate to interrogate any image
- /party to start a generation party with a given style
  - Optional `width`/`height` parameters let you override the chosen style's default resolution for the entire party.
  - Optional `advanced_generation_allowed` lets the party creator permit `/advanced_generate` in that thread. It defaults to `party.default.advanced_generation_allowed`, or `false` if unset.
  - When `/advanced_generate` is allowed in a party, the party style stays locked and mandatory prompt words still apply just like `/generate`.
  - `/alter_party` can adjust end date/style/resolution/advanced generation; `/party_revive` can restore a purged party from its pinned announcement.
- "Remix" to edit another discord users avatar 
- "Caption" to caption anozher discord users avatar
- advanced configuration file which lets you change how the bot behaves and what actions the user can use (for limits refer to https://aihorde.net/api)
- Discord gateway health monitoring with automatic recovery from stalled connections and temporary DNS/network failures when run under PM2
- logging prompts, user id and generation id to track generation of malicious, nsfw or illegal content
- and even more...

## Version Requirements

- NodeJS >= 18.0.0

Optional:  
- PostgreSQL >= 14.6 or SQLite (local file)

## How to set up

### A detailed Linux setup can be found [here](DB_SETUP.md)

SQLite support is intended for local, single-instance deployments. Required tables and additive schema changes are initialized automatically on startup.

1) download the code from this repository  
2) get the token of your discord bot (https://discord.com/developers/docs/reference#authentication)  
3) Install the node modules using `npm i` (make sure the dev dependencies are also installed for typescript to work)  
4) remove the `template.` from the `template.config.json` file  
  
If you want to have extra functionality do the following steps:  

5) choose a database backend
   - PostgreSQL: keep `"database.type": "postgres"` and set up a postgres database
   - SQLite: set `"database.type": "sqlite"` and optionally change `"database.sqlite.path"`
6) fill out the `template.env` and rename it to `.env`  
  
If you just want to generate images with no token or the default token in the config.json file do the following steps:  

5) modify the config file and set `use_database` to false  
6) fill out the `template.env` and rename it to `.env` (you can leave the keys prefixed with `DB_` empty)  
  
7) Run `npm run generate-key` and copy the generated encryption key in your `.env` (If you disabled token encryption you can leave it blank)
8) modify the [config.json](template.config.json) file (from step 4) to fit your needs (you can read about what which property does in [config.md](config.md))
9) compile the code and start the process (this can be done by using `npm run deploy`)  
  
Now if everything is set up it should start and give an output in the console.  

For automatic recovery from an unrecoverable Discord gateway connection, run the compiled bot with the supplied `ecosystem.config.js` under PM2. Cyra first allows discord.js to reconnect for `connection_health.grace_period_seconds`; if the connection remains unhealthy, it exits with an error and PM2 restarts it with exponential backoff. Running `node .` directly still detects and exits on an unhealthy connection, but it cannot restart itself.


## Encryption Key
When changing your encryption key after deployment the tokens won't be decrypted properly.  
Avoid changing the encryption key after initial setup.
Disabling encryption at any point will make commands for users who saved their tokens in an encrypted form not work any more.

## How to update

1) Pull the code from this repository
2) Update your config. Reading through the [changelog](changelog.md) might help.
