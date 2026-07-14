import {readFileSync} from "fs"
import {ActivityType, ApplicationCommandType, InteractionType, PartialMessageReaction, Partials, PartialUser, PresenceUpdateStatus} from "discord.js";
import { AIHordeClient } from "./classes/client";
import { handleCommands } from "./handlers/commandHandler";
import { handleComponents } from "./handlers/componentHandler";
import { handleModals } from "./handlers/modalHandler";
import { handleAutocomplete } from "./handlers/autocompleteHandler";
import { AIHorde } from "@zeldafan0225/ai_horde";
import { handleContexts } from "./handlers/contextHandler";
import {existsSync, mkdirSync} from "fs"
import { handleMessageReact } from "./handlers/messageReact";
import { createDatabaseAdapter } from "./database";
import { DatabaseAdapter } from "./types";
import { ConnectionHealthMonitor } from "./classes/connectionHealth";

const RE_INI_KEY_VAL = /^\s*([\w.-]+)\s*=\s*(.*)?\s*$/
for (const line of readFileSync(`${process.cwd()}/.env`, 'utf8').split(/[\r\n]/)) {
    const [, key, value] = line.match(RE_INI_KEY_VAL) || []
    if (!key) continue

    process.env[key] = value?.trim() || ""
}

let connection: DatabaseAdapter | undefined
let connectionHealthMonitor: ConnectionHealthMonitor | undefined
let restartRequested = false


const client = new AIHordeClient({
    intents: ["Guilds", "GuildMessageReactions"],
    partials: [Partials.Reaction, Partials.Message]
})

if(client.config.advanced?.encrypt_token && !process.env["ENCRYPTION_KEY"]?.length)
    throw new Error("Either give a valid encryption key (you can generate one with 'npm run generate-key') or disable token encryption in your config.json file.")

async function bootstrap() {
    if(client.config.use_database !== false) {
        connection = createDatabaseAdapter(client.config)
        await connection.initialize()

        setInterval(() => {
            const cutoff = new Date(Date.now() - (1000 * 60 * 60 * 24 * 7))
            void connection?.deleteExpiredPendingKudos(cutoff).catch(console.error)
        }, 1000 * 60 * 60 * 24)
    }

    connectionHealthMonitor = new ConnectionHealthMonitor(client, client.config.connection_health, requestRestart)
    connectionHealthMonitor.start(client.config.connection_health?.enabled !== false)

    await client.login(process.env["DISCORD_TOKEN"])
}

function requestRestart(reason: string, error?: unknown) {
    if(restartRequested) return;
    restartRequested = true
    connectionHealthMonitor?.stop()
    console.error(`[Process] ${reason}`, error ?? "")
    process.exitCode = 1
    setTimeout(() => process.exit(1), 250)
}

const ai_horde_manager = new AIHorde({
    default_token: client.config.default_token,
    cache_interval: 1000,
    cache: {
        models: 1000 * 10,
        performance: 1000 * 10,
        teams: 1000 * 10
    },
    client_agent: `ZeldaFan-Discord-Bot:${client.bot_version}:https://github.com/MagicGoddess/AI_Horde_Discord-Cyra`
})

if(client.config.logs?.enabled) {
    client.initLogDir()
}

if(!existsSync(`${process.cwd()}/node_modules/webp-converter/temp`)) {
    mkdirSync("./node_modules/webp-converter/temp")
}


let clientInitialized = false

client.on("ready", () => {
    client.user?.setPresence({activities: [{type: ActivityType.Listening, name: "your generation requests | https://aihorde.net/"}], status: PresenceUpdateStatus.DoNotDisturb, })
    console.log(clientInitialized ? "[Discord] Ready after reconnect." : "[Discord] Ready.")
    if(clientInitialized) return;
    clientInitialized = true
    void initializeClient().catch(error => requestRestart("Discord client initialization failed.", error))
})

async function initializeClient() {
    await Promise.all([
        client.commands.loadClasses(),
        client.components.loadClasses(),
        client.contexts.loadClasses(),
        client.modals.loadClasses()
    ])
    if(client.config.generate?.enabled) {
        await refreshHordeData()
        setInterval(() => void refreshHordeData().catch(console.error), 1000 * 60 * 60 * 24)
    }
    await client.application?.commands.set([...client.commands.createPostBody(), ...client.contexts.createPostBody()]).catch(console.error)
    if((client.config.advanced_generate?.user_restrictions?.amount?.max ?? 4) > 10) throw new Error("More than 10 images are not supported in the bot")
    const maxLoraPresets = client.config.advanced_generate?.lora_presets?.max_presets_per_user ?? 25
    const maxLorasPerPreset = client.config.advanced_generate?.lora_presets?.max_loras_per_preset ?? 5
    if(maxLoraPresets < 1 || maxLoraPresets > 25) throw new Error("advanced_generate.lora_presets.max_presets_per_user must be between 1 and 25")
    if(maxLorasPerPreset < 1 || maxLorasPerPreset > 25) throw new Error("advanced_generate.lora_presets.max_loras_per_preset must be between 1 and 25")
    if(client.config.filter_actions?.guilds?.length && (client.config.filter_actions?.mode !== "whitelist" && client.config.filter_actions?.mode !== "blacklist")) throw new Error("The actions filter mode must be set to either whitelist, blacklist.")
    if(client.config.party?.enabled && !client.config.generate?.enabled) throw new Error("When party is enabled the /generate command also needs to be enabled")

    if(client.config.party?.enabled && connection) {
        await client.cleanUpParties(ai_horde_manager, connection)
        setInterval(() => void client.cleanUpParties(ai_horde_manager, connection).catch(console.error), 1000 * 60 * 5)
    }
}

async function refreshHordeData() {
    await Promise.all([
        client.loadHordeStyles(),
        client.loadHordeStyleCategories(),
        client.loadHordeCuratedLORAs()
    ])
}

if(client.config.react_to_transfer?.enabled) client.on("messageReactionAdd", async (r, u) => await handleMessageReact(r as PartialMessageReaction, u as PartialUser, client, connection, ai_horde_manager).catch(console.error))

client.on("interactionCreate", async (interaction) => {
    switch(interaction.type) {
        case InteractionType.ApplicationCommand: {
            switch(interaction.commandType) {
                case ApplicationCommandType.ChatInput: {
                    return await handleCommands(interaction, client, connection, ai_horde_manager).catch(console.error);
                }
                case ApplicationCommandType.User:
                case ApplicationCommandType.Message: {
                    return await handleContexts(interaction, client, connection, ai_horde_manager).catch(console.error);
                }
            }
        };
        case InteractionType.MessageComponent: {
			return await handleComponents(interaction, client, connection, ai_horde_manager).catch(console.error);
        };
        case InteractionType.ApplicationCommandAutocomplete: {
			return await handleAutocomplete(interaction, client, connection, ai_horde_manager).catch(console.error);
        };
        case InteractionType.ModalSubmit: {
			return await handleModals(interaction, client, connection, ai_horde_manager).catch(console.error);
        };
    }
})

process.on("unhandledRejection", error => {
    console.error("[Process] Unhandled promise rejection:", error)
})
process.on("uncaughtException", error => requestRestart("Uncaught exception.", error))

void bootstrap().catch(error => requestRestart("Bootstrap failed.", error))
