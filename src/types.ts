export type UserRole = 'super_admin' | 'admin' | 'user';
export type UserStatus = 'pending' | 'approved' | 'blocked';

export interface UserCounts {
  christians: number;
  friends: number;
}

export interface PersonalPlan {
  photo: string; // Base64 or URL
  text: string;
}

export interface Disciple {
  id: string;
  photo: string;
  name: string;
  description: string;
}

export interface UserGroup {
  id: string;
  photo: string;
  title: string;
  description: string;
  memberIds: string[]; // IDs of disciples
}

export interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  role: UserRole;
  status: UserStatus;
  permissions: string[]; // List of actions they can do if admin
  photo?: string;
  counts: UserCounts;
  personalPlan: PersonalPlan | null;
  disciples: Disciple[];
  groups: UserGroup[];
}

export interface Leader {
  id: string;
  photo: string;
  name: string;
  description: string;
  groupId: string; // group this leader belongs to
}

export interface Group {
  id: string;
  photo: string;
  title: string;
  description: string;
}

export type LibraryType = 'text' | 'photo' | 'video';

export interface LibraryItem {
  id: string;
  type: LibraryType;
  title: string;
  description: string;
  url?: string; // photo or video content/link
}

export interface HomeConfig {
  welcomeMessageAr: string;
  welcomeMessageEn: string;
  planPhoto: string;
  planTextAr: string;
  planTextEn: string;
}
