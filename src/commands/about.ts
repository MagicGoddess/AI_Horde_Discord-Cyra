import { Colors, EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { Command } from "../classes/command";
import { CommandContext } from "../classes/commandContext";

const command_data = new SlashCommandBuilder()
    .setName("about")
    .setDMPermission(false)
    .setDescription(`Shows information about this bot`)

export default class extends Command {
    constructor() {
        super({
            name: "about",
            command_data: command_data.toJSON(),
            staff_only: false,
        })
    }

    override async run(ctx: CommandContext): Promise<any> {
        const counts = await ctx.database?.getCounts().catch(console.error)

        const embed = new EmbedBuilder({
            color: Colors.Blue,
            title: "Unofficial AI Horde Discord Bot",
            description: `This Discord Bot was originally made by Zelda_Fan#0225 and this fork is maintained by MagicGoddess with <3\nYou can [view the code on GitHub](https://github.com/MagicGoddess/AI_Horde_Discord-Cyra) **but there is no guarantee that this instance is unmodified**.\nIf you find any bugs you can [report them on GitHub](https://github.com/MagicGoddess/AI_Horde_Discord-Cyra/issues).\n\n**Bot Version** \`${ctx.client.bot_version}\`\n**Package Version** \`${ctx.ai_horde_manager.VERSION}\`\n\nThis bot currently is in ${ctx.client.guilds.cache.size} servers${counts ? `\nThere are \`${counts.user_tokens}\` users logged in, \`${counts.parties}\` parties, \`${counts.lora_presets}\` LoRA presets and \`${counts.pending_kudos}\` pending kudos gifts.` : ""}`
        })
        return ctx.interaction.reply({
            embeds: [embed],
            ephemeral: true
        })
    }
}
