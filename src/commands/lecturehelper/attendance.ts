import {
	ChatInputCommandInteraction,
	Client,
	Interaction,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
	ModalSubmitInteraction,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ApplicationCommandOptionType,
	ApplicationCommandOptionData,
	TextChannel,
	ApplicationCommandPermissions
} from 'discord.js';

import { Command } from '@lib/types/Command';
import { ADMIN_PERMS, STAFF_PERMS } from '@root/src/lib/permissions';
import { DB } from '@root/config';
import { ObjectId } from 'mongodb';

type AttendanceRecord = {
	_id: ObjectId;
	code: string;
	professor: {
		id: string;
		username: string;
	};
	expiresAt: number;
	classCode: string;
	attendees: {
		user: {
			id: string;
			username: string;
		},
		timestamp: number
	}[];
};

let initialized = false;

export default class extends Command {

	description = 'Start an attendance session';
	runInDM = false;
	permissions: ApplicationCommandPermissions[] = [ADMIN_PERMS, STAFF_PERMS];

	options: ApplicationCommandOptionData[] = [
		{
			name: 'duration',
			description: 'Duration of the attendance session in seconds (default 600)',
			type: ApplicationCommandOptionType.Integer,
			required: false
		},
		{
			name: 'class_code',
			description: 'Class code for the attendance session',
			type: ApplicationCommandOptionType.String,
			required: false
		}
	];

	async run(interaction: ChatInputCommandInteraction): Promise<void> {
		const code = generateCode();
		const duration = interaction.options.getInteger('duration') ?? 600;
		const expiresAt = Date.now() + (duration * 1000);

		const result = await interaction.client.mongo.collection<AttendanceRecord>(DB.ATTENDANCE).insertOne({
			code,
			professor: {
				id: interaction.user.id,
				username: interaction.user.username
			},
			classCode: interaction.options.getString('class_code') ?? '',
			expiresAt,
			attendees: []
		});
		const entryId = result.insertedId;

		setupAttendanceHandler(interaction.client);

		await interaction.reply({
			content: `✅ Attendance session started!\n**Code:** \`${code}\`\nDuration: ${duration} seconds.\nStudents may now mark themselves present using the "here" button.`,
			ephemeral: true
		});

		const hereButton = new ButtonBuilder()
			.setCustomId('here_button')
			.setLabel('Here')
			.setStyle(ButtonStyle.Primary);

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(hereButton);

		const countdownMessage = await interaction.channel?.send({
			content: `📢 Students: Click the button below to mark yourself present!\n⏳ Time remaining: ${formatDuration(duration)}`,
			components: [row]
		});

		if (!countdownMessage) return;

		const interval = setInterval(async () => {
			const remainingSeconds = Math.floor((expiresAt - Date.now()) / 1000);
			if (remainingSeconds <= 0) {
				clearInterval(interval);
				return;
			}

			await countdownMessage.edit({
				content: `📢 Students: Click the button below to mark yourself present!\n⏳ Time remaining: ${formatDuration(remainingSeconds)}`,
				components: [row]
			});
		}, 1000);

		setTimeout(async () => {
			const session = await interaction.client.mongo.collection<AttendanceRecord>(DB.ATTENDANCE).findOne(
				{ _id: entryId }
			);
			if (!session) return;

			clearInterval(interval);

			const disabledButton = ButtonBuilder.from(hereButton).setDisabled(true);
			const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(disabledButton);

			await countdownMessage.edit({
				content: '⏰ Attendance session has ended.',
				components: [disabledRow]
			});

			// Log attendees
			const attendeeList
				= session.attendees.length > 0
					? session.attendees
						.map((a) => `- ${a.user.username} (<@${a.user.id}>) at ${new Date(a.timestamp).toLocaleTimeString()}`)
						.join('\n')
					: 'No one marked themselves present.';

			const channel = interaction.channel as TextChannel;
			await channel.send(`📝 Attendance has ended. Here are the students who marked themselves present:\n${attendeeList}`);
		}, duration * 1000);
	}

}

function setupAttendanceHandler(client: Client) {
	if (initialized) return;
	initialized = true;

	client.on('interactionCreate', async (interaction: Interaction) => {
		if (interaction.isButton() && interaction.customId === 'here_button') {
			const session = await client.mongo.collection<AttendanceRecord>(DB.ATTENDANCE).findOne({
				expiresAt: { $gt: Date.now() },
				classCode: { $exists: true }
			});

			if (!session) {
				await interaction.reply({ content: '⏰ Attendance session has ended or does not exist.', ephemeral: true });
				return;
			}

			const modal = new ModalBuilder()
				.setCustomId('attendence_checkin_modal')
				.setTitle('Mark Yourself Present');

			const codeInput = new TextInputBuilder()
				.setCustomId('checkin_code')
				.setLabel('Enter Attendance Code')
				.setStyle(TextInputStyle.Short)
				.setPlaceholder('e.g., 49372')
				.setRequired(true);

			const row = new ActionRowBuilder<TextInputBuilder>().addComponents(codeInput);
			modal.addComponents(row);

			await interaction.showModal(modal);
		}

		if (interaction.isModalSubmit() && interaction.customId === 'attendence_checkin_modal') {
			// Find latest active session
			const session = await client.mongo.collection<AttendanceRecord>(DB.ATTENDANCE).findOne({
				expiresAt: { $gt: Date.now() },
				classCode: { $exists: true }
			});
			if (!session) {
				await interaction.reply({ content: '❌ Session expired.', ephemeral: true });
				return;
			}
			await handleStudentCheckIn(interaction, session._id);
		}
	});
}

async function handleStudentCheckIn(interaction: ModalSubmitInteraction, entryId: ObjectId) {
	const submittedCode = interaction.fields.getTextInputValue('checkin_code');
	const session = await interaction.client.mongo.collection<AttendanceRecord>(DB.ATTENDANCE).findOne(
		{ _id: entryId }
	);

	await interaction.deferReply({ ephemeral: true });

	if (!session || Date.now() > session.expiresAt) {
		await interaction.editReply({ content: '❌ Attendance session has ended.' });
		return;
	}

	const { code, professor, attendees } = session;

	if (submittedCode !== code) {
		await interaction.editReply({ content: '❌ Incorrect code. Try again!' });
		return;
	}

	// Check for duplicates
	const alreadyMarked = attendees.some((a) => a.user.id === interaction.user.id);
	if (alreadyMarked) {
		await interaction.editReply({ content: '✅ You already marked yourself present!' });
		return;
	}

	attendees.push({
		user: {
			id: interaction.user.id,
			username: interaction.user.username
		}, timestamp: Date.now()
	});
	await interaction.client.mongo.collection<AttendanceRecord>(DB.ATTENDANCE).updateOne(
		{ _id: entryId },
		{ $set: { attendees } }
	);

	await interaction.editReply({ content: '✅ You have been marked present!' });

	const professorUser = await interaction.client.users.fetch(professor.id);
	await professorUser.send(
		`📋 **${interaction.user.tag}** marked present in <#${interaction.channelId}> at ${new Date().toLocaleTimeString()}.`
	);
}

function generateCode(): string {
	return Math.floor(10000 + (Math.random() * 90000)).toString();
}

function formatDuration(seconds: number): string {
	const mins = Math.floor(seconds / 60);
	const secs = seconds % 60;
	return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
