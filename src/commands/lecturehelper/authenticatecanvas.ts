import {
	ApplicationCommandOptionData,
	ApplicationCommandOptionType,
	ChatInputCommandInteraction,
	EmbedBuilder,
	ActionRowBuilder,
	StringSelectMenuBuilder,
	StringSelectMenuInteraction,
	Client,
	Interaction,
	InteractionResponse
} from 'discord.js';
import { Command } from '@lib/types/Command';
import axios from 'axios';
import { CANVAS, CANVAS_ENCRYPTION_KEY, DB, MAINTAINERS } from '@root/config';
import { SageUser } from '@lib/types/SageUser';
import crypto from 'crypto';
import { Db } from 'mongodb';

export default class extends Command {

	description = 'Authenticate your Canvas account';
	runInDM?: true;

	options: ApplicationCommandOptionData[] = [
		{
			name: 'token',
			description: 'The token you generated from Canvas',
			type: ApplicationCommandOptionType.String,
			required: true
		}
	];

	async run(interaction: ChatInputCommandInteraction): Promise<InteractionResponse<boolean> | void> {
		const discordId = interaction.user.id;
		const user: SageUser = await interaction.client.mongo.collection(DB.USERS).findOne({ discordId: discordId });

		if (!user) {
			interaction.reply(`I couldn't find you in the database, if you think this is an error please contact ${MAINTAINERS}.`);
			return;
		}
		const token = interaction.options.getString('token');
		const encryptedToken = encryptToken(token);

		if (!token || token.trim().length < 10) {
			await interaction.reply({
				content: 'The token you provided looks invalid. Please double-check and try again.',
				ephemeral: true
			});
			return;
		}
		try {
			await interaction.client.mongo.collection(DB.USERS).updateOne(
				{ discordId },
				{ $set: { canvasToken: encryptedToken } },
				{ upsert: true }
			);
		} catch (error) {
			interaction.reply({ content: 'There was an error saving your token. Please try again.', ephemeral: true });
			return;
		}
		return interaction.reply({
			content: 'Your Canvas token has been securely stored! ✅',
			ephemeral: true
		});
	}


}


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
	const user = await db.collection('users').findOne({ discordId });

	if (!user || !user.canvasToken) {
		return null;
	}

	try {
		const decrypted = decryptToken(user.canvasToken);
		return decrypted;
	} catch (error) {
		console.error('Failed to decrypt Canvas token:', error);
		return null;
	}
}
