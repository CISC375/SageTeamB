/* eslint-disable no-mixed-spaces-and-tabs */
/* eslint-disable no-multi-spaces */
/* eslint-disable no-trailing-spaces */
/* eslint-disable @typescript-eslint/indent */

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

export default class extends Command {

    description = 'Fetch the latest file from a Canvas course';
    runInDM?: true;
    options: ApplicationCommandOptionData[] = [
        {
            name: 'search_term',
            description: 'Search term to filter files',
            type: ApplicationCommandOptionType.String,  // Required string option for search term
            required: true
        }
    ];

    async run(interaction: ChatInputCommandInteraction): Promise<void> {
        const canvasToken = CANVAS.TOKEN;
        const baseUrl = `${CANVAS.BASE_URL}/courses?page=1&per_page=100&enrollment_state=active`;

        try {
            // Get search term from interaction
            const searchTerm = interaction.options.getString('search_term');
            console.log('Search Term:', searchTerm); // Log the search term

            // No longer ephemeral, so remove the `ephemeral: true` here
            await interaction.deferReply();

            console.log('Fetching all courses...');
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
            await interaction.editReply({ content: 'Select a course:', components: [row] });

            // Pass the searchTerm along with the interaction handler
            // Now call setupInteractionHandler here by passing the client and searchTerm
            setupInteractionHandler(interaction.client, searchTerm);
        } catch (error) {
            console.error('Error fetching courses:', error.response ? error.response.data : error.message);
            await interaction.editReply({ content: 'Failed to fetch courses.' });
        }
    }

}

export async function handleCourseSelection(interaction: StringSelectMenuInteraction, searchTerm: string) {
    try {
        // Make this reply visible to the chat (no ephemeral)
        await interaction.deferReply();

        console.log('Search Term inside handleCourseSelection:', searchTerm); // Log search term

        const courseId = interaction.values[0];
        const canvasToken = CANVAS.TOKEN;
		console.log(`Fetching files for course ID: ${courseId}`);

		const foldersUrl = `https://udel.instructure.com/api/v1/courses/${courseId}/folders`;
		const foldersResponse = await axios.get(foldersUrl, {
			headers: { Authorization: `Bearer ${canvasToken}` }
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
					headers: { Authorization: `Bearer ${canvasToken}` }
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

        console.log(`Search Term: ${searchTerm}`);  // Log search term with each file fetch

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

// Ensure the bot listens for the course selection interaction
// Now accepts the client instance
export function setupInteractionHandler(client: Client, searchTerm?: string) {
    client.on('interactionCreate', async (interaction: Interaction) => {
        if (interaction.isStringSelectMenu() && interaction.customId === 'course_select') {
            await handleCourseSelection(interaction as StringSelectMenuInteraction, searchTerm);  // Pass search term to the handler
        }
    });
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
