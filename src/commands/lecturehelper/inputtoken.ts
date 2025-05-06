import {
    ChatInputCommandInteraction,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ModalSubmitInteraction,
    ActionRowBuilder as ModalRowBuilder,
    Interaction,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    ButtonInteraction,
    ActionRowBuilder,
    AttachmentBuilder
} from 'discord.js';
import { Command } from '@lib/types/Command';
import { DB } from '@root/config';
import { SageUser } from '@lib/types/SageUser';
import axios from 'axios';
import { CANVAS } from '../../../config';
import { readFileSync } from 'fs';
import path from 'path';

export default class extends Command {
    description = 'Input your Canvas access token for use with the LectureHelper commands';
    runInDM = true;

    async run(interaction: ChatInputCommandInteraction): Promise<void> {
        // Create the instructional embed
        const instructionEmbed = new EmbedBuilder()
            .setColor('#3CD6A3')
            .setDescription(
                'Input your Canvas access token for use with the LectureHelper commands.\n\n' +
                'Click the "Token Setup Instructions" button below to view instructions on how to obtain your Canvas Access Token.'
            );

        // Create the buttons
        const inputButton = new ButtonBuilder()
            .setCustomId('canvas_token_input_button')
            .setLabel('🗳️ Input Token')
            .setStyle(ButtonStyle.Primary);

        const downloadButton = new ButtonBuilder()
            .setCustomId('download_instructions_button')
            .setLabel('📄 Token Setup Instructions')
            .setStyle(ButtonStyle.Secondary);

        const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(inputButton, downloadButton);

        // Send the initial reply with the embed and buttons
        await interaction.reply({
            embeds: [instructionEmbed],
            components: [buttonRow],
            /* ephemeral: true */
        });

        // Set up interaction handler for buttons using a collector
        const filter = (i: Interaction) => i.isButton() && 
            (i.customId === 'canvas_token_input_button' || i.customId === 'download_instructions_button') && 
            i.user.id === interaction.user.id;
        const collector = interaction.channel.createMessageComponentCollector({ filter, time: 600000 }); // 10 minutes

        collector.on('collect', async (buttonInteraction: ButtonInteraction) => {
            if (buttonInteraction.customId === 'download_instructions_button') {
                // Load the image file
                const imagePath = path.resolve('src/commands/lecturehelper/TokenInstructions.png');
                const imageBuffer = readFileSync(imagePath);
                const attachment = new AttachmentBuilder(imageBuffer, { name: 'TokenInstructions.png' });

                // Send the image as an attachment for download
                await buttonInteraction.reply({
                    content: 'Here are the instructions for obtaining your Canvas access token.',
                    files: [attachment],
                    /* ephemeral: true */
                });
            } else if (buttonInteraction.customId === 'canvas_token_input_button') {
                // Create the modal
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

                // Show the modal
                await buttonInteraction.showModal(modal);

                // Set up interaction handler for the modal submission
                buttonInteraction.client.once('interactionCreate', async (modalInteraction: Interaction) => {
                    if (!modalInteraction.isModalSubmit() || modalInteraction.customId !== 'canvas_token_modal') return;

                    const token = modalInteraction.fields.getTextInputValue('token_input').trim();

                    try {
                        const user: SageUser = await buttonInteraction.client.mongo.collection(DB.USERS).findOne({ discordId: buttonInteraction.user.id });

                        if (!user) {
                            await modalInteraction.reply({
                                content: 'You are not registered in the database. Please verify your account first.',
                                ephemeral: true
                            });
                            return;
                        }

                        await buttonInteraction.client.mongo.collection(DB.USERS).updateOne(
                            { discordId: buttonInteraction.user.id },
                            { $set: { canvasToken: token } }
                        );

                        // Validate the token
                        const isValidToken = await validateCanvasToken(token);

                        if (isValidToken) {
                            const embed = new EmbedBuilder()
                                .setColor('#3CD6A3')
                                .setTitle('Your Canvas access token has been stored successfully!')
                                .setDescription(
                                    'You can now use the following commands:\n\n' +
                                    '🙋 `/attendance` - Start an attendance session.\n' +
                                    '📝 `/homework` - Fetch upcoming assignments from a Canvas course.\n' +
                                    '📋 `/listattendance` - List attendance for a class.\n' +
                                    '📚 `/missinglecture` - Retrieve notes, recordings, and homework related to a missed lecture date.\n' +
                                    '📒 `/notes` - Fetch the latest file from a Canvas course.'
                                );

                            await modalInteraction.reply({ embeds: [embed] });
                        } else {
                            const errorEmbed = new EmbedBuilder()
                                .setColor('#ff0000')
                                .setTitle('Invalid input')
                                .setDescription('You have not inputted a valid Canvas token, please try again.');

                            await modalInteraction.reply({ embeds: [errorEmbed] });
                        }
                    } catch (error) {
                        console.error('Error storing Canvas token:', error);
                        await modalInteraction.reply({
                            content: 'An error occurred while storing your token. Please try again later.',
                            ephemeral: true
                        });
                    }
                });
            }
        });

        collector.on('end', async () => {
            // Disable the buttons after the collector expires
            inputButton.setDisabled(true);
            downloadButton.setDisabled(true);
            await interaction.editReply({ components: [buttonRow] });
        });
    }
}

async function validateCanvasToken(token: string): Promise<boolean> {
    try {
        const response = await axios.get(`${CANVAS.BASE_URL}/courses`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        return response.status === 200;
    } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 401) {
            return false; // Unauthorized, invalid token
        }
        console.error('Error validating Canvas token:', error);
        return false;
    }
}