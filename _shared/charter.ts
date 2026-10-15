type Rule = {
    label: string;
    required?: boolean;
    minChar?: number;
    maxChar?: number;
    minWords?: number;
    maxWords?: number;
    pattern?: RegExp;
    patternMessage?: string;
};

const RULES: { [field: string]: Rule } = {
    name: {
        label: 'Name',
        required: true,
        minChar: 3,
        maxChar: 60,
        pattern: /^[a-z0-9\- ]+$/i,
        patternMessage: 'can only have letters, numbers, spaces and dashes',
    },
    url: {
        label: 'URL',
        required: true,
        minChar: 3,
        maxChar: 40,
        pattern: /^[a-z0-9_-]+$/,
        patternMessage:
            'can only have letters, numbers, dashes and underscores',
    },
    socials: { label: 'Socials', maxChar: 100 },
    mission: {
        label: 'Mission',
        required: true,
        minWords: 75,
        maxWords: 800,
    },
    goals: { label: 'Goals', required: true, minWords: 75, maxWords: 600 },
    purpose: { label: 'Purpose', required: true, minWords: 50, maxWords: 300 },
    appointment_procedures: {
        label: 'Appointment procedures',
        required: true,
        minWords: 50,
        maxWords: 200,
    },
    uniqueness: {
        label: 'Uniqueness',
        required: true,
        minWords: 50,
        maxWords: 800,
    },
    meeting_description: {
        label: 'Meeting description',
        required: true,
        minWords: 150,
        maxWords: 500,
    },
    meeting_schedule: {
        label: 'Meeting schedule',
        required: true,
        minWords: 50,
        maxWords: 600,
    },
    returning_info: {
        label: 'Returning information',
        minWords: 75,
        maxWords: 600,
    },
    faculty_email: { label: 'Faculty email', minChar: 10, maxChar: 64 },
};

const COMMITMENT_LEVELS = ['NONE', 'LOW', 'MEDIUM', 'HIGH'];
const MAX_TAGS = 3;
const MAX_KEYWORDS = 3;

const stripWhitespace = (value: string) =>
    value.replace(/[ \t]+$/gm, '').trim();

const countWords = (value: string) =>
    value.trim() ? value.trim().split(/\s+/).length : 0;

export const cleanCharter = <T extends { [field: string]: any }>(
    fields: T,
): T => {
    const cleaned: { [field: string]: any } = { ...fields };

    for (const [field, value] of Object.entries(cleaned)) {
        if (typeof value === 'string') {
            cleaned[field] = stripWhitespace(value);
        } else if (Array.isArray(value)) {
            cleaned[field] = value.map((item) =>
                typeof item === 'string' ? stripWhitespace(item) : item
            );
        }
    }

    if (typeof cleaned.url === 'string') {
        cleaned.url = cleaned.url.toLowerCase().replace(/\s+/g, '-');
    }

    if (typeof cleaned.keywords === 'string') {
        cleaned.keywords = cleaned.keywords
            .split(',')
            .map((keyword: string) => keyword.trim())
            .filter(Boolean)
            .join(',');
    }

    return cleaned as T;
};

export const validateCharter = (
    fields: { [field: string]: any },
    requireAll: boolean,
) => {
    const problems: string[] = [];

    for (const [field, rule] of Object.entries(RULES)) {
        const present = field in fields && fields[field] !== null &&
            fields[field] !== undefined;

        if (!present) {
            if (requireAll && rule.required) {
                problems.push(`${rule.label} is required.`);
            }
            continue;
        }

        const value = fields[field];
        if (typeof value !== 'string') {
            problems.push(`${rule.label} must be text.`);
            continue;
        }

        if (value.length === 0) {
            if (rule.required) problems.push(`${rule.label} is required.`);
            continue;
        }

        if (rule.minChar && value.length < rule.minChar) {
            problems.push(
                `${rule.label} must be at least ${rule.minChar} characters.`,
            );
        }
        if (rule.maxChar && value.length > rule.maxChar) {
            problems.push(
                `${rule.label} must be at most ${rule.maxChar} characters.`,
            );
        }

        const words = countWords(value);
        if (rule.minWords && words < rule.minWords) {
            problems.push(
                `${rule.label} must be at least ${rule.minWords} words (it has ${words}).`,
            );
        }
        if (rule.maxWords && words > rule.maxWords) {
            problems.push(
                `${rule.label} must be at most ${rule.maxWords} words (it has ${words}).`,
            );
        }

        if (rule.pattern && !rule.pattern.test(value)) {
            problems.push(`${rule.label} ${rule.patternMessage}.`);
        }
    }

    if (
        fields.commitment_level !== undefined &&
        fields.commitment_level !== null &&
        !COMMITMENT_LEVELS.includes(fields.commitment_level)
    ) {
        problems.push('Commitment level is not valid.');
    } else if (requireAll && !fields.commitment_level) {
        problems.push('Commitment level is required.');
    }

    if (fields.tags !== undefined && fields.tags !== null) {
        if (!Array.isArray(fields.tags) || fields.tags.length > MAX_TAGS) {
            problems.push(`Select at most ${MAX_TAGS} tags.`);
        }
    }

    if (typeof fields.keywords === 'string' && fields.keywords) {
        const keywords = fields.keywords.split(',').filter(Boolean);
        if (keywords.length > MAX_KEYWORDS) {
            problems.push(`Use at most ${MAX_KEYWORDS} keywords.`);
        }
    }

    if (fields.meeting_days !== undefined && fields.meeting_days !== null) {
        if (!Array.isArray(fields.meeting_days)) {
            problems.push('Meeting days must be a list.');
        } else if (requireAll && fields.meeting_days.length === 0) {
            problems.push('Select at least one meeting day.');
        }
    } else if (requireAll) {
        problems.push('Select at least one meeting day.');
    }

    return problems;
};
