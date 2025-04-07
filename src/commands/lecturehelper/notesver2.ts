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
import stringSimilarity from 'string-similarity';
import { CANVAS } from '../../../config';

export default class extends Command {

	description = 'Fetch the latest file from a Canvas course';
	runInDM = true;
	options: ApplicationCommandOptionData[] = []; // Interaction with users via a drop down & a modal

	async run(interaction: ChatInputCommandInteraction): Promise<void> {
		setupInteractionHandler(interaction.client); // initialize handler first thing
		await interaction.deferReply();

		const baseUrl = `${CANVAS.BASE_URL}/courses?page=1&per_page=100`;

		try {
			const response = await axios.get(baseUrl, {
				headers: { Authorization: `Bearer ${CANVAS.TOKEN}` }
			});

			const validCourses = [];

			for (const course of response.data) {
				const enrollCheckUrl = `${CANVAS.BASE_URL}/courses/${course.id}/enrollments?type[]=StudentEnrollment&per_page=1`;
				try {
					await axios.get(enrollCheckUrl, {
						headers: { Authorization: `Bearer ${CANVAS.TOKEN}` }
					});
					validCourses.push({ id: course.id, name: course.name });
				} catch (err) {
					if (err.response?.status !== 403) console.warn(`Skipping course ${course.id}`);
				}
			}

			if (!validCourses.length) {
				await interaction.editReply({ content: 'No active courses found.' });
				return;
			}

			const options = validCourses.map(c => ({ label: c.name, value: c.id.toString() }));

			const selectMenu = new StringSelectMenuBuilder()
				.setCustomId('course_select')
				.setPlaceholder('Select a course')
				.addOptions(options);

			const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

			await interaction.editReply({ content: 'Select a course to search a file:', components: [row] });
		} catch (err) {
			console.error('Course fetch error:', err.response?.data || err.message);
			await interaction.editReply({ content: 'Failed to fetch courses.' });
		}
	}

}
// Listener only set up once to handle the same interaction for select menu & modal
export function setupInteractionHandler(client: Client) {
	let initialized = false;
	if (initialized) return;
	initialized = true;

	client.on('interactionCreate', async (interaction: Interaction) => {
		if (interaction.isStringSelectMenu() && interaction.customId === 'course_select') {
			await handleCourseSelection(interaction); // Call the modal creation when the dropdown is clicked
		}

		if (interaction.isModalSubmit() && interaction.customId.startsWith('file_search_modal:')) {
			await handleFileSearchModal(interaction);
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
async function handleFileSearchModal(interaction: ModalSubmitInteraction) {
	const [_, courseId] = interaction.customId.split(':');
	const searchTerm = interaction.fields.getTextInputValue('search_term');
	const matchThreshold = 0.5;

	await interaction.deferReply();

	try {
		// Get all files from the course (without handling pagination logic, come back and revise later)
		const filesRes = await axios.get(`${CANVAS.BASE_URL}/courses/${courseId}/files`, {
			headers: { Authorization: `Bearer ${CANVAS.TOKEN}` }
		});

		const files = filesRes.data;

		if (!files.length) {
			await interaction.editReply({ content: 'No files found for this course.' });
			return;
		}

		const fileNames = files.map((f: any) => f.display_name);
		const { bestMatch } = stringSimilarity.findBestMatch(searchTerm, fileNames);
		// Return closet file & inform users if matching score doesn't pass the threshold
		if (bestMatch.rating < matchThreshold) {
			await interaction.editReply({
				content: `No strong matches found for **"${searchTerm}"**. Closest: **"${bestMatch.target}"** (score: ${bestMatch.rating.toFixed(2)})`
			});
			return;
		}

		const matchedFile = files.find((f: any) => f.display_name === bestMatch.target);

		if (!matchedFile) {
			await interaction.editReply({ content: `Best match found, but file could not be retrieved.` });
			return;
		}

		const embed = new EmbedBuilder()
			.setColor('#3CD6A3')
			.setTitle(matchedFile.display_name)
			.setDescription(`[Download File](${matchedFile.url})\n**Match Score:** ${bestMatch.rating.toFixed(2)}`);

		await interaction.editReply({ embeds: [embed] });
	} catch (err) {
		console.error('File search error:', err.response?.data || err.message);
		await interaction.editReply({ content: 'Failed to search files.' });
	}
}
