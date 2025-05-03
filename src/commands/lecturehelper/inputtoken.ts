import {
    ChatInputCommandInteraction,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ModalSubmitInteraction,
    ActionRowBuilder as ModalRowBuilder,
    Interaction
} from 'discord.js';
import { Command } from '@lib/types/Command';
import { DB } from '@root/config';
import { SageUser } from '@lib/types/SageUser';

export default class extends Command {
    description = 'Input your Canvas access token for use with the missinglecture command';
    runInDM = true;

    async run(interaction: ChatInputCommandInteraction): Promise<void> {
        // Create a modal for token input
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

        // Set up handler for modal submission
        interaction.client.once('interactionCreate', async (modalInteraction: Interaction) => {
            if (!modalInteraction.isModalSubmit() || modalInteraction.customId !== 'canvas_token_modal') return;

            const token = modalInteraction.fields.getTextInputValue('token_input');

            try {
                // Get the user's database entry
                const user: SageUser = await interaction.client.mongo.collection(DB.USERS).findOne({ discordId: interaction.user.id });

                if (!user) {
                    await modalInteraction.reply({ content: 'You are not registered in the database. Please verify your account first.', ephemeral: true });
                    return;
                }

                // Update the user's database entry with the Canvas token
                await interaction.client.mongo.collection(DB.USERS).updateOne(
                    { discordId: interaction.user.id },
                    { $set: { canvasToken: token } }
                );

                await modalInteraction.reply({ content: 'Your Canvas access token has been stored successfully! You can now use the missinglecture command.', ephemeral: true });
            } catch (error) {
                console.error('Error storing Canvas token:', error);
                await modalInteraction.reply({ content: 'An error occurred while storing your token. Please try again later.', ephemeral: true });
            }
        });
    }
} 