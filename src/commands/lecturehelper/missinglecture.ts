import {
	ApplicationCommandOptionData,
	ApplicationCommandOptionType,
	ChatInputCommandInteraction,
	EmbedBuilder,
	ActionRowBuilder,
	StringSelectMenuBuilder,
	StringSelectMenuInteraction,
	Client,
	Interaction
} from 'discord.js';
import { Command } from '@lib/types/Command';
import axios from 'axios';
import { CANVAS } from '@root/config';
import { getUserCanvasToken } from './authenticatecanvas';

export default class extends Command {

	description = 'Retrieve notes, recordings, and homework related to a missed lecture date';
	runInDM?: true;

	options: ApplicationCommandOptionData[] = [
		{
			name: 'date',
			description: 'Date of the missed lecture (YYYY-MM-DD)',
			type: ApplicationCommandOptionType.String,
			required: true
		}
	];

	async run(interaction: ChatInputCommandInteraction): Promise<void> {
		const canvasToken = await getUserCanvasToken(interaction.client.mongo, interaction.user.id);
		if (!canvasToken) {
			await interaction.reply({ content: 'You need to authenticate your Canvas account first.', ephemeral: true });
			return;
		}
		const baseUrl = `${CANVAS.BASE_URL}/courses?page=1&per_page=100`;
		const missedDateString = interaction.options.getString('date', true);

		let missedDate: Date;
		try {
			missedDate = new Date(missedDateString);
			if (isNaN(missedDate.getTime())) throw new Error();
		} catch {
			await interaction.reply({ content: 'Invalid date format. Please use YYYY-MM-DD.', ephemeral: true });
			return;
		}

		await interaction.deferReply();

		try {
			const response = await axios.get(baseUrl, {
				headers: { Authorization: `Bearer ${canvasToken}` }
			});

			const allCourses = response.data;
			const validCourses = [];

			for (const course of allCourses) {
				try {
					await axios.get(`${CANVAS.BASE_URL}/courses/${course.id}/enrollments`, {
						headers: { Authorization: `Bearer ${canvasToken}` }
					});
					validCourses.push({ id: course.id, name: course.name });
				} catch (error) {
					if (error.response?.status !== 403) {
						console.error(`Error with course ${course.id}:`, error.message);
					}
				}
			}

			if (validCourses.length === 0) {
				await interaction.editReply({ content: `No active courses found.` });
				return;
			}

			const courseOptions = validCourses.map(course => ({
				label: course.name,
				value: `${course.id}::${missedDateString}`
			}));

			const selectMenu = new StringSelectMenuBuilder()
				.setCustomId('missinglecture_select')
				.setPlaceholder('Select a course')
				.addOptions(courseOptions);

			const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
			await interaction.editReply({ content: 'Select a course:', components: [row] });

			setupMissingLectureHandler(interaction.client, canvasToken);
		} catch (error) {
			console.error('Error fetching courses:', error.response ? error.response.data : error.message);
			await interaction.editReply({ content: 'Failed to fetch courses.' });
		}
	}

}

export function setupMissingLectureHandler(client: Client, canvasToken: string) {
	client.on('interactionCreate', async (interaction: Interaction) => {
		if (!interaction.isStringSelectMenu() || interaction.customId !== 'missinglecture_select') return;

		const [courseId, dateStr] = interaction.values[0].split('::');

		const lectureDate = new Date(dateStr);
		const weekStart = new Date(lectureDate);
		weekStart.setDate(weekStart.getDate() - weekStart.getDay());
		weekStart.setHours(0, 0, 0, 0);

		const weekEnd = new Date(weekStart);
		weekEnd.setDate(weekStart.getDate() + 6);
		weekEnd.setHours(23, 59, 59, 999);

		await interaction.deferReply();

		try {
			// Fetch all folders
			const folders = await getAllFolders(courseId, canvasToken);

			const matchedFiles = [];

			for (const folder of folders) {
				const filesUrl = `${CANVAS.BASE_URL}/folders/${folder.id}/files`;
				try {
					const filesResponse = await axios.get(filesUrl, {
						headers: { Authorization: `Bearer ${canvasToken}` }
					});
					const files = filesResponse.data;
					const filtered = files.filter(file => {
						const fileDate = new Date(file.created_at);
						return fileDate >= weekStart && fileDate <= weekEnd;
					});
					matchedFiles.push(...filtered);
				} catch (error) {
					console.warn(`Skipped folder ${folder.name}`, error.message);
				}
			}

			matchedFiles.sort((a, b) => a.display_name.localeCompare(b.display_name));

			const notes = matchedFiles.filter(file => file.display_name.toLowerCase().includes('note'));
			const recordings = matchedFiles.filter(file => /zoom|recording|video/i.test(file.display_name));
			const homework = matchedFiles.filter(file =>
				/hw|homework|assignment/i.test(file.display_name.toLowerCase())
			);

			const formatList = (arr: any[]) =>
				arr
					.map((file, i) =>
						`(${i + 1} of ${arr.length}) ${getFileIcon(file.display_name)} [${file.display_name}](${file.url}) (${formatFileSize(file.size)})`
					)
					.join('\n') || 'None found';

			// Fetch weekly assignments
			const assignmentsRes = await axios.get(`${CANVAS.BASE_URL}/courses/${courseId}/assignments`, {
				headers: { Authorization: `Bearer ${canvasToken}` }
			});
			const assignments = assignmentsRes.data.filter((a: any) => a.due_at || a.created_at);

			const weeklyAssignments = assignments.filter((a: any) => {
				// Check if assignment is due during the week
				const dueDate = a.due_at ? new Date(a.due_at) : null;
				const isDueThisWeek = dueDate && dueDate >= weekStart && dueDate <= weekEnd;

				// Check if assignment was created during the week
				const createdDate = a.created_at ? new Date(a.created_at) : null;
				const isCreatedThisWeek = createdDate && createdDate >= weekStart && createdDate <= weekEnd;

				// Include if either due or created during the week
				return isDueThisWeek || isCreatedThisWeek;
			});

			let assignmentList = 'None found';
			if (weeklyAssignments.length > 0) {
				assignmentList = weeklyAssignments
					.map(
						(a, i) =>
							`(${i + 1} of ${weeklyAssignments.length}) 🔗 [${a.name}](${a.html_url}) (Due: <t:${Math.floor(
								new Date(a.due_at).getTime() / 1000
							)}:F>)`
					)
					.join('\n');
			}

			// Final embed
			const embed = new EmbedBuilder()
				.setTitle(`Assignments & Files for the week of ${dateStr}:`)
				.setColor('#3498db')
				.addFields(
					{ name: '📌 Assignments Due This Week:', value: assignmentList },
					{ name: '📝 Notes:', value: formatList(notes) },
					{ name: '🎥 Recordings:', value: formatList(recordings) },
					{ name: '📚 Homework:', value: formatList(homework) }
				);

			await interaction.editReply({ embeds: [embed] });
		} catch (error) {
			console.error('Error fetching files/assignments:', error.response ? error.response.data : error.message);
			await interaction.editReply({ content: 'Something went wrong while retrieving data.' });
		}
	});
}

async function getAllFolders(courseId: string, token: string): Promise<any[]> {
	const allFolders: any[] = [];
	let page = 1;
	while (true) {
		const response = await axios.get(
			`${CANVAS.BASE_URL}/courses/${courseId}/folders?page=${page}&per_page=100`,
			{
				headers: { Authorization: `Bearer ${token}` }
			}
		);
		const folders = response.data;
		if (!folders || folders.length === 0) break;
		allFolders.push(...folders);
		page++;
	}
	return allFolders;
}

function getFileIcon(filename: string): string {
	const ext = filename.split('.').pop()?.toLowerCase();
	switch (ext) {
		case 'pdf': return '📄';
		case 'doc':
		case 'docx': return '📝';
		case 'ppt':
		case 'pptx': return '📊';
		case 'xls':
		case 'xlsx': return '📈';
		case 'zip':
		case 'rar': return '🗜️';
		case 'jpg':
		case 'jpeg':
		case 'png':
		case 'gif': return '🖼️';
		default: return '📁';
	}
}

function formatFileSize(bytes: number): string {
	const sizes = ['B', 'KB', 'MB', 'GB'];
	if (bytes === 0) return '0 B';
	const i = Math.floor(Math.log(bytes) / Math.log(1024));
	const size = (bytes / Math.pow(1024, i)).toFixed(1);
	return `${size} ${sizes[i]}`;
}
