import transport from './emailTransport.ts';
import supabaseAdmin from './supabaseAdmin.ts';

const MIN_LENGTH = 30; // Minutes

type Mtyp = {
	role: 'CREATOR' | 'ADMIN' | 'ADVISOR' | 'MEMBER';
	allow_notifications: boolean;
	users: {
		first_name: string;
		email: string;
		is_faculty: boolean;
	};
	organizations: { name: string };
};

type RoomMeta = {
	room_id: number;
	meeting_id: number;
};

const ERR_MEETING_TIME = 'Invalid meeting time or length.';
const ERR_MAX_ROOMS =
	'Due to high demand, only 5 future in-person meetings can be booked per club.';
const ERR_ROOM = 'Invalid meeting room.';
const ERR = 'Malformed request. Contact it@stuysu.org.';

export const getMeetingValidationError = async (
	start_time: string,
	end_time: string,
	room_id?: number,
	meeting_id?: number,
	organization_id?: number
) => {
	// Validate dates
	if (start_time === '' || end_time === '') {
		return ERR_MEETING_TIME;
	}

	const start = new Date(start_time);
	const end = new Date(end_time);
	if (
		Number.isNaN(start.getTime()) ||
		Number.isNaN(end.getTime()) || // Invalid timestamps
		start.getTime() < Date.now() || // Meeting starts in past
		end.getTime() - start.getTime() < MIN_LENGTH * 60 * 1000 // Meeting is too short (including "negative" length)
	) {
		return ERR_MEETING_TIME;
	}

	// Check room availability
	if (room_id !== undefined && room_id !== 0) {
		if (organization_id === undefined || organization_id === 0) {
			return ERR + ' (Code: BAD_ORG)';
		}

		const { data: organization, error: organizationFetchError } =
			await supabaseAdmin
				.from('organizations')
				.select('state')
				.eq('id', organization_id)
				.limit(1)
				.single();
		if (organizationFetchError) {
			console.log(organizationFetchError);
			return ERR + ' (Code: BAD_ORG_FETCH)';
		}

		if (organization.state !== 'ADMIN') {
			const now = new Date();
			const { data: pendingMeetings, error: pendingMeetingFetchError } =
				await supabaseAdmin
					.from('meetings')
					.select()
					.eq('organization_id', organization_id)
					.not('room_id', 'is', null)
					.neq('id', meeting_id ?? -1)
					.gte(
						'start_time',
						`${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`
					);
			// Failed to fetch
			if (pendingMeetingFetchError) {
				return ERR + ' (Code: BAD_PEND)';
			}

			if (pendingMeetings.length >= 5) {
				return ERR_MAX_ROOMS;
			}
		}

		const { data: meetings, error: meetingFetchError } = await supabaseAdmin
			.rpc('get_booked_rooms', {
				meeting_start: start_time,
				meeting_end: end_time,
			})
			.overrideTypes<RoomMeta[], { merge: false }>();

		// Failed to fetch
		if (meetingFetchError) {
			return ERR + '(Code: BAD_MEET)';
		}

		// Editing meeting, exclude the original meeting
		const filteredMeetings =
			meeting_id !== undefined && meeting_id !== 0
				? meetings.filter((meeting) => meeting.meeting_id !== meeting_id)
				: meetings;

		// Room is booked at that time
		if (filteredMeetings.some((meeting) => meeting.room_id === room_id)) {
			return ERR_ROOM;
		}

		// Check if room is available on that day of week
		const daysOfWeek = [
			'SUNDAY',
			'MONDAY',
			'TUESDAY',
			'WEDNESDAY',
			'THURSDAY',
			'FRIDAY',
			'SATURDAY',
		];
		const dayOfWeek = daysOfWeek[start.getDay()];

		const { data: roomData, error: roomFetchError } = await supabaseAdmin
			.from('rooms')
			.select('*')
			.eq('id', room_id)
			.limit(1)
			.single();
		// Failed to fetch
		if (roomFetchError) {
			return ERR;
		}

		if (!roomData.available_days.includes(dayOfWeek)) {
			return ERR_ROOM;
		}
	}

	return '';
};

export const sendOrgEmail = async (
	orgId: number,
	subject: string,
	text: string,
	shouldNotifyFaculty?: boolean,
	isOnlyAdmin?: boolean
) => {
	const { data: membershipsData, error: membershipsError } = await supabaseAdmin
		.from('memberships')
		.select(
			`
			id,
			role,
			users!inner (
				first_name,
				email,
				is_faculty
			),
			organizations!inner (
				name
			)
		`
		)
		.eq('organization_id', orgId);

	if (membershipsError !== null || (membershipsData?.length ?? 0) === 0) {
		console.log(
			`[sendOrgEmail] org=${orgId} no members or fetch error; err=${membershipsError ? (membershipsError.message ?? membershipsError) : 'none'}`
		);
		return;
	}

	const memberIds = membershipsData.map((membership) => membership.id);

	const { data: notificationsData, error: notificationsError } =
		await supabaseAdmin
			.from('membershipnotifications')
			.select('membership_id, allow_notifications')
			.in('membership_id', memberIds);

	if (notificationsError) {
		console.log(
			'[sendOrgEmail] Error fetching notifications.',
			notificationsError
		);
	}

	const notifications = notificationsData ?? [];

	const memberData: Mtyp[] = membershipsData.map((membership) => {
		const notification = notifications.find(
			(n) => n.membership_id === membership.id
		);
		return {
			...membership,
			allow_notifications: notification
				? notification.allow_notifications
				: true,
		};
	});

	const recipientEmails: string[] = [];
	const orgName = memberData[0].organizations.name;

	const roleStats: Record<string, number> = {};
	for (const m of memberData) {
		roleStats[m.role] = (roleStats[m.role] ?? 0) + 1;
	}

	for (const member of memberData) {
		// Do not notify faculty
		if (member.users.is_faculty && !shouldNotifyFaculty) {
			continue;
		}

		if (
			isOnlyAdmin &&
			(member.role === 'MEMBER' || member.role === 'ADVISOR')
		) {
			continue;
		}

		if (!member.allow_notifications) {
			continue;
		}

		recipientEmails.push(member.users.email);
	}

	// eslint-disable-next-line unicorn/no-unsafe-string-replacement
	subject = subject.replaceAll('{ORG_NAME}', orgName);
	// eslint-disable-next-line unicorn/no-unsafe-string-replacement
	text = text.replaceAll('{ORG_NAME}', orgName);

	if (recipientEmails.length > 0) {
		try {
			await transport.sendMail({
				from: Deno.env.get('NODEMAILER_FROM')!,
				bcc: recipientEmails,
				subject,
				text,
			});
		} catch (error) {
			console.error(
				'[sendOrgEmail] sendMail failed',
				(error as Error)?.message ?? error
			);
		}
	}
};

export const sendMemberEmail = async (
	memberId: number,
	subject: string,
	text: string
) => {
	const { data: membershipsData, error: membershipsError } = await supabaseAdmin
		.from('memberships')
		.select(
			`
			id,
			role,
			users!inner (
				first_name,
				email,
				is_faculty
			),
			organizations!inner (
				name
			)
		`
		)
		.eq('id', memberId);

	if (membershipsError !== null || (membershipsData?.length ?? 0) === 0) {
		console.log('Error fetching members.');
		return;
	}

	const memberIds = membershipsData.map((membership) => membership.id);

	const { data: notificationsData, error: notificationsError } =
		await supabaseAdmin
			.from('membershipnotifications')
			.select('membership_id, allow_notifications')
			.in('membership_id', memberIds);

	if (notificationsError !== null || (notificationsData?.length ?? 0) === 0) {
		console.log('Error fetching notifications.');
		return;
	}

	const memberData = membershipsData.map((membership) => {
		const notification = notificationsData.find(
			(n) => n.membership_id === membership.id
		);
		return {
			...membership,
			allow_notifications: notification
				? notification.allow_notifications
				: true,
		};
	});

	if (!memberData[0].allow_notifications) {
		return;
	}

	// eslint-disable-next-line unicorn/no-unsafe-string-replacement
	subject = subject.replaceAll('{ORG_NAME}', memberData[0].organizations.name);
	// eslint-disable-next-line unicorn/no-unsafe-string-replacement
	text = text.replaceAll('{ORG_NAME}', memberData[0].organizations.name);

	// eslint-disable-next-line unicorn/no-unsafe-string-replacement
	subject = subject.replaceAll('{FIRST_NAME}', memberData[0].users.first_name);
	// eslint-disable-next-line unicorn/no-unsafe-string-replacement
	text = text.replaceAll('{FIRST_NAME}', memberData[0].users.first_name);

	await transport.sendMail({
		from: Deno.env.get('NODEMAILER_FROM')!,
		to: memberData[0].users.email,
		subject,
		text,
	});
};

export const fetchMemberRequirement = async () => {
	type SettingType = {
		setting_value: number;
	};
	const { data } = await supabaseAdmin
		.from('settings')
		.select(
			`
				setting_value
			`
		)
		.eq('name', 'required_members')
		.single()
		.overrideTypes<SettingType, { merge: false }>();
	return data?.setting_value ?? 0;
};

export const safeSupabaseQuery = async <T>(
	clientPromise: PromiseLike<{ data: T | null | undefined; error: unknown }>
) => {
	const { data, error } = await clientPromise;
	if (error !== undefined && error !== null) {
		throw error instanceof Error
			? error
			: new Error(typeof error === 'string' ? error : 'Unknown error');
	}

	return data;
};

export const nyISO = (dateInput?: Date | string | number): string => {
	const currentDate =
		dateInput !== undefined && dateInput !== null
			? new Date(dateInput)
			: new Date();
	const nyDateFormatter = new Intl.DateTimeFormat('en-US', {
		timeZone: 'America/New_York',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hourCycle: 'h23',
	});
	const dateFormatterParts = nyDateFormatter.formatToParts(currentDate);
	const getDateFormatterValue = (formatterPartType: string): string => {
		const formatterPartValue = dateFormatterParts.find(
			(dateFormatterPart) => dateFormatterPart.type === formatterPartType
		);
		return formatterPartValue ? formatterPartValue.value : '';
	};

	return `${getDateFormatterValue('year')}-${getDateFormatterValue('month')}-${getDateFormatterValue('day')}T${getDateFormatterValue('hour')}:${getDateFormatterValue('minute')}:${getDateFormatterValue('second')}`;
};
