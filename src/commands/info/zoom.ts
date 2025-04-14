import { ApplicationCommandOptionData, ChatInputCommandInteraction, EmbedBuilder, ApplicationCommandOptionType, InteractionResponse } from 'discord.js';
import { Command } from '@lib/types/Command';

export default class extends Command {

	description = `Provides zoom links for a class`;
	extendedHelp = 'If given no arguments, it will default to CS1';

	options: ApplicationCommandOptionData[] = [
		{
			name: 'courseid',
			description: 'Gets the zoom link for a certain course',
			type: ApplicationCommandOptionType.String,
			required: false
		}
	]

	async run(interaction: ChatInputCommandInteraction): Promise<InteractionResponse<boolean> | void> {
		let zoomLink = '';
		const courseId = interaction.options.getString('courseid');
		try {
			// Define the API endpoint to fetch "My Media" items
			// const apiUrl = `/api/v1/courses/${interaction}/media_objects`;
			// const apiUrl = `https://udel.instructure.com/api/v1/courses/1808252/external_tools`;
			const apiUrl = `https://udel.instructure.com/api/v1/courses/${courseId}/media_objects`;

			// Fetch the media objects
			const response = await fetch(apiUrl, {
				method: 'GET',
				headers: {
					Authorization: `Bearer 25~HDHmPPaLaMZXkLL7aFmDcmhUCvX6C8V9znDEyHnYCFXnMKLF7xf26ZreYX3CfyCX`, // Replace with actual token
					'Content-Type': 'application/json'
				}
			});

			if (!response.ok) {
				throw new Error(`Error fetching media objects: ${response.statusText}`);
			}

			const mediaObjects = await response.json();

			// Look for a media object that contains a Zoom link
			for (const media of mediaObjects) {
				zoomLink = media.media_id;
				// zoomLink = courseId;
				break;
				// if (media.media_type === 'external' || media.url.includes('zoom.us') || media.url.includes('kaltura.com')) {
				/* if (media.url.includes('kaltura.com')) {
					zoomLink = media.url;
					break;
					// return media.url;
				} */
			}
			// const tools = await response.json();
			// zoomLink = tools.find(tool => tool.id === 151642); // Match the tool ID
			// return null; // No Zoom link found
		} catch (error) {
			console.error('Failed to retrieve Zoom link:', error);
			zoomLink = 'Sorry! No zoom link found';
		}

		let responseEmbed: EmbedBuilder;
		if (zoomLink === 'Sorry! No zoom link found') {
			responseEmbed = new EmbedBuilder()
				.setColor('#ff0000')
				.setTitle('Zoom Link')
				.setDescription(`Sorry about that! No zoom has been found.\nCourse ID given: ${zoomLink}`);
		} else {
			responseEmbed = new EmbedBuilder()
				.setColor('#00ff00')
				.setTitle('Zoom Link')
				.setDescription(`https://udel.instructure.com/media_objects/${zoomLink}`);
		}
		return interaction.reply({ embeds: [responseEmbed] });
	}

}
