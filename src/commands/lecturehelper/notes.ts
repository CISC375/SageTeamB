import { ApplicationCommandOptionData, ApplicationCommandOptionType, ChatInputCommandInteraction, EmbedBuilder, InteractionResponse } from 'discord.js';
import { Command } from '@lib/types/Command';
import axios from 'axios';

export default class extends Command {
	description = 'Fetch the latest file from a Canvas course';
	runInDM?: true;
	options: ApplicationCommandOptionData[] = [
		{
			name: 'course',
			description: 'The name of the course',
			type: ApplicationCommandOptionType.String,
			required: true
		}
	];

	async run(interaction: ChatInputCommandInteraction): Promise<InteractionResponse<boolean> | void> {
		const courseName = interaction.options.getString('course');
		console.log(`Received course name: ${courseName}`);

		const canvasToken = '25~n29E3YGf3YD6rtGxyTWy7MkFrehA7UwZVk3xmvaUN7mGtz9UJTYTuH4EtwQANVE8';
		const baseUrl = 'https://udel.instructure.com/api/v1/courses?page=1&per_page=100';

		try {
			// Step 1: Fetch courses with pagination parameters
			console.log('Fetching courses from Canvas with page=1 and per_page=100...');
			const response = await axios.get(baseUrl, {
				headers: { Authorization: `Bearer ${canvasToken}` }
			});

			const allCourses = response.data;
			console.log(`Fetched ${allCourses.length} courses`);

			// Step 2: Find the best-matching course ID
			console.log(courseName);
			const matchedCourse = allCourses.find(course =>
				(course.name?.toLowerCase() ?? "").includes(courseName.toLowerCase())
			);			

			if (!matchedCourse) {
				console.log(`No matching course found for: ${courseName}`);
				return interaction.reply({ content: `No course found matching "${courseName}".`, ephemeral: true });
			}

			const courseId = matchedCourse.id;
			console.log(`Matched course: ${matchedCourse.name} (ID: ${courseId})`);

			// Step 3: Fetch files for the matched course
			console.log(`Fetching files for course ID: ${courseId}`);
			const filesResponse = await axios.get(`https://udel.instructure.com/api/v1/courses/${courseId}/files`, {
				headers: { Authorization: `Bearer ${canvasToken}` }
			});

			const files = filesResponse.data;
			console.log(`Fetched ${files.length} files from course`);

			if (files.length === 0) {
				return interaction.reply({ content: 'No files found for this course.', ephemeral: true });
			}
			console.log(files)

			// Step 4: Get the first file's public URL
			console.log(`Fetching file URL for: ${files[0].display_name}`);
			const fileUrlResponse = await axios.get(files[0].url, {
				headers: { Authorization: `Bearer ${canvasToken}` }
			});

			console.log("File URL retrieved:", fileUrlResponse.config.url);

			// Step 5: Reply with the first file's link
			const embed = new EmbedBuilder()
				.setColor('#3CD6A3')
				.setTitle(files[0].display_name)
				.setDescription(`[Download File](${fileUrlResponse.config.url})`);

			return interaction.reply({ embeds: [embed], ephemeral: true });

		} catch (error) {
			console.error('Error fetching course files:', error.response ? error.response.data : error.message);
			return interaction.reply({ content: 'Failed to fetch course files.', ephemeral: true });
		}
	}
}
