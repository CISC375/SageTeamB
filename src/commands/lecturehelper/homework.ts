import { ApplicationCommandOptionData, ApplicationCommandOptionType, ChatInputCommandInteraction, EmbedBuilder, InteractionResponse} from 'discord.js';
import { Command } from '@lib/types/Command';
import axios from 'axios';


export default class extends Command {
   description = 'Fetch upcoming assignments from a canvas course';
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


       const canvasToken = 'insert token';
       const baseUrl = 'https://udel.instructure.com/api/v1/courses';


       try {
           console.log('Fetching courses from Canvas...');
           const response = await axios.get(`${baseUrl}?per_page=100`, {
               headers: { Authorization: `Bearer ${canvasToken}` }
           });
           const allCourses = response.data;


           const matchedCourse = allCourses.find(course =>
           (course.name?.toLowerCase() ?? "").includes(courseName.toLowerCase())
           );


           if(!matchedCourse) {
               return interaction.reply({ content: `No course found matching "${courseName}".`, ephemeral: true });
           }


           const courseId = matchedCourse.id;
           console.log(`Matched course: ${matchedCourse.name} (ID: ${courseId})`);


           // Fetch the assignments
           const assignmentsResponse = await axios.get(`${baseUrl}/${courseId}/assignments`, {
               headers: { Authorization: `Bearer ${canvasToken}` }
           });
           const assignments = assignmentsResponse.data;


           if(!assignments.length) {
               return interaction.reply({ content: 'No assignemnts found for this course.', ephemeral: true });
           }


           // Filter upcoming asssignments that are not due yet. Slice limits to only next 5 assignments
           const now = new Date();
           const upcoming = assignments
               .filter(a => a.due_at && new Date(a.due_at) > now)
               .sort((a,b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime())
               .slice(0,5);


               if (!upcoming.length) {
                   return interaction.reply({ content: 'No upcoming assignments found.', ephemeral: true });
               }


               const embed = new EmbedBuilder()
               .setColor('#3CD6A3')
               .setTitle(`Upcoming Assignments for ${matchedCourse.name}`)
               .setDescription(
                   upcoming.map(a => `📘 **${a.name}**\n🕒 Due: <t:${Math.floor(new Date(a.due_at).getTime() / 1000)}:F>\n[View Assignment](${a.html_url})\n`).join('\n')
               );
          
           return interaction.reply({ embeds: [embed], ephemeral: true });


           } catch (error) {
               console.error('Error fetching assignments:', error.response?.data || error.message);
               return interaction.reply({ content: 'Failed to fetch assignments.', ephemeral: true });
           }
       }
   }
