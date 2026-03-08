import { ChannelType, SlashCommandBuilder, SlashCommandIntegerOption } from "discord.js";
import { Command } from "../classes/command";
import { CommandContext } from "../classes/commandContext";
import { Config } from "../types";
import { readFileSync } from "fs";

const config = JSON.parse(readFileSync("./config.json").toString()) as Config

const command_data = new SlashCommandBuilder()
    .setName("party_revive")
    .setDMPermission(false)
    .setDescription("Revives a purged party in this thread using the pinned settings")
    .addIntegerOption(
        new SlashCommandIntegerOption()
            .setName("duration")
            .setDescription("Duration in days the revived party should last")
            .setRequired(true)
            .setMinValue(config.party?.user_restrictions?.duration?.min ?? 1)
            .setMaxValue(config.party?.user_restrictions?.duration?.max ?? 30)
    )

export default class extends Command {
    constructor() {
        super({
            name: "party_revive",
            command_data: command_data.toJSON(),
            staff_only: false,
        })
    }

    override async run(ctx: CommandContext): Promise<any> {
        if(!ctx.client.config.party?.enabled) return ctx.error({error: "Party is disabled."})
        if(!ctx.database) return ctx.error({error: "The database is disabled. This action requires a database."})
        if(ctx.interaction.channel?.type !== ChannelType.PublicThread) return ctx.error({error: "Use this command inside the party thread"})

        const duration = ctx.interaction.options.getInteger("duration", true)

        // If a party already exists for this thread, inform user to alter instead
        const existing = await ctx.client.getParty(ctx.interaction.channelId, ctx.database)
        if(existing?.channel_id) return ctx.error({error: "A party is already ongoing in this thread. Use /alter_party instead."})

        await ctx.interaction.deferReply({ephemeral: true})

        // Find the first pinned party announcement from the bot
        const pinned = await ctx.interaction.channel?.messages.fetchPinned().catch(console.error)
        if(!pinned?.size) return ctx.error({error: "No pinned messages found in this thread to reconstruct settings."})

        const botId = ctx.client.user?.id
        // Prefer the oldest pinned message from the bot
        const candidates = pinned.filter(m => m.author?.id === botId)
        const target = (candidates.size ? candidates : pinned)
            .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
            .first()

        if(!target?.content) return ctx.error({error: "Pinned message does not contain parsable content."})

        const content = target.content

        // Parse creator
        const mentionedCreator = target.mentions.users.first()?.id || content.match(/<@(?<id>\d+)>\s+started the party/i)?.groups?.["id"]
        if(!mentionedCreator) return ctx.error({error: "Unable to determine party creator from pinned message."})
        if(mentionedCreator !== ctx.interaction.user.id) return ctx.error({error: "Only the original party creator can revive this party."})

        // Parse name (not strictly needed for DB, but used in announcement)
        const name = content.match(/started the party\s+"(?<name>[^"\\]+)"/i)?.groups?.["name"] || "Party"

        // Parse style or category
        const styleMatch = content.match(/with the\s+(?<type>category|style)\s+"(?<style>[^"\\]+?)"/i)
        let styleRaw: string = styleMatch?.groups?.["style"] || ""

        // Fallback: if quoted style not found, try parsing with optional opening quote (for broken messages)
        if(!styleRaw) {
            const fallbackMatch = content.match(/with the\s+(?<type>category|style)\s+"?(?<style>[a-z0-9_-]+)/i)
            styleRaw = fallbackMatch?.groups?.["style"] || ""
        }

        if(!styleRaw) return ctx.error({error: "Unable to find style/category in pinned message."})
        
        // Extract just the style name (before any newline or "Resolution:" text)
        styleRaw = styleRaw.trim().split('\n')[0]!.trim().split(' ')[0]!.trim().toLowerCase()
        if(ctx.client.config.generate?.blacklisted_styles?.includes(styleRaw)) return ctx.error({error: "The pinned style/category is blacklisted."})

        // Parse optional resolution
        const resMatch = content.match(/Resolution:\s+(?<w>\d+|-)x(?<h>\d+|-)/i)
        const width = resMatch?.groups?.["w"] && resMatch.groups["w"] !== "-" ? Number(resMatch.groups["w"]) : null
        const height = resMatch?.groups?.["h"] && resMatch.groups["h"] !== "-" ? Number(resMatch.groups["h"]) : null

        // Parse award
        const awardStr = content.match(/You will get\s+(?<award>\d+)\s+kudos/i)?.groups?.["award"]
        const award = awardStr ? Number(awardStr) : null
        if(!award || !Number.isFinite(award)) return ctx.error({error: "Unable to determine kudos award from pinned message."})

        // Recurring flag
        const recurring = /every generation/i.test(content)

        // Wordlist
        const wordlistStr = content.match(/The prompt has to include the words:\s*(?<words>[^\n]+)/i)?.groups?.["words"]
        const wordlist = wordlistStr ? wordlistStr.split(",").map(w => w.trim().toLowerCase()).filter(Boolean) : []

        // Pay for generations
        const pays = /will pay for all generations/i.test(content)

        // Validate style exists (style or category)
        const styleObj = ctx.client.horde_styles[styleRaw] || ctx.client.horde_style_categories[styleRaw]
        if(!styleObj) return ctx.error({error: "The pinned style/category is no longer available."})

        // Prepare shared key if we are paying for generations
        let shared_key_id: string | null = null
        if(pays) {
            const token = await ctx.client.getUserToken(mentionedCreator, ctx.database)
            if(!token) return ctx.error({error: "The original party had payments enabled, but the creator is not logged in."})

            const sk = await ctx.ai_horde_manager.putSharedKey({
                kudos: 100000,
                expiry: duration,
                name: `Party ${name}`
            }, {token}).catch(console.error)
            if(!sk?.id) return ctx.error({error: "Failed to create a shared key for the revived party."})
            shared_key_id = sk.id
        }

        // Insert the new party row using current thread id
        const party = await ctx.database.createParty({
            channel_id: ctx.interaction.channelId,
            guild_id: ctx.interaction.guildId!,
            creator_id: mentionedCreator,
            ends_at: new Date(Date.now() + (1000 * 60 * 60 * 24 * duration)),
            style: styleRaw,
            width,
            height,
            award,
            recurring,
            shared_key: shared_key_id,
            wordlist
        }).catch(console.error)

        if(!party) return ctx.error({error: "Unable to revive party (DB insert failed)."})

        // Announce the revived party in this thread
        const styleType = Array.isArray(styleObj) ? "category" : "style"
        const endEpoch = Math.round((Date.now() + 1000 * 60 * 60 * 24 * duration) / 1000)
        const announce = await ctx.interaction.channel?.send({
            content: `<@${mentionedCreator}> revived the party "${name}" with the ${styleType} "${styleRaw}".${(width || height) ? `\nResolution: ${width ?? "-"}x${height ?? "-"}` : ""}\nYou will get ${award} kudos for ${recurring ? `every generation` : `your first generation`}.\nThe party ends <t:${endEpoch}:R>${wordlist.length ? `\nThe prompt has to include the words: ${wordlist.join(",")}` : ""}${pays && shared_key_id ? "\nThe party creator will pay for all generations 🥳" : ""}\n\n${ctx.client.config.party?.mention_roles?.length ? ctx.client.config.party.mention_roles.map(r => `<@&${r}>`).join(" ") : ""}`,
            allowedMentions: { users: [mentionedCreator], roles: ctx.client.config.party?.mention_roles }
        }).catch(console.error)

        await announce?.pin().catch(console.error)

        await ctx.interaction.editReply({content: announce?.id ? "Party revived." : "Party revived in DB, but failed to announce."})
    }
}
