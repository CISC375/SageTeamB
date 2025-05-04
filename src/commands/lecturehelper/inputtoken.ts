import {
    ChatInputCommandInteraction,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ModalSubmitInteraction,
    ActionRowBuilder as ModalRowBuilder,
    Interaction,
    EmbedBuilder
} from 'discord.js';
import { Command } from '@lib/types/Command';
import { DB } from '@root/config';
import { SageUser } from '@lib/types/SageUser';

export default class extends Command {
    description = 'Input your Canvas access token for use with the missinglecture command';
    runInDM = true;

    async run(interaction: ChatInputCommandInteraction): Promise<void> {
        const modal = new ModalBuilder()
            .setCustomId('canvas_token_modal')
            .setTitle('Canvas Access Token');

        const tokenInput = new TextInputBuilder()
            .setCustomId('token_input')
            .setLabel('Enter your Canvas access token')
            .setPlaceholder('Paste your Canvas access token here')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const firstActionRow = new ModalRowBuilder<TextInputBuilder>().addComponents(tokenInput);
        modal.addComponents(firstActionRow);

        await interaction.showModal(modal);

        interaction.client.once('interactionCreate', async (modalInteraction: Interaction) => {
            if (!modalInteraction.isModalSubmit() || modalInteraction.customId !== 'canvas_token_modal') return;

            const token = modalInteraction.fields.getTextInputValue('token_input');

            try {
                const user: SageUser = await interaction.client.mongo.collection(DB.USERS).findOne({ discordId: interaction.user.id });

                if (!user) {
                    await modalInteraction.reply({
                        content: 'You are not registered in the database. Please verify your account first.',
                        ephemeral: true
                    });
                    return;
                }

                await interaction.client.mongo.collection(DB.USERS).updateOne(
                    { discordId: interaction.user.id },
                    { $set: { canvasToken: token } }
                );

                const embed = new EmbedBuilder()
                    .setColor(0x00b0f4)
                    .setTitle('Your Canvas access token has been stored successfully!')
                    .setDescription(
                        'You can now use the following commands:\n\n' +
                        '🙋 `/attendance` - Start an attendance session.\n' +
                        '📝 `/homework` - Fetch upcoming assignments from a Canvas course.\n' +
                        '📋 `/listattendance` - List attendance for a class.\n' +
                        '📚 `/missinglecture` - Retrieve notes, recordings, and homework related to a missed lecture date.\n' +
                        '📒 `/notes` - Fetch the latest file from a Canvas course.'
                    )

                await modalInteraction.reply({ embeds: [embed] });
            } catch (error) {
                console.error('Error storing Canvas token:', error);
                await modalInteraction.reply({
                    content: 'An error occurred while storing your token. Please try again later.',
                    ephemeral: true
                });
            }
        });
    }
}
