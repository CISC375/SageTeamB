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
import { CANVAS, CANVAS_ENCRYPTION_KEY, DB, MAINTAINERS } from '@root/config';
import { SageUser } from '@lib/types/SageUser';
import axios from 'axios';
import crypto from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';
import { Db } from 'mongodb';

export default class extends Command {
	description = 'Authenticate your Canvas account';
	runInDM = true;

	async run(interaction: ChatInputCommandInteraction): Promise<void> {
		const instructionEmbed = new EmbedBuilder()
			.setColor('#3CD6A3')
			.setDescription(
				'Input your Canvas access token for use with the LectureHelper commands.\n\n' +
				'Click the "Token Setup Instructions" button below to view instructions on how to obtain your Canvas Access Token.'
			);

		const inputButton = new ButtonBuilder()
			.setCustomId('canvas_token_input_button')
			.setLabel('🗳️ Input Token')
			.setStyle(ButtonStyle.Primary);

		const downloadButton = new ButtonBuilder()
			.setCustomId('download_instructions_button')
			.setLabel('📄 Token Setup Instructions')
			.setStyle(ButtonStyle.Secondary);

		const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(inputButton, downloadButton);

		await interaction.reply({
			embeds: [instructionEmbed],
			components: [buttonRow]
		});

		const buttonFilter = (i: Interaction) =>
			i.isButton() &&
			(i.customId === 'canvas_token_input_button' || i.customId === 'download_instructions_button') &&
			i.user.id === interaction.user.id;

		const buttonCollector = interaction.channel!.createMessageComponentCollector({ filter: buttonFilter, time: 600_000 });

		buttonCollector.on('collect', async (buttonInteraction: ButtonInteraction) => {
			if (buttonInteraction.customId === 'download_instructions_button') {
				const imagePath = path.resolve('src/commands/lecturehelper/TokenInstructions.png');
				const imageBuffer = readFileSync(imagePath);
				const attachment = new AttachmentBuilder(imageBuffer, { name: 'TokenInstructions.png' });

				await buttonInteraction.reply({
					content: 'Here are the instructions for obtaining your Canvas Access Token.',
					files: [attachment],
					ephemeral: true
				});
			} else if (buttonInteraction.customId === 'canvas_token_input_button') {
				const modal = new ModalBuilder().setCustomId('canvas_token_modal').setTitle('Canvas Access Token');

				const tokenInput = new TextInputBuilder()
					.setCustomId('token_input')
					.setLabel('Enter your Canvas access token')
					.setPlaceholder('Paste your Canvas access token here')
					.setStyle(TextInputStyle.Short)
					.setRequired(true);

				const firstActionRow = new ModalRowBuilder<TextInputBuilder>().addComponents(tokenInput);
				modal.addComponents(firstActionRow);

				await buttonInteraction.showModal(modal);

				const modalFilter = (i: Interaction) =>
					i.isModalSubmit() &&
					i.customId === 'canvas_token_modal' &&
					i.user.id === buttonInteraction.user.id;

				try {
					const modalInteraction = await buttonInteraction.awaitModalSubmit({ filter: modalFilter, time: 120_000 });

					const token = modalInteraction.fields.getTextInputValue('token_input').trim();

					if (!token || token.length < 10) {
						await modalInteraction.reply({
							content: 'The token you provided looks invalid. Please double-check and try again.',
							ephemeral: true
						});
						return;
					}

					const user: SageUser = await modalInteraction.client.mongo
						.collection(DB.USERS)
						.findOne({ discordId: modalInteraction.user.id });

					if (!user) {
						await modalInteraction.reply({
							content: `You are not registered in the database. Please contact ${MAINTAINERS}.`,
							ephemeral: true
						});
						return;
					}

					const encryptedToken = encryptToken(token);

					await modalInteraction.client.mongo.collection(DB.USERS).updateOne(
						{ discordId: modalInteraction.user.id },
						{ $set: { canvasToken: encryptedToken } },
						{ upsert: true }
					);

					const isValidToken = await validateCanvasToken(token);

					if (isValidToken) {
						const embed = new EmbedBuilder()
							.setColor('#3CD6A3')
							.setTitle('Your Canvas access token has been stored successfully! ✅')
							.setDescription(
								'You can now use the following commands:\n\n' +
								'📝 `/homework` - Fetch upcoming assignments.\n' +
								'📚 `/missinglecture` - Retrieve resources for a missed lecture.\n' +
								'📒 `/notes` - Fetch the latest course file.'
							);
						await modalInteraction.reply({ embeds: [embed] });

						// Optionally disable buttons after success
						inputButton.setDisabled(true);
						downloadButton.setDisabled(true);
						await interaction.editReply({ components: [buttonRow] });

						buttonCollector.stop(); // Prevent further interactions
					} else {
						const errorEmbed = new EmbedBuilder()
							.setColor('#ff0000')
							.setTitle('Invalid Token')
							.setDescription('The token appears to be invalid. Please try again.');
						await modalInteraction.reply({ embeds: [errorEmbed] });
					}
				} catch (err) {
					console.error('Modal submit timeout or error:', err);
					await buttonInteraction.followUp({
						content: 'You took too long to submit the token. Please try again.',
						ephemeral: true
					});
				}
			}
		});

		buttonCollector.on('end', async () => {
			inputButton.setDisabled(true);
			downloadButton.setDisabled(true);
			await interaction.editReply({ components: [buttonRow] });
		});
	}
}

// --- Helper Functions ---

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;
const ENCRYPTION_KEY = CANVAS_ENCRYPTION_KEY;

export function encryptToken(token: string): string {
	const iv = crypto.randomBytes(IV_LENGTH);
	const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
	let encrypted = cipher.update(token, 'utf8', 'hex');
	encrypted += cipher.final('hex');
	return `${iv.toString('hex')}:${encrypted}`;
}

export function decryptToken(encrypted: string): string {
	const [ivHex, encryptedToken] = encrypted.split(':');
	const iv = Buffer.from(ivHex, 'hex');
	const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
	let decrypted = decipher.update(encryptedToken, 'hex', 'utf8');
	decrypted += decipher.final('utf8');
	return decrypted;
}

export async function getUserCanvasToken(db: Db, discordId: string): Promise<string | null> {
	const user = await db.collection(DB.USERS).findOne({ discordId });
	if (!user || !user.canvasToken) return null;

	try {
		return decryptToken(user.canvasToken);
	} catch (error) {
		console.error('Failed to decrypt Canvas token:', error);
		return null;
	}
}

async function validateCanvasToken(token: string): Promise<boolean> {
	try {
		const response = await axios.get(`${CANVAS.BASE_URL}/courses`, {
			headers: { Authorization: `Bearer ${token}` }
		});
		return Array.isArray(response.data);
	} catch (error) {
		return false;
	}
}
