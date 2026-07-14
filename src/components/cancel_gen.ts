import { ComponentType } from "discord.js";
import { Component } from "../classes/component";
import { ComponentContext } from "../classes/componentContext";


export default class extends Component {
    constructor() {
        super({
            name: "cancel_gen",
            staff_only: false,
            regex: /cancel_gen_.+/
        })
    }

    override async run(ctx: ComponentContext<ComponentType.SelectMenu>): Promise<any> {
        const payload = ctx.interaction.customId.slice("cancel_gen_".length)
        const ownedPayload = payload.match(/^(\d{17,20})_(.+)$/)
        const ownerId = ownedPayload?.[1] ?? ctx.interaction.message.interaction?.user.id
        const id = ownedPayload?.[2] ?? payload
        if(ownerId !== ctx.interaction.user.id) return ctx.error({error: "Only the creator of this prompt can cancel the job"})
        console.log(id)
        console.log(ctx.interaction.customId)
        const res = await ctx.ai_horde_manager.deleteImageGenerationRequest(id)
        console.log(res)
        ctx.interaction.update({
            components: [],
            content: "Generation cancelled",
            embeds: []
        })
    }
}
