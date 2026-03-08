# AI Horde Discord Bot - Cyra Edition

A personal fork of ZeldaFan0225/AI_Horde_Discord, with added features.

## Changes in this Fork

- New command `/alter_party`: Change a party's end date, style, and/or resolution.
  - Only the party creator can run it (same permissions as `/end_party`).
  - Optional argument `date`: ISO datetime (e.g. `2025-12-31T23:59:59Z`) or UNIX timestamp (seconds or milliseconds). Must be in the future if provided.
  - Optional argument `style`: a valid style or category name; validates against configured lists and blacklists.
  - Optional arguments `width` and `height`: override the party's generation resolution (px). You can set one or both.
  - At least one of `date` or `style` is required; the command errors if neither is provided.
  - Announces changes in the party thread and attempts to update the initial pinned message to reflect the new end time, style, and/or resolution.
  - Can revive an already expired party as long as it still exists in the database (i.e., not yet cleaned up or ended).
  - Note: This does not update any associated shared key expiry.
- New command `/party_revive`: Revive a purged party using its pinned settings.
  - Use inside the original party thread after it was purged from the DB (clean-up or manual end+purge).
  - Required argument `duration` (days) for how long the revived party should last.
  - Parses the first pinned party announcement to restore: creator, name, style/category, resolution (if any), kudos award, recurring flag, wordlist, and whether the creator paid for generations.
  - If the original party paid for generations, the creator must be logged in so a new shared key can be created.
  - If a party already exists in the thread, it will ask you to use `/alter_party` instead.
  - Posts and pins a fresh announcement reflecting the new end time.
- Progressive generation previews: `/generate` and `/advanced_generate` now attach completed images to the same generation message as soon as each image is finished, instead of waiting for the full batch.

---
Original desc:
# AI_Horde_Discord

A basic Discord bot to generate images using the AI Horde API.

**DISCLAIMER:** THIS REPOSITORY IS IN NO WAY ASSOCIATED TO THE CREATORS OF AI HORDE  
OFFERING THIS CODE IN FORM OF A PUBLIC DISCORD BOT WHICH CAN BE INVITED BY EVERYBODY IS NOT SUPPORTED.  
THE SCALE OF A BOT USING THIS CODE IS 1 SERVER, EVERYTHING ABOVE IS NOT SUPPORTED.  

## Features

View [the changelog](https://github.com/ZeldaFan0225/AI_Horde_Discord/blob/main/changelog.md) to see what has been added

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
  - `/alter_party` can adjust end date/style/resolution; `/party_revive` can restore a purged party from its pinned announcement.
- "Remix" to edit another discord users avatar 
- "Caption" to caption anozher discord users avatar
- advanced configuration file which lets you change how the bot behaves and what actions the user can use (for limits refer to https://aihorde.net/api)
- logging prompts, user id and generation id to track generation of malicious, nsfw or illegal content
- and even more...

## Version Requirements

- NodeJS >= 18.0.0

Optional:  
- PostgreSQL >= 14.6 or SQLite (local file)

## How to set up

### A detailed Linux setup can be found [here](https://github.com/ZeldaFan0225/AI_Horde_Discord/blob/main/DB_SETUP.md)

SQLite support is intended for local, single-instance deployments and fresh SQLite databases only.

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
8) modify the [config.json](https://github.com/ZeldaFan0225/AI_Horde_Discord/blob/main/template.config.json) file (from step 4) to fit your needs (you can read about what which property does in [config.md](https://github.com/ZeldaFan0225/AI_Horde_Discord/blob/main/config.md))  
9) compile the code and start the process (this can be done by using `npm run deploy`)  
  
Now if everything is set up it should start and give an output in the console.  


## Encryption Key
When changing your encryption key after deployment the tokens won't be decrypted properly.  
Avoid changing the encryption key after initial setup.
Disabling encryption at any point will make commands for users who saved their tokens in an encrypted form not work any more.

## How to update

1) Pull the code from this repository
2) Update your config. Reading through the [changelog](https://github.com/ZeldaFan0225/AI_Horde_Discord/blob/main/changelog.md) might help.
