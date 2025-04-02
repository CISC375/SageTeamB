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
        const canvasToken = '25~n29E3YGf3YD6rtGxyTWy7MkFrehA7UwZVk3xmvaUN7mGtz9UJTYTuH4EtwQANVE8';
        const baseUrl = 'https://udel.instructure.com/api/v1/courses?page=1&per_page=100';

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
            const allCourses = response.data;
            console.log(`Fetched ${allCourses.length} courses`);

            const validCourses = [];
            for (const course of allCourses) {
                const enrollmentUrl = `https://udel.instructure.com/api/v1/courses/${course.id}/enrollments?type[]=StudentEnrollment&include[]=enrollments&page=1&per_page=1`;
                try {
                    await axios.get(enrollmentUrl, {
                        headers: { Authorization: `Bearer ${canvasToken}` }
                    });
                    validCourses.push({ id: course.id, name: course.name });
                } catch (error) {
                    if (error.response?.status !== 403) {
                        console.error(`Error checking enrollment for course ${course.id}:`, error.message);
                    }
                }
            }

            if (validCourses.length === 0) {
                await interaction.editReply({ content: 'No active courses found.' });
                return;
            }

            const courseOptions = validCourses.map(course => ({
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
        const canvasToken = '25~n29E3YGf3YD6rtGxyTWy7MkFrehA7UwZVk3xmvaUN7mGtz9UJTYTuH4EtwQANVE8';
        const filesUrl = `https://udel.instructure.com/api/v1/courses/${courseId}/files`;

        console.log(`Fetching files for course ID: ${courseId}`);
        console.log(`Search Term: ${searchTerm}`);  // Log search term with each file fetch
        const filesResponse = await axios.get(filesUrl, {
            headers: { Authorization: `Bearer ${canvasToken}` }
        });

        const files = filesResponse.data;
        console.log(`Fetched ${files.length} files from course`);

        if (files.length === 0) {
            await interaction.editReply({ content: 'No files found for this course.' });
            return;
        }

        const fileUrlResponse = await axios.get(files[0].url, {
            headers: { Authorization: `Bearer ${canvasToken}` }
        });

        const embed = new EmbedBuilder()
            .setColor('#3CD6A3')
            .setTitle(files[0].display_name)
            .setDescription(`[Download File](${fileUrlResponse.config.url})`);

        console.log("Sending embed response...");
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
