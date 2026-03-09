import { ChannelType, SlashCommandBooleanOption, SlashCommandBuilder, SlashCommandIntegerOption, SlashCommandStringOption, ThreadAutoArchiveDuration } from "discord.js";
import { AutocompleteContext } from "../classes/autocompleteContext";
import { Command } from "../classes/command";
import { CommandContext } from "../classes/commandContext";
import { Config } from "../types";
import { readFileSync } from "fs";

const config = JSON.parse(readFileSync("./config.json").toString()) as Config

const command_data = new SlashCommandBuilder()
    .setName("party")
    .setDMPermission(false)
    .setDescription(`Starts a generation party`)
    if(config.party?.enabled) {
        command_data
        .addStringOption(
            new SlashCommandStringOption()
            .setName("name")
            .setDescription("The name of the party")
            .setRequired(true)
            .setMaxLength(100)
        )
        .addIntegerOption(
            new SlashCommandIntegerOption()
            .setName("award")
            .setDescription("The amount of kudos to award to every generation")
            .setRequired(true)
            .setMinValue(config.party.user_restrictions?.award?.min ?? 1)
            .setMaxValue(config.party.user_restrictions?.award?.max ?? 100000)
        )
        .addIntegerOption(
            new SlashCommandIntegerOption()
            .setName("duration")
            .setDescription("The duration of how long the party should last in days")
            .setRequired(true)
            .setMinValue(config.party.user_restrictions?.duration?.min ?? 1)
            .setMaxValue(config.party.user_restrictions?.duration?.max ?? 30)
        )
        .addStringOption(
            new SlashCommandStringOption()
            .setName("style")
            .setDescription("The style to use for generations")
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addIntegerOption(
            new SlashCommandIntegerOption()
            .setName("width")
            .setDescription("Override generation width (px)")
            .setRequired(false)
            .setMinValue(64)
            .setMaxValue(3072)
            .setAutocomplete(true)
        )
        .addIntegerOption(
            new SlashCommandIntegerOption()
            .setName("height")
            .setDescription("Override generation height (px)")
            .setRequired(false)
            .setMinValue(64)
            .setMaxValue(3072)
            .setAutocomplete(true)
        )
        .addBooleanOption(
            new SlashCommandBooleanOption()
            .setName("recurring")
            .setDescription("If users get rewarded for each generation or only their first")
        )
        .addBooleanOption(
            new SlashCommandBooleanOption()
            .setName("pay_for_generations")
            .setDescription("Whether to pay for the generations users make")
        )
        .addBooleanOption(
            new SlashCommandBooleanOption()
            .setName("advanced_generation_allowed")
            .setDescription("Whether /advanced_generate is allowed in this party")
        )
        .addStringOption(
            new SlashCommandStringOption()
            .setName("wordlist")
            .setDescription("Set a comma separated list of words the users prompt has to include")
        )
    }


export default class extends Command {
    constructor() {
        super({
            name: "party",
            command_data: command_data.toJSON(),
            staff_only: false,
        })
    }

    override async run(ctx: CommandContext): Promise<any> {
        if(!ctx.client.config.party?.enabled) return ctx.error({error: "Party is disabled."})
        if(!ctx.database) return ctx.error({error: "The database is disabled. This action requires a database."})
        if(ctx.interaction.channel?.type !== ChannelType.GuildText) return ctx.error({error: "This command can only be used in text channels"})

        const name = ctx.interaction.options.getString("name", true)
        const award = ctx.interaction.options.getInteger("award", true)
        const duration = ctx.interaction.options.getInteger("duration", true)
        const recurring = !!(ctx.interaction.options.getBoolean("recurring") ?? ctx.client.config.party?.default?.recurring)
        const pay = !!(ctx.interaction.options.getBoolean("pay_for_generations") ?? ctx.client.config.party?.default?.pay_for_generations)
        const advancedGenerateAllowed = !!(ctx.interaction.options.getBoolean("advanced_generation_allowed") ?? ctx.client.config.party?.default?.advanced_generation_allowed ?? false)
        const wordlist = (ctx.interaction.options.getString("wordlist") ?? "").split(",").map(w => w.trim().toLowerCase()).filter(w => w)
        const style_raw = ctx.interaction.options.getString("style") ?? ctx.client.config.generate?.default?.style ?? "raw"
        const style = ctx.client.horde_styles[style_raw.toLowerCase()] || ctx.client.horde_style_categories[style_raw.toLowerCase()]
        const override_width = ctx.interaction.options.getInteger("width") || null
        const override_height = ctx.interaction.options.getInteger("height") || null

        const user_token = await ctx.client.getUserToken(ctx.interaction.user.id, ctx.database)

        if(ctx.client.config.advanced?.dev) {
            console.log(style)
        }

        if(!user_token) return ctx.error({error: "You need to be logged in to start a party"})
        if(!style) return ctx.error({error: "A valid style is required"})
        if(ctx.client.config.generate?.blacklisted_styles?.includes(style_raw.toLowerCase())) return ctx.error({error: "The chosen style or category is blacklisted"})

        if(ctx.client.config.party.user_restrictions?.wordlist) {
            if(
                ctx.client.config.party.user_restrictions?.wordlist.min || 0 > wordlist.length ||
                ctx.client.config.party.user_restrictions?.wordlist.max && ctx.client.config.party.user_restrictions?.wordlist.max < wordlist.length
            ) return ctx.error({error: `Your wordlist must be between ${ctx.client.config.party.user_restrictions?.wordlist.min || "no"} and ${ctx.client.config.party.user_restrictions?.wordlist.max || "unlimited"} words`})
        }

        await ctx.interaction.deferReply({ephemeral: true})

        const thread = await ctx.interaction.channel.threads.create({
            name,
            autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek
        }).catch(console.error)
        if(!thread?.id) return ctx.error({error: "Unable to start party"})

        let shared_key_id: string | null = null

        if(pay) {
            const token = await ctx.client.getUserToken(ctx.interaction.user.id, ctx.database)

            const shared_key = await ctx.ai_horde_manager.putSharedKey({
                kudos: 100000,
                expiry: duration,
                name: `Party ${name}`
            }, {token}).catch(console.error)

            if(shared_key?.id) shared_key_id = shared_key.id
            if(ctx.client.config.advanced?.dev) console.log(shared_key_id)
        }

        const party = await ctx.database.createParty({
            channel_id: thread.id,
            guild_id: thread.guildId,
            creator_id: ctx.interaction.user.id,
            ends_at: new Date(Date.now() + (1000 * 60 * 60 * 24 * duration)),
            style: style_raw.toLowerCase(),
            width: override_width,
            height: override_height,
            award,
            recurring,
            advanced_generate_allowed: advancedGenerateAllowed,
            shared_key: shared_key_id,
            wordlist
        }).catch(console.error)

        if(!party) {
            await thread.delete()
            return ctx.error({error: "Unable to start party"})
        }

        const start = await thread.send({
            content: `<@${ctx.interaction.user.id}> started the party "${name}" with the ${Array.isArray(style) ? "category" : "style"} "${style_raw}".${override_width || override_height ? `\nResolution: ${override_width ?? "-"}x${override_height ?? "-"}` : ""}\nAdvanced generation: ${advancedGenerateAllowed ? "allowed" : "disabled"}\nYou will get ${award} kudos for ${recurring ? `every generation` : `your first generation`}.\nThe party ends <t:${Math.round((Date.now() + 1000 * 60 * 60 * 24 * duration)/1000)}:R>${wordlist.length ? `\nThe prompt has to include the words: ${wordlist.join(",")}` : ""}${pay && shared_key_id ? "\nThe party creator will pay for all generations 🥳" : ""}\n\n${ctx.client.config.party.mention_roles?.length ? ctx.client.config.party.mention_roles.map(r => `<@&${r}>`).join(" ") : ""}`,
            allowedMentions: {
                users: [ctx.interaction.user.id],
                roles: ctx.client.config.party.mention_roles
            }
        }).catch(console.error)

        await start?.pin().catch(console.error)
        await ctx.interaction.editReply({content: start?.id ? "Party started" : "Failed to announce party"})
    }

    override async autocomplete(context: AutocompleteContext): Promise<any> {
        const option = context.interaction.options.getFocused(true)
        switch(option.name) {
            case "width":
            case "height": {
                const min = context.client.config.advanced_generate?.user_restrictions?.height?.min ?? 64
                const max = context.client.config.advanced_generate?.user_restrictions?.height?.max ?? 3072
                const steps = Array.from({length: Math.floor(3072/64)}).map((_, i) => ({
                    name: `${(i+1)*64}px${(i+1)*64 > 1024 ? " (Requires Kudos upfront)" : ""}`,
                    value: (i+1)*64
                })).filter(v => v.value >= min && v.value <= max)
                const inp = context.interaction.options.getFocused(true)
                return await context.interaction.respond(steps.filter((v) => !inp.value || `${v.value}`.includes(String(inp.value))).slice(0,25))
            }
            case "style": {
                const styles = Object.keys(context.client.horde_styles)
                const categories = Object.keys(context.client.horde_style_categories)
                const available = [...styles.map(s => ({name: `Style: ${s}`, value: s})), ...categories.map(s => ({name: `Category: ${s}`, value: s}))]
                const ret = option.value ? available.filter(s => s.value.toLowerCase().includes(option.value.toLowerCase())) : available
                return await context.interaction.respond(ret.slice(0,25))
            }
        }
    }
}
