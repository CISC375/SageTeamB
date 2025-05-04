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
import { DB } from '@root/config';
import { SageUser } from '@lib/types/SageUser';

interface CanvasCourse {
	id: number;
	name: string;
}

interface CanvasAssignment {
	id: number;
	name: string;
	due_at: string;
	html_url: string;
	points_possible: number;
	submission_types: string[];
	has_submitted_submissions: boolean;
}

interface CanvasSubmission {
	assignment_id: number;
	submitted_at: string | null;
	workflow_state: string;
}

let handlerRegistered = false;

function generateProgressBar(completed: number, total: number, length = 10): string {
	const progress = total === 0 ? 0 : completed / total;
	const filledLength = Math.round(progress * length);
	const bar = '▓'.repeat(filledLength) + '░'.repeat(length - filledLength);
	const percent = Math.round(progress * 100);
	return `${bar} ${percent}%`;
}

export default class extends Command {
	description = 'Fetch upcoming assignments from a Canvas course';
	runInDM = true;
	options: ApplicationCommandOptionData[] = [];

	async run(interaction: ChatInputCommandInteraction): Promise<void> {
		const user: SageUser = await interaction.client.mongo.collection(DB.USERS).findOne({ discordId: interaction.user.id });

		if (!user) {
			await interaction.reply({ content: 'You are not registered in the database. Please verify your account first.' });
			return;
		}

		if (!user.canvasToken) {
			await interaction.reply({ content: 'You need to set up your Canvas access token first. Use the `/inputtoken` command to do so.' });
			return;
		}

		const canvasToken = user.canvasToken;
		const baseUrl = `${CANVAS.BASE_URL}/courses?page=1&per_page=100&enrollment_state=active`;

		try {
			await interaction.deferReply({ /* ephemeral: true */});

			const response = await axios.get<CanvasCourse[]>(baseUrl, {
				headers: { Authorization: `Bearer ${canvasToken}` }
			});
			const allCourses = response.data;

			// Map courses to an array of promises, preserving original order
			const coursePromises = allCourses.map(async (course: CanvasCourse) => {
				try {
					await axios.get(
						`https://udel.instructure.com/api/v1/courses/${course.id}/enrollments?type[]=StudentEnrollment&include[]=enrollments&page=1&per_page=1`,
						{ headers: { Authorization: `Bearer ${canvasToken}` } }
					);
					return { id: course.id, name: course.name };
				} catch (error) {
					if (axios.isAxiosError(error) && error.response?.status !== 403) {
						console.error(`Error checking course ${course.id}:`, error.message);
					}
					return null;
				}
			});

			// Resolve promises and filter out null results, preserving order
			const validCourses = (await Promise.all(coursePromises)).filter((course): course is CanvasCourse => course !== null);

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
	const user: SageUser = await interaction.client.mongo.collection(DB.USERS).findOne({ discordId: interaction.user.id });

	if (!user || !user.canvasToken) {
		await interaction.reply({ content: 'You need to set up your Canvas access token first. Use the `/inputtoken` command to do so.' });
		return;
	}

	const canvasToken = user.canvasToken;

	try {
		await interaction.deferReply({ /* ephemeral: true */ });

		const courseId = interaction.values[0];
		const assignmentsUrl = `https://udel.instructure.com/api/v1/courses/${courseId}/assignments`;

		const assignmentsResponse = await axios.get<CanvasAssignment[]>(assignmentsUrl, {
			headers: { Authorization: `Bearer ${canvasToken}` }
		});

		const assignments = assignmentsResponse.data;
		const now = new Date();

		const upcoming = assignments
			.filter(a => a.due_at && new Date(a.due_at) > now && a.points_possible > 0)
			.sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime())
			.slice(0, 5);

		if (!upcoming.length) {
			await interaction.editReply({ content: 'No upcoming assignments found.' });
			return;
		}

		const weekStart = new Date(now);
		weekStart.setDate(now.getDate() - now.getDay());
		weekStart.setHours(0, 0, 0, 0);
		const weekEnd = new Date(weekStart);
		weekEnd.setDate(weekStart.getDate() + 7);

		const thisWeekAssignments = assignments.filter(a => {
			if (!a.due_at) {
				return false;
			}
			const dueDate = new Date(a.due_at);

			const isGradable = a.points_possible > 0;
			const isQuiz = a.submission_types.includes('online_quiz');

			return (
				dueDate >= weekStart && 
				dueDate < weekEnd &&
				(isGradable || isQuiz)
			);
		});

		const submissionRes = await axios.get<CanvasSubmission[]>(`${assignmentsUrl}/?student_id=self&per_page=100`, {
			headers: { Authorization: `Bearer ${canvasToken}` }
		});
		const submissions = submissionRes.data;

		const completed = thisWeekAssignments.filter(assign => {
			const submission = submissions.find(s => s.assignment_id === assign.id);
			return submission &&
				(submission.submitted_at !== null || submission.workflow_state === 'submitted' || submission.workflow_state === 'graded' || submission.workflow_state === 'complete');
		});

		let progressText = '📊 No assignments due this week.';

		if (thisWeekAssignments.length > 0) {
			const completedCount = completed.length;
			const totalCount = thisWeekAssignments.length;

			const progressBar = generateProgressBar(completedCount, totalCount);

			progressText = `📊 Weekly Progress: **${completedCount} / ${totalCount} assignments completed**\n${progressBar}`;
		}

		const courseDetails = await axios.get<CanvasCourse>(
			`https://udel.instructure.com/api/v1/courses/${courseId}`,
			{ headers: { Authorization: `Bearer ${canvasToken}` } }
		);

		const embed = new EmbedBuilder()
			.setColor('#3CD6A3')
			.setTitle(`Upcoming Assignments for ${courseDetails.data.name}`)
			.setDescription(
				`${progressText}\n\n` +
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