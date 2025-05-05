/* eslint-disable id-length */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
	ApplicationCommandOptionData,
	ChatInputCommandInteraction,
	EmbedBuilder,
	ActionRowBuilder,
	StringSelectMenuBuilder,
	StringSelectMenuInteraction,
	Client,
	Interaction,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
	ModalSubmitInteraction,
	ActionRowBuilder as ModalRowBuilder
} from 'discord.js';

import { Command } from '@lib/types/Command';
import axios from 'axios';
import { CANVAS } from '../../../config';
import { getUserCanvasToken } from './authenticatecanvas';

export default class extends Command {

	description = 'Fetch the latest file from a Canvas course';
	runInDM = true;
	options: ApplicationCommandOptionData[] = []; // Interaction with users via a drop down & a modal

	async run(interaction: ChatInputCommandInteraction): Promise<void> {
		const canvasToken = await getUserCanvasToken(interaction.client.mongo, interaction.user.id);
		if (!canvasToken) {
			await interaction.reply({ content: 'You need to authenticate your Canvas account first, run /authenticatecanvas.', ephemeral: true });
			return;
		}
		setupInteractionHandler(interaction.client, canvasToken); // initialize handler first thing
		await interaction.deferReply();

		const baseUrl = `${CANVAS.BASE_URL}/courses?page=1&per_page=100&enrollment_state=active`;

		try {
			const response = await axios.get(baseUrl, {
				headers: { Authorization: `Bearer ${canvasToken}` }
			});

			const activeCourses = response.data;
			console.log(`Fetched ${activeCourses.length} courses`);

			const activeCoursesCleaned = [];
			for (const course of activeCourses) {
				activeCoursesCleaned.push({ id: course.id, name: course.name });
			}

			if (activeCoursesCleaned.length === 0) {
				await interaction.editReply({ content: 'No active courses found.' });
				return;
			}

			const courseOptions = activeCoursesCleaned.map(course => ({
				label: course.name,
				value: course.id.toString()
			}));

			const selectMenu = new StringSelectMenuBuilder()
				.setCustomId('course_select')
				.setPlaceholder('Select a course')
				.addOptions(courseOptions);

			const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

			await interaction.editReply({ content: 'Select a course to search a file:', components: [row] });
		} catch (err) {
			console.error('Course fetch error:', err.response?.data || err.message);
			await interaction.editReply({ content: 'Failed to fetch courses.' });
		}
	}

}
// Listener only set up once to handle the same interaction for select menu & modal
export function setupInteractionHandler(client: Client, token: string) {
	let initialized = false;
	if (initialized) return;
	initialized = true;

	client.on('interactionCreate', async (interaction: Interaction) => {
		if (interaction.isStringSelectMenu() && interaction.customId === 'course_select') {
			await handleCourseSelection(interaction); // Call the modal creation when the dropdown is clicked
		}

		if (interaction.isModalSubmit() && interaction.customId.startsWith('file_search_modal:')) {
			await handleFileSearchModal(interaction, token);
		}
	});
}

async function handleCourseSelection(interaction: StringSelectMenuInteraction) {
	const courseId = interaction.values[0];
	// Change the entry point for search term to be a pop-up modal from discord library
	const modal = new ModalBuilder()
		.setCustomId(`file_search_modal:${courseId}`)
		.setTitle('Search for a File');

	const input = new TextInputBuilder()
		.setCustomId('search_term')
		.setLabel('Enter file name')
		.setStyle(TextInputStyle.Short)
		.setPlaceholder('e.g. syllabus, lecture 3...')
		.setRequired(true);

	const row = new ModalRowBuilder<TextInputBuilder>().addComponents(input);
	modal.addComponents(row);

	await interaction.showModal(modal);
}
// String matching logic with threshold as a constant (from 0 - 1.0, think of it as 0% - 100% match)
async function handleFileSearchModal(interaction: ModalSubmitInteraction, token: string) {
	const [_, courseId] = interaction.customId.split(':');
	const searchTerm = interaction.fields.getTextInputValue('search_term');
	const matchThreshold = 0.5;

	try {
		await interaction.deferReply();
		const foldersUrl = `https://udel.instructure.com/api/v1/courses/${courseId}/folders`;
		const foldersResponse = await axios.get(foldersUrl, {
			headers: { Authorization: `Bearer ${token}` }
		});

		const folders = foldersResponse.data;
		if (folders.length === 0) {
			await interaction.editReply({ content: 'No folders found for this course.' });
			return;
		}

		const matchedFiles = [];

		for (const folder of folders) {
			const filesUrl = `https://udel.instructure.com/api/v1/folders/${folder.id}/files`;
			try {
				const filesResponse = await axios.get(filesUrl, {
					headers: { Authorization: `Bearer ${token}` }
				});

				const files = filesResponse.data;
				console.log(`Fetched ${files.length} files from course`);
				const filtered = files.filter(file =>
					file.display_name.toLowerCase().includes(searchTerm.toLowerCase())
				);

				matchedFiles.push(...filtered);
			} catch (error) {
				console.warn(`Skipped folder ${folder.name} due to error.`);
			}
		}

		console.log(`Search Term: ${searchTerm}`); // Log search term with each file fetch

		if (matchedFiles.length === 0) {
			await interaction.editReply({ content: 'No files found matching "${searchTerm}" for this course.' });
			return;
		}

		// Sort files alphabetically by name
		matchedFiles.sort((a, b) => a.display_name.localeCompare(b.display_name));

		// Create description with icon + file size
		const fileDescriptions = matchedFiles.map((file, index) => {
			const icon = getFileIcon(file.display_name);
			const size = formatFileSize(file.size);
			return `(${index + 1} of ${matchedFiles.length}) ${icon} ${file.display_name} (${size}) — [Download File](${file.url})`;
		}).join(`\n\n`);

		// const latestFile = matchedFiles[0];
		const embed = new EmbedBuilder()
			.setColor('#3CD6A3')
			.setTitle(`Found file(s) matching: "${searchTerm}"`)
			.setDescription(fileDescriptions);

		console.log('Sending embed response...');
		await interaction.editReply({ embeds: [embed] });
	} catch (error) {
		console.error('Error fetching course files:', error.response ? error.response.data : error.message);
		await interaction.editReply({ content: 'Failed to fetch course files.' });
	}
}

// Displays an emoji correlating to the file type
function getFileIcon(filename: string): string {
	const ext = filename.split('.').pop()?.toLowerCase();
	switch (ext) {
		case 'pdf':
			return '📄';
		case 'doc':
		case 'docx':
			return '📝';
		case 'ppt':
		case 'pptx':
			return '📊';
		case 'xls':
		case 'xlsx':
			return '📈';
		case 'zip':
		case 'rar':
			return '🗜️';
		case 'jpg':
		case 'jpeg':
		case 'png':
		case 'gif':
			return '🖼️';
		default:
			return '📁';
	}
}

// Displays the file size
function formatFileSize(bytes: number): string {
	const sizes = ['B', 'KB', 'MB', 'GB'];
	if (bytes === 0) return '0 B';
	const i = Math.floor(Math.log(bytes) / Math.log(1024));
	const size = (bytes / Math.pow(1024, i)).toFixed(1);
	return `${size} ${sizes[i]}`;
}

