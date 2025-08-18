import { SlashCommandBuilder, SlashCommandStringOption } from "discord.js";
import { Command } from "../classes/command";
import { CommandContext } from "../classes/commandContext";
import { AutocompleteContext } from "../classes/autocompleteContext";

const command_data = new SlashCommandBuilder()
    .setName("alter_party")
    .setDMPermission(false)
    .setDescription("Alters the party end date and/or style")
    .addStringOption(
        new SlashCommandStringOption()
            .setName("date")
            .setDescription("New end date (ISO string or UNIX timestamp)")
            .setRequired(false)
    )
    .addStringOption(
        new SlashCommandStringOption()
            .setName("style")
            .setDescription("New style or category for this party")
            .setAutocomplete(true)
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

        const dateInput = ctx.interaction.options.getString("date")
        const targetTimestamp = dateInput ? this.parseDateInput(dateInput) : null
        const styleRaw = ctx.interaction.options.getString("style")?.toLowerCase()

        if(!dateInput && !styleRaw) return ctx.error({error: "Please specify at least one argument: date or style."})

        if(dateInput) {
            if(!targetTimestamp) return ctx.error({error: "Invalid date. Use ISO date (e.g. 2025-08-18T12:00:00Z) or UNIX timestamp."})
            const now = Date.now()
            if(targetTimestamp <= now) return ctx.error({error: "The new end date must be in the future."})
        }

        if(styleRaw) {
            const styleObj = ctx.client.horde_styles[styleRaw]
            const styleCategory = ctx.client.horde_style_categories[styleRaw]
            if(!styleObj && !styleCategory) return ctx.error({error: "A valid style or category is required"})
            if(ctx.client.config.generate?.blacklisted_styles?.includes(styleRaw)) return ctx.error({error: "The chosen style or category is blacklisted"})
        }

        const updated = await ctx.database
            .query(
                dateInput && styleRaw
                    ? "UPDATE parties SET ends_at=$2, style=$3 WHERE channel_id=$1 RETURNING *"
                    : dateInput
                        ? "UPDATE parties SET ends_at=$2 WHERE channel_id=$1 RETURNING *"
                        : "UPDATE parties SET style=$2 WHERE channel_id=$1 RETURNING *",
                dateInput && styleRaw
                    ? [ctx.interaction.channelId, new Date(targetTimestamp!), styleRaw]
                    : dateInput
                        ? [ctx.interaction.channelId, new Date(targetTimestamp!)]
                        : [ctx.interaction.channelId, styleRaw]
            )
            .catch(console.error)

        if(!updated?.rowCount) return ctx.error({error: "Unable to alter party end date"})

        // Invalidate cache so subsequent reads fetch the updated party
        ctx.client.cache.delete(`party-${ctx.interaction.channelId}`)

        const endEpoch = targetTimestamp ? Math.floor(targetTimestamp / 1000) : null
        await ctx.interaction.reply({
            content: dateInput && styleRaw
                ? "Party end date and style updated."
                : dateInput
                    ? "Party end date updated."
                    : "Party style updated.",
            ephemeral: true
        })

        // Announce the change in the party thread/channel
        await ctx.interaction.channel?.send({
            content:
                dateInput && styleRaw
                    ? `The party has been updated by <@${ctx.interaction.user.id}>.\nNew end: <t:${endEpoch}:R>\nNew ${ctx.client.horde_styles[styleRaw] ? "style" : "category"}: "${styleRaw}"`
                    : dateInput
                        ? `The party end date has been changed by <@${ctx.interaction.user.id}>.\nNew end: <t:${endEpoch}:R>`
                        : `The party style has been changed by <@${ctx.interaction.user.id}>.\nNew ${ctx.client.horde_styles[styleRaw!] ? "style" : "category"}: "${styleRaw}"`
        }).catch(console.error)

        // Try to edit the initial pinned message to reflect the new date
        try {
            const pinned = await ctx.interaction.channel?.messages.fetchPinned()
            const botId = ctx.client.user?.id
            pinned?.forEach(async (msg) => {
                if(msg.author?.id !== botId) return
                const old = msg.content || ""
                // Replace any Discord timestamp with the new relative timestamp
                let replaced = old
                if(endEpoch) replaced = replaced.replace(/<t:\d+(?::R)?>/g, `<t:${endEpoch}:R>`) // keep it relative for consistency
                if(styleRaw) {
                    const label = ctx.client.horde_styles[styleRaw] ? "style" : "category"
                    replaced = replaced.replace(/with the (category|style) "[^"]+"/i, `with the ${label} "${styleRaw}"`)
                }
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

    override async autocomplete(context: AutocompleteContext): Promise<any> {
        const option = context.interaction.options.getFocused(true)
        switch(option.name) {
            case "style": {
                const styles = Object.keys(context.client.horde_styles)
                const categories = Object.keys(context.client.horde_style_categories)
                const available = [...styles.map(s => ({name: `Style: ${s}`, value: s})), ...categories.map(s => ({name: `Category: ${s}`, value: s}))]
                const ret = option.value ? available.filter(s => s.value.toLowerCase().includes(String(option.value).toLowerCase())) : available
                return await context.interaction.respond(ret.slice(0,25))
            }
        }
    }
}
