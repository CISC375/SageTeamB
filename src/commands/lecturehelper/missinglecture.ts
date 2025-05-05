import {
	SlashCommandBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	EmbedBuilder,
	ChatInputCommandInteraction,
	ButtonInteraction,
	ApplicationCommandOptionData,
	ApplicationCommandOptionType,
	StringSelectMenuBuilder,
	StringSelectMenuInteraction,
	Client,
	Interaction,
	AttachmentBuilder
} from 'discord.js';
import axios from 'axios';
import { format, isSameDay } from 'date-fns';
import ical from 'ical-generator';
import { CANVAS } from '@root/config';
import { Command } from '@lib/types/Command';
import { getUserCanvasToken } from './authenticatecanvas';

async function getCourseFiles(courseId: string, token: string) {
	const response = await axios.get(`${CANVAS.BASE_URL}/courses/${courseId}/files`, {
		headers: { Authorization: `Bearer ${token}` }
	});
	return response.data;
}

async function getInstructorOfficeHours(courseId: string, token: string): Promise<any[]> {
	try {
		// Track if all methods failed with 403 errors
		const allMethodsFailedWith403 = true;
		let hasAnySuccess = false;

		// 1. Try to get from instructor profiles
		const profileOfficeHours = await getOfficeHoursFromProfiles(courseId, token);
		if (profileOfficeHours.length > 0) {
			hasAnySuccess = true;
		}

		// 2. Try to get from syllabus page
		const syllabusOfficeHours = await getOfficeHoursFromSyllabus(courseId, token);
		if (syllabusOfficeHours.length > 0) {
			hasAnySuccess = true;
		}

		// 3. Try to get from syllabus files
		const syllabusFileOfficeHours = await getOfficeHoursFromSyllabusFiles(courseId, token);
		if (syllabusFileOfficeHours.length > 0) {
			hasAnySuccess = true;
		}

		// 4. Try to get from course settings/description
		const courseOfficeHours = await getOfficeHoursFromCourse(courseId, token);
		if (courseOfficeHours.length > 0) {
			hasAnySuccess = true;
		}

		// Combine all results
		const officeHoursData = [
			...profileOfficeHours,
			...syllabusOfficeHours,
			...syllabusFileOfficeHours,
			...courseOfficeHours
		];

		// Remove duplicates based on instructor name
		const uniqueOfficeHours = [];
		const seenInstructors = new Set();

		for (const data of officeHoursData) {
			if (!seenInstructors.has(data.instructor)) {
				seenInstructors.add(data.instructor);
				uniqueOfficeHours.push(data);
			}
		}

		// If we have any results, return them
		if (uniqueOfficeHours.length > 0) {
			return uniqueOfficeHours;
		}

		// If we have no results but had some success (not all 403), return empty array
		if (hasAnySuccess) {
			return [];
		}

		// If we got here, all methods likely failed with 403 errors
		// Return a special object to indicate permission issues
		return [{
			instructor: 'PERMISSION_ERROR',
			officeHours: 'Your instructor has not given permission for this command to access their office hours. Please check Canvas directly.',
			courseUrl: `https://udel.instructure.com/courses/${courseId}`
		}];
	} catch (error) {
		console.error('Error fetching office hours from multiple sources:', error.message);
		return [];
	}
}

async function getOfficeHoursFromProfiles(courseId: string, token: string): Promise<any[]> {
	try {
		// Fetch users in the course with teacher role
		const usersResponse = await axios.get(`${CANVAS.BASE_URL}/courses/${courseId}/users?enrollment_type[]=teacher`, {
			headers: { Authorization: `Bearer ${token}` }
		});

		const instructors = usersResponse.data;
		const officeHoursData = [];

		for (const instructor of instructors) {
			try {
				// Try to get office hours from user profile
				const profileResponse = await axios.get(`${CANVAS.BASE_URL}/users/${instructor.id}/profile`, {
					headers: { Authorization: `Bearer ${token}` }
				});

				// Look for office hours in profile data
				const officeHours = profileResponse.data.office_hours
					|| profileResponse.data.custom_fields?.find((field: any) => field.name === 'office_hours')?.value
					|| profileResponse.data.bio?.match(/office\s+hours:?\s*([^<]+)/i)?.[1]?.trim();

				if (officeHours) {
					officeHoursData.push({
						instructor: instructor.name,
						officeHours: officeHours
					});
				}
			} catch (error) {
				console.warn(`Could not fetch office hours for instructor ${instructor.name}:`, error.message);
			}
		}

		return officeHoursData;
	} catch (error) {
		console.error('Error fetching instructor profiles:', error.message);
		return [];
	}
}

async function getOfficeHoursFromSyllabus(courseId: string, token: string): Promise<any[]> {
	try {
		// First, try to get the syllabus page directly
		try {
			const response = await axios.get(`${CANVAS.BASE_URL}/courses/${courseId}/front_page`, {
				headers: { Authorization: `Bearer ${token}` }
			});

			const syllabusContent = response.data.body;

			// Process the syllabus content
			const officeHours = processSyllabusContent(syllabusContent);
			if (officeHours.length > 0) {
				return officeHours;
			}
		} catch (error) {
			// If we get a 404, the syllabus might be in a module
			if (error.response && error.response.status === 404) {
				console.log(`No direct syllabus page found for course ${courseId}, checking modules...`);
			} else {
				console.warn('Error fetching syllabus page:', error.message);
			}
		}

		// If direct syllabus page didn't work, try to find syllabus in modules
		try {
			// Get all modules in the course
			const modulesResponse = await axios.get(`${CANVAS.BASE_URL}/courses/${courseId}/modules`, {
				headers: { Authorization: `Bearer ${token}` }
			});

			const modules = modulesResponse.data;

			// Look for syllabus in modules
			for (const module of modules) {
				// Get module items
				const moduleItemsResponse = await axios.get(`${CANVAS.BASE_URL}/courses/${courseId}/modules/${module.id}/items`, {
					headers: { Authorization: `Bearer ${token}` }
				});

				const moduleItems = moduleItemsResponse.data;

				// Look for syllabus items
				const syllabusItems = moduleItems.filter(item =>
					item.type === 'Page'
					&& (item.title.toLowerCase().includes('syllabus')
						|| item.title.toLowerCase().includes('course outline')
						|| item.title.toLowerCase().includes('course information'))
				);

				// Process each syllabus item
				for (const item of syllabusItems) {
					try {
						// Get the page content
						const pageResponse = await axios.get(`${CANVAS.BASE_URL}/courses/${courseId}/pages/${item.page_url}`, {
							headers: { Authorization: `Bearer ${token}` }
						});

						const pageContent = pageResponse.data.body;

						// Process the page content
						const officeHours = processSyllabusContent(pageContent);
						if (officeHours.length > 0) {
							return officeHours;
						}
					} catch (error) {
						console.warn(`Error fetching module syllabus page ${item.title}:`, error.message);
					}
				}
			}
		} catch (error) {
			console.warn('Error fetching modules:', error.message);
		}

		return [];
	} catch (error) {
		console.warn('Error in getOfficeHoursFromSyllabus:', error.message);
		return [];
	}
}

// Helper function to process syllabus content and extract office hours
function processSyllabusContent(content: string): any[] {
	try {
		// First, clean up the HTML content
		const cleanContent = content
			.replace(/<[^>]+>/g, '\n') // Replace HTML tags with newlines
			.replace(/&nbsp;/g, ' ') // Replace &nbsp; with spaces
			.replace(/\n\s*\n/g, '\n') // Remove multiple blank lines
			.trim();

		// Split content into sections by double newlines
		const sections = cleanContent.split(/\n\s*\n/);
		const staffMembers = [];

		for (const section of sections) {
			// Skip empty sections
			if (!section.trim()) continue;

			// Look for instructor information
			const instructorMatch = section.match(/(?:•|\*|\-)\s*([^(\n]+)(?:\s*\(([^)]+)\))?/);
			if (instructorMatch) {
				const name = instructorMatch[1].trim();
				const role = instructorMatch[2]?.trim() || '';

				// Extract office hours lines
				const lines = section.split('\n');
				const officeHoursLines = [];
				let location = '';
				let email = '';

				for (const line of lines) {
					const trimmedLine = line.trim();

					// Skip empty lines or the instructor name line
					if (!trimmedLine || trimmedLine.startsWith('•') || trimmedLine.startsWith('*') || trimmedLine.startsWith('-')) continue;

					// Look for office hours
					if (trimmedLine.match(/(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday):/i)) {
						officeHoursLines.push(trimmedLine);
					}
					// Look for location
					else if (trimmedLine.match(/(?:in|at|room)\s+/i)) {
						location = trimmedLine.replace(/(?:in|at|room)\s+/i, '').trim();
					}
					// Look for email
					else if (trimmedLine.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)) {
						email = trimmedLine.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)[0];
					}
				}

				if (officeHoursLines.length > 0) {
					staffMembers.push({
						instructor: `${name}${role ? ` (${role})` : ''}`,
						officeHours: officeHoursLines.join('\n'),
						location: location,
						email: email
					});
				}
			}
		}

		return staffMembers;
	} catch (error) {
		console.error('Error processing syllabus content:', error);
		return [];
	}
}

async function getOfficeHoursFromSyllabusFiles(courseId: string, token: string): Promise<any[]> {
	try {
		// Get all files in the course
		const files = await getCourseFiles(courseId, token);

		// Filter for syllabus-like files
		const syllabusKeywords = ['syllabus', 'course outline', 'course information', 'course details'];
		const syllabusFiles = files.filter(file =>
			syllabusKeywords.some(keyword =>
				file.display_name.toLowerCase().includes(keyword)
			)
		);

		if (syllabusFiles.length === 0) {
			return [];
		}

		console.log(`Found ${syllabusFiles.length} syllabus files to check for office hours`);

		// Try to get office hours from each syllabus file
		for (const file of syllabusFiles) {
			try {
				// Get the file content
				const fileUrl = file.url;
				const response = await axios.get(fileUrl, {
					headers: { Authorization: `Bearer ${token}` },
					responseType: 'text'
				});

				const fileContent = response.data;

				// Look for office hours in the file content
				// First, try to find the office hours section
				const officeHoursSectionRegex = /office\s+hours:?\s*([^<]+)/i;
				const match = fileContent.match(officeHoursSectionRegex);

				if (match) {
					// Extract the office hours text
					const officeHoursText = match[1].trim();

					// Check if it contains multiple staff members
					if (officeHoursText.includes('Email:')) {
						// Split by staff members (look for name followed by "Office Hours:")
						const staffSections = officeHoursText.split(/(?=[A-Za-z\s]+\([^)]+\)\s*Office\s+Hours:)/);

						const results = [];

						for (const section of staffSections) {
							if (!section.trim()) continue;

							// Extract staff name and role
							const nameMatch = section.match(/([A-Za-z\s]+)\(([^)]+)\)/);
							if (!nameMatch) continue;

							const staffName = nameMatch[1].trim();
							const staffRole = nameMatch[2].trim();

							// Extract office hours for this staff member
							const hoursMatch = section.match(/Office\s+Hours:\s*([^E]+)/i);
							if (!hoursMatch) continue;

							const hoursText = hoursMatch[1].trim();

							results.push({
								instructor: `${staffName} (${staffRole})`,
								officeHours: hoursText
							});
						}

						if (results.length > 0) {
							return results;
						}
					}

					// If we couldn't parse it as multiple staff members, return it as a single entry
					return [{
						instructor: 'Course Instructor',
						officeHours: officeHoursText
					}];
				}

				// If the above didn't work, try a more comprehensive approach
				// Look for patterns like "Name (Role) Office Hours: Day: Time"
				const staffOfficeHoursRegex = /([A-Za-z\s]+)\(([^)]+)\)\s*Office\s+Hours:\s*([^<]+?)(?=[A-Za-z\s]+\([^)]+\)\s*Office\s+Hours:|Email:|$)/gis;
				const staffMatches = [...fileContent.matchAll(staffOfficeHoursRegex)];

				if (staffMatches.length > 0) {
					return staffMatches.map(match => ({
						instructor: `${match[1].trim()} (${match[2].trim()})`,
						officeHours: match[3].trim()
					}));
				}

				// If we still haven't found office hours, try a more generic approach
				// Look for patterns like "Day: Time-Time"
				const dayTimeRegex = /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday):\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})([ap]m)?/gi;
				const dayTimeMatches = [...fileContent.matchAll(dayTimeRegex)];

				if (dayTimeMatches.length > 0) {
					const officeHoursText = dayTimeMatches.map(match =>
						`${match[1]}: ${match[2]}-${match[3]}${match[4] || ''}`
					).join('\n');

					return [{
						instructor: 'Course Instructor',
						officeHours: officeHoursText
					}];
				}
			} catch (error) {
				console.warn(`Error processing syllabus file ${file.display_name}:`, error.message);
			}
		}

		return [];
	} catch (error) {
		console.warn('Error fetching office hours from syllabus files:', error.message);
		return [];
	}
}

async function getOfficeHoursFromCourse(courseId: string, token: string): Promise<any[]> {
	try {
		// Get course details
		const courseResponse = await axios.get(`${CANVAS.BASE_URL}/courses/${courseId}`, {
			headers: { Authorization: `Bearer ${token}` }
		});

		const courseDescription = courseResponse.data.description || '';
		const courseName = courseResponse.data.name || '';

		// Try to extract instructor name from course name (common format: "COURSE NAME - INSTRUCTOR NAME")
		const instructorNameMatch = courseName.match(/\s*-\s*([^-]+)$/);
		const instructorName = instructorNameMatch ? instructorNameMatch[1].trim() : 'Course Instructor';

		// Look for office hours in course description
		const officeHoursRegex = /office\s+hours:?\s*([^<]+)/i;
		const match = courseDescription.match(officeHoursRegex);

		if (match) {
			return [{
				instructor: instructorName,
				officeHours: match[1].trim()
			}];
		}

		// If no office hours found in description, try to get from course settings
		try {
			const settingsResponse = await axios.get(`${CANVAS.BASE_URL}/courses/${courseId}/settings`, {
				headers: { Authorization: `Bearer ${token}` }
			});

			const courseSettings = settingsResponse.data;

			// Check if there's a custom field for office hours
			if (courseSettings.custom_fields && courseSettings.custom_fields.length > 0) {
				const officeHoursField = courseSettings.custom_fields.find(
					(field: any) => field.name.toLowerCase().includes('office') && field.name.toLowerCase().includes('hours')
				);

				if (officeHoursField && officeHoursField.value) {
					return [{
						instructor: instructorName,
						officeHours: officeHoursField.value
					}];
				}
			}
		} catch (error) {
			console.warn('Error fetching course settings:', error.message);
		}

		return [];
	} catch (error) {
		console.warn('Error fetching course description:', error.message);
		return [];
	}
}

function isLectureFile(file: any) {
	const lectureKeywords = ['lecture', 'slides', 'notes', 'ppt', 'class'];
	return lectureKeywords.some((keyword) => file.display_name.toLowerCase().includes(keyword));
}

function getFileDate(file: any) {
	return new Date(file.created_at);
}

async function getAllFolders(courseId: string, token: string): Promise<any[]> {
	const allFolders: any[] = [];
	let page = 1;
	while (true) {
		const response = await axios.get(
			`${CANVAS.BASE_URL}/courses/${courseId}/folders?page=${page}&per_page=100`,
			{
				headers: { Authorization: `Bearer ${token}` }
			}
		);
		const folders = response.data;
		if (!folders || folders.length === 0) break;
		allFolders.push(...folders);
		page++;
	}
	return allFolders;
}

function getFileIcon(filename: string): string {
	const ext = filename.split('.').pop()?.toLowerCase();
	switch (ext) {
		case 'pdf': return '📄';
		case 'doc':
		case 'docx': return '📝';
		case 'ppt':
		case 'pptx': return '📊';
		case 'xls':
		case 'xlsx': return '📈';
		case 'zip':
		case 'rar': return '🗜️';
		case 'jpg':
		case 'jpeg':
		case 'png':
		case 'gif': return '🖼️';
		default: return '📁';
	}
}

function formatFileSize(bytes: number): string {
	const sizes = ['B', 'KB', 'MB', 'GB'];
	if (bytes === 0) return '0 B';
	const i = Math.floor(Math.log(bytes) / Math.log(1024));
	const size = (bytes / Math.pow(1024, i)).toFixed(1);
	return `${size} ${sizes[i]}`;
}

function parseOfficeHours(officeHoursText: string): { day: string; startTime: Date; endTime: Date; location?: string }[] {
	const events: { day: string; startTime: Date; endTime: Date; location?: string }[] = [];

	// Split by newlines to handle multiple days
	const lines = officeHoursText.split('\n').map(line => line.trim()).filter(line => line);

	for (const line of lines) {
		// Match day and time patterns
		const dayMatch = line.match(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)s?:?\s*/i);
		if (!dayMatch) continue;

		const day = dayMatch[1];
		const timeText = line.slice(dayMatch[0].length);

		// Match time patterns (handle various formats)
		const timePatterns = [
			// Pattern 1: 11:30am - 12:30pm
			/(\d{1,2}(?::\d{2})?)\s*(?:am|pm)?\s*(?:-|to)\s*(\d{1,2}(?::\d{2})?)\s*(?:am|pm)/i,
			// Pattern 2: 11:30-12:30pm
			/(\d{1,2}(?::\d{2})?)\s*(?:-|to)\s*(\d{1,2}(?::\d{2})?)\s*(?:am|pm)/i,
			// Pattern 3: 11:30 - 12:30
			/(\d{1,2}(?::\d{2})?)\s*(?:-|to)\s*(\d{1,2}(?::\d{2})?)/i
		];

		for (const pattern of timePatterns) {
			const timeMatch = timeText.match(pattern);
			if (timeMatch) {
				const [_, startStr, endStr] = timeMatch;

				// Parse start and end times
				const startParts = startStr.split(':').map(Number);
				const endParts = endStr.split(':').map(Number);

				let startHour = startParts[0];
				const startMinute = startParts[1] || 0;
				let endHour = endParts[0];
				const endMinute = endParts[1] || 0;

				// Check if PM is explicitly mentioned
				const isPM = timeText.toLowerCase().includes('pm');
				const isAM = timeText.toLowerCase().includes('am');

				// Function to determine if a time is likely PM
				const isLikelyPM = (hour: number) =>
					// Times between 1:00 and 8:00 are likely PM for office hours
					// 9:00-11:00 could be AM, 12:00 is handled specially
					hour >= 1 && hour <= 8
					;

				// If no AM/PM specified, make intelligent assumptions
				if (!isPM && !isAM) {
					// If either time is likely PM, convert both to PM
					if (isLikelyPM(startHour) || isLikelyPM(endHour)) {
						if (startHour !== 12 && startHour <= 8) startHour += 12;
						if (endHour !== 12 && endHour <= 8) endHour += 12;
					}
					// Special case: if end time is 12 and start time is PM, keep 12 as is
					else if (endHour === 12 && startHour > 12) {
						// Keep endHour as 12
					}
					// If times are sequential and make sense (e.g., 9-11, 10-12), assume AM
					else if (startHour >= 9 && startHour < 12 && endHour > startHour && endHour <= 12) {
						// Keep as AM
					}
					// For any other ambiguous cases where end time would be before start time
					else if (endHour <= startHour) {
						if (endHour !== 12) endHour += 12;
						if (startHour < endHour - 12) startHour += 12;
					}
				} else {
					// Handle explicit AM/PM cases
					if (isPM) {
						// Convert end time to PM if it's not 12
						if (endHour !== 12) endHour += 12;
						// Convert start time to PM if it would make sense
						if (startHour !== 12 && startHour < endHour - 12) startHour += 12;
					}
					if (isAM) {
						// Handle 12 AM cases
						if (startHour === 12) startHour = 0;
						if (endHour === 12) endHour = 0;
					}
				}

				// Create Date objects for start and end times
				const today = new Date();
				const dayIndex = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
					.findIndex(d => d.toLowerCase() === day.toLowerCase());

				if (dayIndex !== -1) {
					// Get the current day of the week
					const currentDayIndex = today.getDay();

					// Calculate the difference in days to get to the target day
					const daysToAdd = (dayIndex - currentDayIndex + 7) % 7;

					// Create new date objects for this specific day
					const startTime = new Date(today);
					startTime.setDate(today.getDate() + daysToAdd);
					startTime.setHours(startHour, startMinute, 0, 0);

					const endTime = new Date(today);
					endTime.setDate(today.getDate() + daysToAdd);
					endTime.setHours(endHour, endMinute, 0, 0);

					// Extract location if present
					const locationMatch = line.match(/(?:in|at|room)\s+([^,]+)/i);
					const location = locationMatch ? locationMatch[1].trim() : undefined;

					events.push({
						day,
						startTime,
						endTime,
						location
					});
				}
				break;
			}
		}
	}

	return events;
}

// Helper function to expand day abbreviations
function expandDayAbbrev(abbrev: string): string {
	const dayMap: Record<string, string> = {
		Mon: 'Monday',
		Tue: 'Tuesday',
		Wed: 'Wednesday',
		Thu: 'Thursday',
		Fri: 'Friday',
		Sat: 'Saturday',
		Sun: 'Sunday'
	};

	return dayMap[abbrev] || abbrev;
}

// Helper function to parse time string (e.g., "9:00 AM")
function parseTime(timeStr: string): [number, number, string] {
	const match = timeStr.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
	if (match) {
		const [_, hours, minutes, period] = match;
		let hour = parseInt(hours);

		// Convert to 24-hour format
		if (period.toUpperCase() === 'PM' && hour < 12) {
			hour += 12;
		} else if (period.toUpperCase() === 'AM' && hour === 12) {
			hour = 0;
		}

		return [hour, parseInt(minutes), period.toUpperCase()];
	}

	// Default to current time if parsing fails
	const now = new Date();
	return [now.getHours(), now.getMinutes(), now.getHours() >= 12 ? 'PM' : 'AM'];
}

// Helper function to parse simple time string (e.g., "9:00")
function parseTimeSimple(timeStr: string): [number, number] {
	const match = timeStr.match(/(\d{1,2}):(\d{2})/);
	if (match) {
		const [_, hours, minutes] = match;
		return [parseInt(hours), parseInt(minutes)];
	}

	// Default to current time if parsing fails
	const now = new Date();
	return [now.getHours(), now.getMinutes()];
}

export default class extends Command {

	description = 'Retrieve notes, recordings, and homework related to a missed lecture date';
	runInDM?: true;
	runInGuild?: boolean = true;

	options: ApplicationCommandOptionData[] = [
		{
			name: 'date',
			description: 'Date of the missed lecture (YYYY-MM-DD)',
			type: ApplicationCommandOptionType.String,
			required: true
		}
	];

	async run(interaction: ChatInputCommandInteraction): Promise<void> {
		const canvasToken = await getUserCanvasToken(interaction.client.mongo, interaction.user.id);
		if (!canvasToken) {
			await interaction.reply({ content: 'You need to authenticate your Canvas account first, call /authenticatecanvas.', ephemeral: true });
			return;
		}
		const baseUrl = `${CANVAS.BASE_URL}/courses?page=1&per_page=100&enrollment_state=active`;
		const missedDateString = interaction.options.getString('date', true);

		let missedDate: Date;
		try {
			missedDate = new Date(missedDateString);
			if (isNaN(missedDate.getTime())) throw new Error();
		} catch {
			await interaction.reply({ content: 'Invalid date format. Please use YYYY-MM-DD.', ephemeral: true });
			return;
		}

		await interaction.deferReply();

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
				value: `${course.id}::${missedDateString}`
			}));

			const selectMenu = new StringSelectMenuBuilder()
				.setCustomId('missinglecture_select')
				.setPlaceholder('Select a course')
				.addOptions(courseOptions);

			const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
			await interaction.editReply({ content: 'Select a course:', components: [row] });

			setupMissingLectureHandler(interaction.client);
		} catch (error) {
			console.error('Error fetching courses:', error.response ? error.response.data : error.message);
			await interaction.editReply({ content: 'Failed to fetch courses.' });
		}
	}

}

export function setupMissingLectureHandler(client: Client) {
	client.on('interactionCreate', async (interaction: Interaction) => {
		if (interaction.isStringSelectMenu() && interaction.customId === 'missinglecture_select') {
			const [courseId, dateStr] = interaction.values[0].split('::');
			const canvasToken = await getUserCanvasToken(interaction.client.mongo, interaction.user.id);

			const lectureDate = new Date(dateStr);
			const weekStart = new Date(lectureDate);
			weekStart.setDate(weekStart.getDate() - weekStart.getDay());
			weekStart.setHours(0, 0, 0, 0);

			const weekEnd = new Date(weekStart);
			weekEnd.setDate(weekStart.getDate() + 6);
			weekEnd.setHours(23, 59, 59, 999);

			try {
				await interaction.deferReply();
			} catch (error) {
				console.error('Error deferring reply:', error);
				// If we can't defer, try to reply directly
				try {
					await interaction.reply({ content: 'Processing your request...', flags: [1 << 6] });
				} catch (e) {
					console.error('Failed to reply to interaction:', e);
				}
				return;
			}

			try {
				// Fetch all folders
				const folders = await getAllFolders(courseId, canvasToken);

				const matchedFiles = [];

				for (const folder of folders) {
					const filesUrl = `${CANVAS.BASE_URL}/folders/${folder.id}/files`;
					try {
						const filesResponse = await axios.get(filesUrl, {
							headers: { Authorization: `Bearer ${canvasToken}` }
						});
						const files = filesResponse.data;
						const filtered = files.filter(file => {
							const fileDate = new Date(file.created_at);
							return fileDate >= weekStart && fileDate <= weekEnd;
						});
						matchedFiles.push(...filtered);
					} catch (error) {
						console.warn(`Skipped folder ${folder.name}`, error.message);
					}
				}

				matchedFiles.sort((a, b) => a.display_name.localeCompare(b.display_name));

				const notes = matchedFiles.filter(file => file.display_name.toLowerCase().includes('note'));
				const recordings = matchedFiles.filter(file => /zoom|recording|video/i.test(file.display_name.toLowerCase()));
				const homework = matchedFiles.filter(file =>
					/hw|homework|assignment/i.test(file.display_name.toLowerCase())
				);

				const formatList = (arr: any[]) =>
					arr
						.map((file, i) =>
							`(${i + 1} of ${arr.length}) ${getFileIcon(file.display_name)} [${file.display_name}](${file.url}) (${formatFileSize(file.size)})`
						)
						.join('\n') || 'None found';

				// Fetch weekly assignments
				const assignmentsRes = await axios.get(`${CANVAS.BASE_URL}/courses/${courseId}/assignments`, {
					headers: { Authorization: `Bearer ${canvasToken}` }
				});
				const assignments = assignmentsRes.data.filter((a: any) => a.due_at || a.created_at);

				const weeklyAssignments = assignments.filter((a: any) => {
					// Check if assignment is due during the week
					const dueDate = a.due_at ? new Date(a.due_at) : null;
					const isDueThisWeek = dueDate && dueDate >= weekStart && dueDate <= weekEnd;

					// Check if assignment was created during the week
					const createdDate = a.created_at ? new Date(a.created_at) : null;
					const isCreatedThisWeek = createdDate && createdDate >= weekStart && createdDate <= weekEnd;

					// Include if either due or created during the week
					return isDueThisWeek || isCreatedThisWeek;
				});

				let assignmentList = 'None found';
				if (weeklyAssignments.length > 0) {
					assignmentList = weeklyAssignments
						.map(
							(a, i) =>
								`(${i + 1} of ${weeklyAssignments.length}) 🔗 [${a.name}](${a.html_url}) (Due: <t:${Math.floor(
									new Date(a.due_at).getTime() / 1000
								)}:F>)`
						)
						.join('\n');
				}

				// Final embed
				const embed = new EmbedBuilder()
					.setTitle(`Assignments & Files for the week of ${dateStr}:`)
					.setColor('#3498db')
					.addFields(
						{ name: '📌 Assignments Due This Week:', value: assignmentList },
						{ name: '📝 Notes:', value: formatList(notes) },
						{ name: '🎥 Recordings:', value: formatList(recordings) },
						{ name: '📚 Homework:', value: formatList(homework) }
					);

				// Create a button for adding office hours to calendar
				const calendarButton = new ButtonBuilder()
					.setCustomId(`calendar_${courseId}_${dateStr}`)
					.setLabel('Add Office Hours to Calendar')
					.setStyle(ButtonStyle.Primary)
					.setEmoji('📅');

				const buttonRow = new ActionRowBuilder<ButtonBuilder>()
					.addComponents(calendarButton);

				await interaction.editReply({ embeds: [embed], components: [buttonRow] });
			} catch (error) {
				console.error('Error fetching files/assignments:', error.response ? error.response.data : error.message);
				try {
					await interaction.editReply({ content: 'Something went wrong while retrieving data.' });
				} catch (e) {
					console.error('Failed to edit reply:', e);
				}
			}
		}

		// Handle calendar button clicks
		if (interaction.isButton() && interaction.customId.startsWith('calendar_')) {
			await handleCalendarButtonClick(interaction);
		}
	});
}

export async function handleCalendarButtonClick(interaction: ButtonInteraction) {
	const [, courseId, dateStr] = interaction.customId.split('_');
	const token = await getUserCanvasToken(interaction.client.mongo, interaction.user.id);

	try {
		await interaction.deferReply();
	} catch (error) {
		console.error('Error deferring reply for calendar button:', error);
		try {
			await interaction.reply({ content: 'Processing your request...' });
		} catch (e) {
			console.error('Failed to reply to calendar button interaction:', e);
		}
		return;
	}

	const officeHours = await getInstructorOfficeHours(courseId, token);

	if (officeHours.length === 0) {
		try {
			await interaction.editReply({ content: 'No instructor office hours found for this course.' });
		} catch (error) {
			console.error('Failed to edit reply for no office hours:', error);
		}
		return;
	}

	// Check if we got a permission error
	if (officeHours.length === 1 && officeHours[0].instructor === 'PERMISSION_ERROR') {
		try {
			await interaction.editReply({
				content: `${officeHours[0].officeHours} [View Course](${officeHours[0].courseUrl})`
			});
		} catch (error) {
			console.error('Failed to edit reply for permission error:', error);
		}
		return;
	}

	const calendar = ical({ name: `Office Hours for ${dateStr}` });

	// Parse the date string to get the target date
	const targetDate = new Date(dateStr);

	// Calculate the start of the week (Sunday)
	const weekStart = new Date(targetDate);
	weekStart.setDate(targetDate.getDate() - targetDate.getDay());
	weekStart.setHours(0, 0, 0, 0);

	// Calculate the end of the week (Saturday)
	const weekEnd = new Date(weekStart);
	weekEnd.setDate(weekStart.getDate() + 6);
	weekEnd.setHours(23, 59, 59, 999);

	let eventsCreated = false;

	for (const instructor of officeHours) {
		// Parse the office hours string to get actual times for the target week
		const parsedSlots = parseOfficeHours(instructor.officeHours);

		if (parsedSlots.length > 0) {
			// Use the parsed slots to create events
			for (const slot of parsedSlots) {
				// Only add events that fall within the target week
				if (slot.startTime >= weekStart && slot.startTime <= weekEnd) {
					eventsCreated = true;
					calendar.createEvent({
						start: slot.startTime,
						end: slot.endTime,
						summary: `Office Hours: ${instructor.instructor}`,
						description: `${instructor.officeHours}${instructor.email ? `\n\nEmail: ${instructor.email}` : ''}`,
						location: slot.location || instructor.location || 'Check bio or Canvas'
					});
				}
			}
		}
	}

	if (!eventsCreated) {
		try {
			await interaction.editReply({
				content: `No office hours found for the week of ${dateStr}. Please check Canvas or contact your instructor directly.`
			});
			return;
		} catch (error) {
			console.error('Failed to send no events message:', error);
			return;
		}
	}

	// Create a proper calendar file download
	const calendarData = calendar.toString();
	const buffer = Buffer.from(calendarData, 'utf8');

	// Create a file attachment
	const attachment = new AttachmentBuilder(buffer, { name: `office_hours_${dateStr}.ics` });

	try {
		await interaction.editReply({
			content: `🗓️ Here's your office hours calendar for the week of ${dateStr}. Click the file below to download it.`,
			files: [attachment]
		});
	} catch (error) {
		console.error('Failed to send calendar file:', error);
		try {
			await interaction.editReply({
				content: `🗓️ Here's your office hours calendar for the week of ${dateStr}. You can copy this data and save it as a .ics file:\n\`\`\`\n${calendarData}\n\`\`\``
			});
		} catch (e) {
			console.error('Failed to send fallback calendar data:', e);
		}
	}
}
