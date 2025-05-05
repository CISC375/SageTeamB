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
import { CANVAS } from '../../../config';
import { getUserCanvasToken } from './authenticatecanvas';


interface CanvasCourse {
	id: number;
	name: string;
}

// interfaces to avoid the any type

interface CanvasAssignment {
	id: number;
	name: string;
	due_at: string;
	html_url: string;
}
// prevents reregistering handler
let handlerRegistered = false;

export default class extends Command {

	description = 'Fetch upcoming assignments from a Canvas course';
	runInDM = true;
	options: ApplicationCommandOptionData[] = [
		// {
		// 	name: 'search_term',
		// 	description: 'Optional keyword to filter assignments',
		// 	type: ApplicationCommandOptionType.String,
		// 	required: false
		// }
	];

	async run(interaction: ChatInputCommandInteraction): Promise<void> {
		const canvasToken = await getUserCanvasToken(interaction.client.mongo, interaction.user.id);
		if (!canvasToken) {
			await interaction.reply({ content: 'You need to authenticate your Canvas account first, call /authenticatecanvas.', ephemeral: true });
			return;
		}
		const baseUrl = `${CANVAS.BASE_URL}/courses?page=1&per_page=100&enrollment_state=active;`;

		try {
			// const searchTerm = interaction.options.getString('search_term') ?? '';
			await interaction.deferReply({ ephemeral: true });

			const response = await axios.get<CanvasCourse[]>(baseUrl, {
				headers: { Authorization: `Bearer ${canvasToken}` }
			});
			const allCourses = response.data;

			const validCourses: CanvasCourse[] = [];


			// for (const course of allCourses) {
			// 	const enrollmentUrl = `https://udel.instructure.com/api/v1/courses/${course.id}/enrollments?type[]=StudentEnrollment&include[]=enrollments&page=1&per_page=1`;
			// 	try {
			// 		await axios.get(enrollmentUrl, {
			// 			headers: { Authorization: `Bearer ${canvasToken}` }
			// 		});
			// 		validCourses.push({ id: course.id, name: course.name });
			// 	} catch (error) {
			// 		if (error.response?.status !== 403) {
			// 			console.error(`Error checking enrollment for course ${course.id}:`, error.message);
			// 		}
			// 	}
			// }

			await Promise.all(
				allCourses.map((course: CanvasCourse) =>
					axios
						.get(`https://udel.instructure.com/api/v1/courses/${course.id}/enrollments?type[]=StudentEnrollment&include[]=enrollments&page=1&per_page=1`, {
							headers: { Authorization: `Bearer ${canvasToken}` }
						})
						.then(() => validCourses.push({ id: course.id, name: course.name }))
						.catch((error) => {
							if (axios.isAxiosError(error) && error.response?.status !== 403) {
								console.error(`Error checking course ${course.id}:`, error.message);
							}
						})
				)
			);

			if (validCourses.length === 0) {
				await interaction.editReply({ content: 'No active courses found.' });
				return;
			}

			const courseOptions = validCourses.map(course => ({
				label: course.name.slice(0, 100),
				value: course.id.toString()
			}));

			const selectMenu = new StringSelectMenuBuilder()
				.setCustomId('assignment_course_select')
				.setPlaceholder('Select a course')
				.addOptions(courseOptions.slice(0, 25));

			const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
			await interaction.editReply({ content: 'Select a course:', components: [row] });

			// Set up handler using the dropdown
			if (!handlerRegistered) {
				setupHomeworkDropdownHandler(interaction.client);
				handlerRegistered = true;
			}
		} catch (error: unknown) {
			const message = axios.isAxiosError(error)
				? error.response?.data ?? error.message
				: (error as Error).message;

			console.error('Error fetching courses:', message);
			await interaction.editReply({ content: 'Failed to fetch courses.' });
		}
	}

}


export async function handleAssignmentCourseSelection(interaction: StringSelectMenuInteraction) {
	const canvasToken = await getUserCanvasToken(interaction.client.mongo, interaction.user.id);

	try {
		await interaction.deferReply({ ephemeral: true });

		const courseId = interaction.values[0];
		const assignmentsUrl = `https://udel.instructure.com/api/v1/courses/${courseId}/assignments`;

		const assignmentsResponse = await axios.get<CanvasAssignment[]>(assignmentsUrl, {
			headers: { Authorization: `Bearer ${canvasToken}` }
		});

		const assignments = assignmentsResponse.data;
		const now = new Date();

		const upcoming = assignments
			.filter(a => a.due_at && new Date(a.due_at) > now)
			.sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime())
			.slice(0, 5);

		if (!upcoming.length) {
			await interaction.editReply({ content: 'No upcoming assignments found.' });
			return;
		}

		const courseDetails = await axios.get<CanvasCourse>(`https://udel.instructure.com/api/v1/courses/${courseId}`, {
			headers: { Authorization: `Bearer ${canvasToken}` }
		});

		const embed = new EmbedBuilder()
			.setColor('#3CD6A3')
			.setTitle(`Upcoming Assignments for ${courseDetails.data.name}`)
			.setDescription(
				upcoming.map((a) =>
					`📘 **${a.name}**\n🕒 Due: <t:${Math.floor(new Date(a.due_at).getTime() / 1000)}:F>\n[View Assignment](${a.html_url})`
				).join('\n\n')
			);

		await interaction.editReply({ embeds: [embed] });
	} catch (error: unknown) {
		const message = axios.isAxiosError(error)
			? error.response?.data ?? error.message
			: (error as Error).message;

		console.error('Error fetching assignments:', message);
		await interaction.editReply({ content: 'Failed to fetch assignments.' });
	}
}


export function setupHomeworkDropdownHandler(client: Client): void {
	client.on('interactionCreate', async (interaction: Interaction) => {
		if (
			interaction.isStringSelectMenu()
			&& interaction.customId === 'assignment_course_select'
		) {
			await handleAssignmentCourseSelection(interaction as StringSelectMenuInteraction);
		}
	});
}
