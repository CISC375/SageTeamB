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
import { format } from 'date-fns';
import { SageUser } from '@lib/types/SageUser';

type AttendanceRecord = {
	code: string;
	professor: {
		id: string;
		username: string;
	};
	classCode: string;
	expiresAt: number;
	attendees: {
		user: {
			id: string;
			username: string;
		},
		timestamp: number
	}[];
};


export default class extends Command {

	description = 'List attendance for a class.';
	runInDM = false;
	permissions: ApplicationCommandPermissions[] = [ADMIN_PERMS, STAFF_PERMS];

	options: ApplicationCommandOptionData[] = [
		{
			name: 'start_date',
			description: 'The start date of the attendance session. (YYYY-MM-DD)',
			type: ApplicationCommandOptionType.String,
			required: false
		},
		{
			name: 'end_date',
			description: 'The end date of the attendance session. (YYYY-MM-DD)',
			type: ApplicationCommandOptionType.String,
			required: false
		},
		{
			name: 'class_code',
			description: 'The class code for the attendance session.',
			type: ApplicationCommandOptionType.String,
			required: false
		}
	];

	async run(interaction: ChatInputCommandInteraction): Promise<void> {
		// Get the user's database entry
		const user: SageUser = await interaction.client.mongo.collection(DB.USERS).findOne({ discordId: interaction.user.id });

		if (!user) {
			await interaction.reply({ content: 'You are not registered in the database. Please verify your account first.' });
			return;
		}

		if (!user.canvasToken) {
			await interaction.reply({ content: 'You need to set up your Canvas access token first. Use the `/inputtoken` command to do so.' });
			return;
		}

		const startDateStr = interaction.options.getString('start_date');
		const endDateStr = interaction.options.getString('end_date');
		const classCode = interaction.options.getString('class_code');


		const filter: Record<string, unknown> = {};

		if (startDateStr || endDateStr) {
			const expiresAt: Record<string, number> = {};

			if (startDateStr) {
				const startDate = new Date(startDateStr);
				expiresAt.$gte = startDate.getTime();
			}

			if (endDateStr) {
				const endDate = new Date(endDateStr);
				expiresAt.$lte = endDate.getTime();
			}

			filter.expiresAt = expiresAt;
		}

		if (classCode) {
			filter.classCode = classCode;
		}

		const attendanceRecords: AttendanceRecord[] = await interaction.client.mongo
			.collection(DB.ATTENDANCE)
			.find(filter)
			.sort({ expiresAt: -1 })
			.toArray();

		if (attendanceRecords.length === 0) {
			await interaction.reply({ content: 'No attendance records found.', ephemeral: true });
			return;
		}

		const rows: string[] = [];

		// CSV header
		rows.push('Class Code,Professor Username,Code,Attendee ID,Attendee Username,Timestamp');
		for (const record of attendanceRecords) {
			for (const attendee of record.attendees) {
				rows.push([
					record.classCode,
					record.professor.username,
					record.code,
					attendee.user.id,
					attendee.user.username,
					format(new Date(attendee.timestamp), 'yyyy-MM-dd HH:mm:ss') // or just attendee.timestamp
				].join(','));
			}
		}
		const csvContent = rows.join('\n');
		const attachment = Buffer.from(csvContent, 'utf8');
		interaction.reply({ files: [{ attachment, name: 'attendance.csv' }] });
	}


}

