import { Modal } from "../classes/modal";
import { ModalContext } from "../classes/modalContext";
import {
    applyAdvancedGenerationStrengthOverrides,
    takeAdvancedGenerationAdjustmentSession
} from "../advancedGenerationAdjustments";
import { executeAdvancedGeneration } from "../commands/advanced_generate";

export default class extends Modal {
    constructor() {
        super({name: "advanced_generate_lora_strengths", regex: /^advanced_lora_strengths_/, staff_only: false});
    }

    override async run(ctx: ModalContext): Promise<any> {
        const match = ctx.interaction.customId.match(/^advanced_lora_strengths_([0-9a-f-]{36})$/i);
        if(!match) return;
        const session = takeAdvancedGenerationAdjustmentSession(match[1]!, ctx.interaction.user.id);
        if(!session) return ctx.error({error: "This strength adjustment expired or does not belong to you. Run advanced_generate again.", codeblock: false});

        const result = applyAdvancedGenerationStrengthOverrides(
            session,
            customId => ctx.interaction.fields.getTextInputValue(customId)
        );
        if(result.error) return ctx.error({error: result.error, codeblock: false});

        await ctx.interaction.deferReply({});
        return executeAdvancedGeneration(ctx, session.options, result.preset);
    }
}
