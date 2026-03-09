import { SlashCommandBooleanOption, SlashCommandBuilder, SlashCommandStringOption, SlashCommandIntegerOption } from "discord.js";
import { Command } from "../classes/command";
import { CommandContext } from "../classes/commandContext";
import { AutocompleteContext } from "../classes/autocompleteContext";

const command_data = new SlashCommandBuilder()
    .setName("alter_party")
    .setDMPermission(false)
    .setDescription("Alters the party end date, style, resolution, and advanced generation setting")
    .addStringOption(
        new SlashCommandStringOption()
            .setName("date")
            .setDescription("New end date (ISO string or UNIX timestamp)")
            .setRequired(false)
    )
    .addIntegerOption(
        new SlashCommandIntegerOption()
            .setName("width")
            .setDescription("Override generation width (px)")
            .setMinValue(64)
            .setMaxValue(3072)
            .setAutocomplete(true)
    )
    .addIntegerOption(
        new SlashCommandIntegerOption()
            .setName("height")
            .setDescription("Override generation height (px)")
            .setMinValue(64)
            .setMaxValue(3072)
            .setAutocomplete(true)
    )
    .addStringOption(
        new SlashCommandStringOption()
            .setName("style")
            .setDescription("New style or category for this party")
            .setAutocomplete(true)
    )
    .addBooleanOption(
        new SlashCommandBooleanOption()
            .setName("advanced_generation_allowed")
            .setDescription("Whether /advanced_generate is allowed in this party")
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
        const width = ctx.interaction.options.getInteger("width")
        const height = ctx.interaction.options.getInteger("height")
        const advancedGenerateAllowed = ctx.interaction.options.getBoolean("advanced_generation_allowed")

        if(!dateInput && !styleRaw && width === null && height === null && advancedGenerateAllowed === null) return ctx.error({error: "Please specify at least one argument: date, style, width, height or advanced_generation_allowed."})

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
            .updateParty(ctx.interaction.channelId, {
                ...(dateInput ? {ends_at: new Date(targetTimestamp!)} : {}),
                ...(styleRaw ? {style: styleRaw} : {}),
                ...(width !== null && width !== undefined ? {width} : {}),
                ...(height !== null && height !== undefined ? {height} : {}),
                ...(advancedGenerateAllowed !== null ? {advanced_generate_allowed: advancedGenerateAllowed} : {})
            })
            .catch(console.error)

        if(!updated) return ctx.error({error: "Unable to alter party end date"})

        // Invalidate cache so subsequent reads fetch the updated party
        ctx.client.cache.delete(`party-${ctx.interaction.channelId}`)

        const endEpoch = targetTimestamp ? Math.floor(targetTimestamp / 1000) : null
        await ctx.interaction.reply({
            content: [
                dateInput ? "Party end date updated." : null,
                styleRaw ? "Party style updated." : null,
                (width !== null && width !== undefined) || (height !== null && height !== undefined) ? "Party resolution updated." : null,
                advancedGenerateAllowed !== null ? "Party advanced generation setting updated." : null
            ].filter(Boolean).join(" "),
            ephemeral: true
        })

        // Announce the change in the party thread/channel
        await ctx.interaction.channel?.send({
            content: [
                `The party has been updated by <@${ctx.interaction.user.id}>.`,
                dateInput ? `New end: <t:${endEpoch}:R>` : null,
                styleRaw ? `New ${ctx.client.horde_styles[styleRaw] ? "style" : "category"}: "${styleRaw}"` : null,
                (width !== null && width !== undefined) || (height !== null && height !== undefined) ? `New resolution: ${width ?? "-"}x${height ?? "-"}` : null,
                advancedGenerateAllowed !== null ? `Advanced generation: ${advancedGenerateAllowed ? "allowed" : "disabled"}` : null
            ].filter(Boolean).join("\n")
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
                if((width !== null && width !== undefined) || (height !== null && height !== undefined)) {
                    if(/\nResolution: .*x.*/i.test(replaced)) {
                        replaced = replaced.replace(/\nResolution: .*x.*/i, `\nResolution: ${width ?? "-"}x${height ?? "-"}`)
                    } else {
                        replaced = replaced.replace(/("\.|\nYou will get)/, `\nResolution: ${width ?? "-"}x${height ?? "-"}$1`)
                    }
                }
                if(advancedGenerateAllowed !== null) {
                    if(/\nAdvanced generation: (allowed|disabled)/i.test(replaced)) {
                        replaced = replaced.replace(/\nAdvanced generation: (allowed|disabled)/i, `\nAdvanced generation: ${advancedGenerateAllowed ? "allowed" : "disabled"}`)
                    } else {
                        replaced = replaced.replace(/(\nYou will get)/, `\nAdvanced generation: ${advancedGenerateAllowed ? "allowed" : "disabled"}$1`)
                    }
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
            case "width":
            case "height": {
                const steps = Array.from({length: 3072/64}).map((_, i) => ({name: `${(i+1)*64}px${(i+1)*64 > 1024 ? " (Requires Kudos upfront)" : ""}`, value: (i+1)*64})).filter(v => v.value >= (context.client.config.advanced_generate?.user_restrictions?.height?.min ?? 64) && v.value <= (context.client.config.advanced_generate?.user_restrictions?.height?.max ?? 3072))
                const inp = context.interaction.options.getFocused(true)
                return await context.interaction.respond(steps.filter((v) => !inp.value || `${v.value}`.includes(String(inp.value))).slice(0,25))
            }
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
