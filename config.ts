export const BOT = {
	TOKEN: 'df432bec2d87c3a7149e000dbb84299d7417bd6185e73477f3bdaa1fcf4e5aa2', // Bot token here
	CLIENT_ID: '1340018861654806588', // Client ID here
	NAME: 'Ian_Sage'// Bot Name. NEEDS TO BE LESS THAN 11 CHARACTERS
};

export const MONGO = '';

export const DB = {
	CONNECTION: 'mongodb+srv://connorbutsmaller:connorbutsage@cluster0.3ps8b.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0', // Mongo connection string here
	USERS: 'users',
	PVQ: 'pvQuestions',
	QTAGS: 'questionTags',
	ASSIGNABLE: 'assignable',
	COURSES: 'courses',
	REMINDERS: 'reminders',
	CLIENT_DATA: 'clientData',
	POLLS: 'polls',
	JOB_FORMS: 'jobForms'
};

export const GUILDS = { // Guild IDs for each guild
	MAIN: '1339665566373384233',
	GATEWAY: '1339665566373384233',
	GATEWAY_INVITE: '1339665566373384233'
};

export const ROLES = { // Role IDS for each role
	ADMIN: '',
	STUDENT_ADMIN: '',
	STAFF: '',
	VERIFIED: '',
	MUTED: '',
	LEVEL_ONE: ''
};

export const EMAIL = {
	SENDER: 'ianduffy@udel.edu', // The email address all emails should be sent from
	REPLY_TO: 'ianduffy@udel.edu', // The replyto address for all emails
	REPORT_ADDRESSES: [ // A list of all the email address to get the weekly report
		'ianduffy@udel.edu' // Add your email here
	]
};

export const CHANNELS = { // Channel IDs
	ERROR_LOG: '1339670678214934679',
	SERVER_LOG: '1339670734795964578',
	MEMBER_LOG: '1339670791855538227',
	MOD_LOG: '1339670814957764751',
	FEEDBACK: '1339670947325546628',
	SAGE: '1339670961951215678',
	ANNOUNCEMENTS: '1339670980087251065',
	ARCHIVE: '1339670989709115524',
	ROLE_SELECT: '1339670989709115524'
};

export const ROLE_DROPDOWNS = {
	COURSE_ROLES: '',
	ASSIGN_ROLES: ''
};

export const LEVEL_TIER_ROLES = [
	'',
	'',
	'',
	'',
	''
];

export const FIRST_LEVEL = 10;
export const GITHUB_TOKEN = '';
export const GITHUB_PROJECT = '';
export const PREFIX = 's;';
export const MAINTAINERS = 'Ian S25';// The current maintainers of this bot
export const SEMESTER_ID = '';// The current semester ID. i.e. s21
export const BLACKLIST = [];

export const APP_ID = ''; // Adzuna API app ID
export const APP_KEY = ''; // Adzuna API key
