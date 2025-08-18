import { SlashCommandBuilder, SlashCommandStringOption } from "discord.js";
import { Command } from "../classes/command";
import { CommandContext } from "../classes/commandContext";

const command_data = new SlashCommandBuilder()
    .setName("alter_party")
    .setDMPermission(false)
    .setDescription("Alters the end date of the current party")
    .addStringOption(
        new SlashCommandStringOption()
            .setName("date")
            .setDescription("New end date (ISO string or UNIX timestamp)")
            .setRequired(true)
    )

export default class extends Command {
    constructor() {
        super({
            name: "alter_party",
            command_data: command_data.toJSON(),
            staff_only: false,
        })
    }

    override async run(ctx: CommandContext): Promise<any> {
        if(!ctx.client.config.party?.enabled) return ctx.error({error: "Party is disabled."})
        if(!ctx.database) return ctx.error({error: "The database is disabled. This action requires a database."})

        const party = await ctx.client.getParty(ctx.interaction.channelId, ctx.database)
        if(!party?.channel_id) return ctx.error({error: "Unable to find party"})
        if(party?.creator_id !== ctx.interaction.user.id) return ctx.error({error: "Only the creator can alter this party"})

        const dateInput = ctx.interaction.options.getString("date", true)
        const targetTimestamp = this.parseDateInput(dateInput)

        if(!targetTimestamp) return ctx.error({error: "Invalid date. Use ISO date (e.g. 2025-08-18T12:00:00Z) or UNIX timestamp."})
        const now = Date.now()
        if(targetTimestamp <= now) return ctx.error({error: "The new end date must be in the future."})

        const updated = await ctx.database
            .query("UPDATE parties SET ends_at=$2 WHERE channel_id=$1 RETURNING *", [ctx.interaction.channelId, new Date(targetTimestamp)])
            .catch(console.error)

        if(!updated?.rowCount) return ctx.error({error: "Unable to alter party end date"})

        // Invalidate cache so subsequent reads fetch the updated party
        ctx.client.cache.delete(`party-${ctx.interaction.channelId}`)

        const endEpoch = Math.floor(targetTimestamp / 1000)
        await ctx.interaction.reply({content: "Party end date updated.", ephemeral: true})

        // Announce the change in the party thread/channel
        await ctx.interaction.channel?.send({
            content: `The party end date has been changed by <@${ctx.interaction.user.id}>.\nNew end: <t:${endEpoch}:R>`
        }).catch(console.error)

        // Try to edit the initial pinned message to reflect the new date
        try {
            const pinned = await ctx.interaction.channel?.messages.fetchPinned()
            const botId = ctx.client.user?.id
            pinned?.forEach(async (msg) => {
                if(msg.author?.id !== botId) return
                const old = msg.content || ""
                // Replace any Discord timestamp with the new relative timestamp
                const replaced = old.replace(/<t:\d+(?::R)?>/g, `<t:${endEpoch}:R>`) // keep it relative for consistency
                if(replaced !== old) await msg.edit({content: replaced}).catch(console.error)
            })
        } catch(e) {
            console.error(e)
        }
    }

    private parseDateInput(input: string): number | null {
        const trimmed = input.trim()
        if(/^\d+$/.test(trimmed)) {
            // numeric: treat 10-digit as seconds, 13+ as ms
            const num = Number(trimmed)
            if(!Number.isFinite(num)) return null
            if(trimmed.length >= 13) return num // milliseconds
            return num * 1000 // seconds -> ms
        }
        const parsed = Date.parse(trimmed)
        if(Number.isNaN(parsed)) return null
        return parsed
    }
}

