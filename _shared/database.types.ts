export type Json =
	| string
	| number
	| boolean
	| Json[]
	| { [key: string]: Json | undefined }
	| undefined;

export type Database = {
	public: {
		Tables: {
			backgroundtokens: {
				Row: {
					id: number;
					service: string;
					tokens: string | undefined;
				};
				Insert: Partial<
					Database['public']['Tables']['backgroundtokens']['Row']
				>;
				Update: Partial<
					Database['public']['Tables']['backgroundtokens']['Row']
				>;
				Relationships: [];
			};
			googlecalendars: {
				Row: {
					id: number;
					org_url: string;
					calendar_id: string;
				};
				Insert: Partial<Database['public']['Tables']['googlecalendars']['Row']>;
				Update: Partial<Database['public']['Tables']['googlecalendars']['Row']>;
				Relationships: [
					{
						foreignKeyName: 'googlecalendars_org_url_fkey';
						columns: ['org_url'];
						isOneToOne: false;
						referencedRelation: 'organizations';
						referencedColumns: ['url'];
					},
				];
			};
			memberships: {
				Row: {
					id: number;
					organization_id: number;
					user_id: number;
					role: 'CREATOR' | 'ADMIN' | 'ADVISOR' | 'MEMBER';
					role_name: string | undefined;
					active: boolean;
				};
				Insert: Partial<Database['public']['Tables']['memberships']['Row']>;
				Update: Partial<Database['public']['Tables']['memberships']['Row']>;
				Relationships: [
					{
						foreignKeyName: 'memberships_organization_id_fkey';
						columns: ['organization_id'];
						isOneToOne: false;
						referencedRelation: 'organizations';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'memberships_user_id_fkey';
						columns: ['user_id'];
						isOneToOne: false;
						referencedRelation: 'users';
						referencedColumns: ['id'];
					},
				];
			};
			membershipnotifications: {
				Row: {
					id: number;
					membership_id: number;
					allow_notifications: boolean;
				};
				Insert: Partial<
					Database['public']['Tables']['membershipnotifications']['Row']
				>;
				Update: Partial<
					Database['public']['Tables']['membershipnotifications']['Row']
				>;
				Relationships: [
					{
						foreignKeyName: 'membershipnotifications_membership_id_fkey';
						columns: ['membership_id'];
						isOneToOne: false;
						referencedRelation: 'memberships';
						referencedColumns: ['id'];
					},
				];
			};
			meetings: {
				Row: {
					id: number;
					organization_id: number;
					room_id: number | undefined;
					is_public: boolean;
					title: string;
					description: string;
					advisor: string | undefined;
					start_time: string;
					end_time: string;
				};
				Insert: Partial<Database['public']['Tables']['meetings']['Row']>;
				Update: Partial<Database['public']['Tables']['meetings']['Row']>;
				Relationships: [
					{
						foreignKeyName: 'meetings_organization_id_fkey';
						columns: ['organization_id'];
						isOneToOne: false;
						referencedRelation: 'organizations';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'meetings_room_id_fkey';
						columns: ['room_id'];
						isOneToOne: false;
						referencedRelation: 'rooms';
						referencedColumns: ['id'];
					},
				];
			};
			organizationedits: {
				Row: {
					id: number;
					organization_id: number;
				};
				Insert: Partial<
					Database['public']['Tables']['organizationedits']['Row']
				>;
				Update: Partial<
					Database['public']['Tables']['organizationedits']['Row']
				>;
				Relationships: [
					{
						foreignKeyName: 'organizationedits_organization_id_fkey';
						columns: ['organization_id'];
						isOneToOne: false;
						referencedRelation: 'organizations';
						referencedColumns: ['id'];
					},
				];
			};
			organizations: {
				Row: {
					id: number;
					name: string;
					url: string;
					state: 'PENDING' | 'LOCKED' | 'UNLOCKED' | 'ADMIN';
					socials: string | undefined;
					mission: string | undefined;
					goals: string | undefined;
					benefit: string | undefined;
					keywords: string | undefined;
					tags: string[] | undefined;
					appointment_procedures: string | undefined;
					uniqueness: string | undefined;
					meeting_description: string | undefined;
					meeting_schedule: string | undefined;
					meeting_days: string[] | undefined;
					commitment_level: string | undefined;
					join_instructions: string | undefined;
					is_returning: boolean | undefined;
					returning_info: string | undefined;
					fair: boolean | undefined;
					faculty_email: string | undefined;
				};
				Insert: Partial<Database['public']['Tables']['organizations']['Row']>;
				Update: Partial<Database['public']['Tables']['organizations']['Row']>;
				Relationships: [];
			};
			permissions: {
				Row: {
					id: number;
					permission: 'ADMIN' | 'VALENTINES' | string;
					user_id: number;
				};
				Insert: Partial<Database['public']['Tables']['permissions']['Row']>;
				Update: Partial<Database['public']['Tables']['permissions']['Row']>;
				Relationships: [
					{
						foreignKeyName: 'permissions_user_id_fkey';
						columns: ['user_id'];
						isOneToOne: false;
						referencedRelation: 'users';
						referencedColumns: ['id'];
					},
				];
			};
			posts: {
				Row: {
					id: number;
					organization_id: number;
					title: string;
					description: string;
				};
				Insert: Partial<Database['public']['Tables']['posts']['Row']>;
				Update: Partial<Database['public']['Tables']['posts']['Row']>;
				Relationships: [
					{
						foreignKeyName: 'posts_organization_id_fkey';
						columns: ['organization_id'];
						isOneToOne: false;
						referencedRelation: 'organizations';
						referencedColumns: ['id'];
					},
				];
			};
			rooms: {
				Row: {
					id: number;
					name: string;
					floor: number | undefined;
					available_days: string[];
					ais_days: string[] | undefined;
					approval_required: boolean | undefined;
					comments: string | undefined;
				};
				Insert: Partial<Database['public']['Tables']['rooms']['Row']>;
				Update: Partial<Database['public']['Tables']['rooms']['Row']>;
				Relationships: [
					{
						foreignKeyName: 'meetings_room_id_fkey';
						columns: ['id'];
						isOneToOne: false;
						referencedRelation: 'meetings';
						referencedColumns: ['room_id'];
					},
				];
			};
			schedules: {
				Row: {
					id: number;
					name: string;
					schedule: Json;
				};
				Insert: Partial<Database['public']['Tables']['schedules']['Row']>;
				Update: Partial<Database['public']['Tables']['schedules']['Row']>;
				Relationships: [];
			};
			settings: {
				Row: {
					name: string;
					setting_value: Json;
				};
				Insert: Partial<Database['public']['Tables']['settings']['Row']>;
				Update: Partial<Database['public']['Tables']['settings']['Row']>;
				Relationships: [];
			};
			users: {
				Row: {
					id: number;
					first_name: string;
					last_name: string;
					email: string;
					grad_year: number | undefined;
					active: boolean | undefined;
					is_faculty: boolean;
					picture: string | undefined;
				};
				Insert: Partial<Database['public']['Tables']['users']['Row']>;
				Update: Partial<Database['public']['Tables']['users']['Row']>;
				Relationships: [];
			};
			valentinesmessages: {
				Row: {
					id: number;
					sender: number;
					receiver: number;
					message: string;
					verified_by: number | undefined;
					verified_at: string | undefined;
				};
				Insert: Partial<
					Database['public']['Tables']['valentinesmessages']['Row']
				>;
				Update: Partial<
					Database['public']['Tables']['valentinesmessages']['Row']
				>;
				Relationships: [
					{
						foreignKeyName: 'valentinesmessages_sender_fkey';
						columns: ['sender'];
						isOneToOne: false;
						referencedRelation: 'users';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'valentinesmessages_receiver_fkey';
						columns: ['receiver'];
						isOneToOne: false;
						referencedRelation: 'users';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'valentinesmessages_verified_by_fkey';
						columns: ['verified_by'];
						isOneToOne: false;
						referencedRelation: 'users';
						referencedColumns: ['id'];
					},
				];
			};
			orgmessages: {
				Row: {
					id: number;
					organization_id: number;
					user_id: number;
					content: string;
				};
				Insert: Partial<Database['public']['Tables']['orgmessages']['Row']>;
				Update: Partial<Database['public']['Tables']['orgmessages']['Row']>;
				Relationships: [
					{
						foreignKeyName: 'orgmessages_organization_id_fkey';
						columns: ['organization_id'];
						isOneToOne: false;
						referencedRelation: 'organizations';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'orgmessages_user_id_fkey';
						columns: ['user_id'];
						isOneToOne: false;
						referencedRelation: 'users';
						referencedColumns: ['id'];
					},
				];
			};
			strikes: {
				Row: {
					id: number;
					organization_id: number;
					admin_id: number;
					reason: string;
				};
				Insert: Partial<Database['public']['Tables']['strikes']['Row']>;
				Update: Partial<Database['public']['Tables']['strikes']['Row']>;
				Relationships: [
					{
						foreignKeyName: 'strikes_organization_id_fkey';
						columns: ['organization_id'];
						isOneToOne: false;
						referencedRelation: 'organizations';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'strikes_admin_id_fkey';
						columns: ['admin_id'];
						isOneToOne: false;
						referencedRelation: 'users';
						referencedColumns: ['id'];
					},
				];
			};
		};
		Views: Record<string, never>;
		Functions: {
			get_booked_rooms: {
				Args: {
					meeting_start: string;
					meeting_end: string;
				};
				Returns: Array<{
					room_id: number;
					meeting_id: number;
				}>;
			};
		};
		Enums: Record<string, never>;
		CompositeTypes: Record<string, never>;
	};
};
