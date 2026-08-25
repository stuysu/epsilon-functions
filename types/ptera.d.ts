declare module 'ptera' {
	export type PteraDateTime = {
		toZonedTime(timeZone: string): PteraDateTime;
		toISO(): string;
		format(formatString: string): string;
	};

	export function datetime(input?: string | number | Date): PteraDateTime;
}
