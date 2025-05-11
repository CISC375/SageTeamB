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
			const errorEmbed = new EmbedBuilder()
				.setColor('#ff0000')
				.setTitle('You cannot use this command!')
				.setDescription('To use `/notes`, you need to input a Canvas Access Token. Do this by running `/authenticatecanvas`.');

			await interaction.reply({ embeds: [errorEmbed], /* ephemeral: true */ });
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
	const searchTerm = interaction.fields.getTextInputValue('search_term').toLowerCase();
	const matchedResults: string[] = [];

	await interaction.deferReply();

	// ---------- 1. SEARCH FILES ----------
	try {
		const foldersUrl = `${CANVAS.BASE_URL}/courses/${courseId}/folders`;
		const foldersResponse = await axios.get(foldersUrl, {
			headers: { Authorization: `Bearer ${token}` }
		});

		for (const folder of foldersResponse.data) {
			const filesUrl = `${CANVAS.BASE_URL}/folders/${folder.id}/files`;
			try {
				const filesResponse = await axios.get(filesUrl, {
					headers: { Authorization: `Bearer ${token}` }
				});
				for (const file of filesResponse.data) {
					if (file.display_name.toLowerCase().includes(searchTerm)) {
						const icon = getFileIcon(file.display_name);
						const size = formatFileSize(file.size);
						matchedResults.push(`${icon} ${file.display_name} (${size}) — [Download](${file.url})`);
					}
				}
			} catch (_) {
				continue;
			}
		}
	} catch (err) {
		console.warn('File search failed:', err);
	}

	// ---------- 2. SEARCH MODULES AND THEIR FILES ----------
	try {
		const modulesResponse = await axios.get(`${CANVAS.BASE_URL}/courses/${courseId}/modules`, {
			headers: { Authorization: `Bearer ${token}` }
		});

		for (const module of modulesResponse.data) {
			if (module.name.toLowerCase().includes(searchTerm)) {
				const itemsResponse = await axios.get(`${CANVAS.BASE_URL}/courses/${courseId}/modules/${module.id}/items`, {
					headers: { Authorization: `Bearer ${token}` }
				});

				for (const item of itemsResponse.data) {
					if (item.type === 'File' && item.url) {
						const fileData = await axios.get(item.url, {
							headers: { Authorization: `Bearer ${token}` }
						});
						const file = fileData.data;
						const icon = getFileIcon(file.display_name);
						const size = formatFileSize(file.size);
						matchedResults.push(`${icon} ${file.display_name} (${size}) — [Download](${file.url})`);
					} else if (item.type === 'Page') {
						const pageData = await axios.get(item.url, {
							headers: { Authorization: `Bearer ${token}` }
						});

						const body = pageData.data.body || '';
						const fileIds: string[] = [];
						const regex = /\/files\/(\d+)/g;
						let match;
						while ((match = regex.exec(body)) !== null) {
							fileIds.push(match[1]);
						}

						for (const id of fileIds) {
							const fileRes = await axios.get(`${CANVAS.BASE_URL}/files/${id}`, {
								headers: { Authorization: `Bearer ${token}` }
							});
							const file = fileRes.data;
							const icon = getFileIcon(file.display_name);
							const size = formatFileSize(file.size);
							matchedResults.push(`${icon} ${file.display_name} (${size}) — [Download](${file.url})`);
						}
					}
				}
			}
		}
	} catch (err) {
		console.warn('Module search failed:', err);
	}

	// ---------- 3. SEARCH ASSIGNMENTS ----------
	try {
		const assignmentsResponse = await axios.get(`${CANVAS.BASE_URL}/courses/${courseId}/assignments`, {
			headers: { Authorization: `Bearer ${token}` }
		});

		for (const assignment of assignmentsResponse.data) {
			const nameMatch = assignment.name.toLowerCase().includes(searchTerm);
			const descMatch = assignment.description && assignment.description.toLowerCase().includes(searchTerm);

			if (nameMatch || descMatch) {
				const body = assignment.description || '';
				const fileIds: string[] = [];
				const regex = /\/files\/(\d+)/g;
				let match;
				while ((match = regex.exec(body)) !== null) {
					fileIds.push(match[1]);
				}

				for (const id of fileIds) {
					const fileRes = await axios.get(`${CANVAS.BASE_URL}/files/${id}`, {
						headers: { Authorization: `Bearer ${token}` }
					});
					const file = fileRes.data;
					const icon = getFileIcon(file.display_name);
					const size = formatFileSize(file.size);
					matchedResults.push(`${icon} ${file.display_name} (${size}) — [Download](${file.url})`);
				}
			}
		}
	} catch (err) {
		console.warn('Assignment search failed:', err);
	}

	// ---------- DISPLAY RESULTS ----------
	if (matchedResults.length === 0) {
		await interaction.editReply({ content: `No results found for "${searchTerm}".` });
		return;
	}

	const embed = new EmbedBuilder()
		.setColor('#3CD6A3')
		.setTitle(`Search results for: "${searchTerm}"`)
		.setDescription(matchedResults.join('\n\n'));

	await interaction.editReply({ embeds: [embed] });
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

