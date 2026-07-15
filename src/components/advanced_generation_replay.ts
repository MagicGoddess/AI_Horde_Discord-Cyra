import { ComponentType } from "discord.js";
import { buildAdvancedGenerationStrengthModal, createAdvancedGenerationAdjustmentSession } from "../advancedGenerationAdjustments";
import { getAdvancedGenerationReplay, hydrateReplayOptions, REPLAY_SOURCE_FILENAME } from "../advancedGenerationReplays";
import { getAdvancedGenerationRestrictionError } from "../advancedGenerationRestrictions";
import { Component } from "../classes/component";
import { ComponentContext } from "../classes/componentContext";
import { executeAdvancedGeneration } from "../commands/advanced_generate";

export default class extends Component {
    constructor() {
        super({name: "advanced_generation_replay", regex: /^advanced_replay_/, staff_only: false});
    }

    override async run(ctx: ComponentContext<ComponentType.Button>): Promise<any> {
        if(!ctx.interaction.isButton()) return;
        if(!ctx.client.config.advanced_generate?.enabled) return ctx.error({error: "Advanced generation is disabled.", codeblock: false});
        if(ctx.client.config.advanced_generate?.replay_controls?.enabled === false) return ctx.error({error: "Generation replay controls are disabled.", codeblock: false});

        const match = ctx.interaction.customId.match(/^advanced_replay_(reroll|tweak)_([0-9a-f-]{36})$/i);
        if(!match) return;
        const action = match[1]!;
        const replay = await getAdvancedGenerationReplay(ctx.database, match[2]!);
        if(!replay) return ctx.error({error: "This generation setup expired. Run advanced_generate again.", codeblock: false});

        const sourceImage = replay.has_source_image
            ? ctx.interaction.message.attachments.find(attachment => attachment.name === REPLAY_SOURCE_FILENAME) ?? null
            : null;
        if(replay.has_source_image && !sourceImage) {
            return ctx.error({error: "The original source image is no longer available on this result, so it cannot be replayed.", codeblock: false});
        }

        const options = hydrateReplayOptions(replay, sourceImage);
        if(action === "reroll") options.seed = null;
        const restrictionError = getAdvancedGenerationRestrictionError(ctx.client.config, options);
        if(restrictionError) return ctx.error({error: restrictionError, codeblock: false});
        if(action === "tweak") {
            if(!replay.preset) return ctx.error({error: "This generation did not use a personal LoRA preset.", codeblock: false});
            const session = createAdvancedGenerationAdjustmentSession(ctx.interaction.user.id, options, replay.preset);
            return ctx.interaction.showModal(buildAdvancedGenerationStrengthModal(session));
        }

        await ctx.interaction.deferReply({});
        return executeAdvancedGeneration(ctx, options, replay.preset);
    }
}
