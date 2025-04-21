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
	User,
	ApplicationCommandOptionType,
	ApplicationCommandOptionData,
	TextChannel,
	ApplicationCommandPermissions,
} from 'discord.js';

import { Command } from '@lib/types/Command';
import { ADMIN_PERMS, STAFF_PERMS } from '@root/src/lib/permissions';

type AttendanceRecord = {
	code: string;
	professor: User;
	expiresAt: number;
	attendees: { user: User; timestamp: number }[];
};

const activeAttendanceSessions = new Map<string, AttendanceRecord>();
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
			required: false,
		},
	];

	async run(interaction: ChatInputCommandInteraction): Promise<void> {
		setupAttendanceHandler(interaction.client);

		const code = generateCode();
		const duration = interaction.options.getInteger('duration') ?? 600;
		const expiresAt = Date.now() + duration * 1000;

		activeAttendanceSessions.set(interaction.channelId, {
			code,
			professor: interaction.user,
			expiresAt,
			attendees: [],
		});

		await interaction.reply({
			content: `✅ Attendance session started!\n**Code:** \`${code}\`\nDuration: ${duration} seconds.\nStudents may now mark themselves present using \`/here\` or the button.`,
			ephemeral: true,
		});

		const hereButton = new ButtonBuilder()
			.setCustomId('here_button')
			.setLabel('Here')
			.setStyle(ButtonStyle.Primary);

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(hereButton);

		const countdownMessage = await interaction.channel?.send({
			content: `📢 Students: Click the button below to mark yourself present!\n⏳ Time remaining: ${formatDuration(duration)}`,
			components: [row],
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
				components: [row],
			});
		}, 1000);

		setTimeout(async () => {
			const session = activeAttendanceSessions.get(interaction.channelId);
			if (!session) return;

			activeAttendanceSessions.delete(interaction.channelId);
			clearInterval(interval);

			const disabledButton = ButtonBuilder.from(hereButton).setDisabled(true);
			const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(disabledButton);

			await countdownMessage.edit({
				content: '⏰ Attendance session has ended.',
				components: [disabledRow],
			});

			// Log attendees
			const attendeeList =
				session.attendees.length > 0
					? session.attendees
							.map((a) => `- ${a.user.tag} (<@${a.user.id}>) at ${new Date(a.timestamp).toLocaleTimeString()}`)
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
			const session = activeAttendanceSessions.get(interaction.channelId);
			if (!session || Date.now() > session.expiresAt) {
				await interaction.reply({ content: '⏰ Attendance session has ended.', ephemeral: true });
				return;
			}

			const modal = new ModalBuilder()
				.setCustomId('attendence_checkin_modal')
				.setTitle('Mark Yourself Presen');

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
			await handleStudentCheckIn(interaction);
		}
	});
}

async function handleStudentCheckIn(interaction: ModalSubmitInteraction) {
	const submittedCode = interaction.fields.getTextInputValue('checkin_code');
	const session = activeAttendanceSessions.get(interaction.channelId);

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

	attendees.push({ user: interaction.user, timestamp: Date.now() });

	await interaction.editReply({ content: '✅ You have been marked present!' });

	await professor.send(
		`📋 **${interaction.user.tag}** marked present in <#${interaction.channelId}> at ${new Date().toLocaleTimeString()}.`
	);
}

function generateCode(): string {
	return Math.floor(10000 + Math.random() * 90000).toString();
}

function formatDuration(seconds: number): string {
	const mins = Math.floor(seconds / 60);
	const secs = seconds % 60;
	return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
