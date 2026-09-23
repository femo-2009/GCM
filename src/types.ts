export type UserRole = 'super_admin' | 'admin' | 'user';
export type UserStatus = 'pending' | 'approved' | 'blocked';

interface UserCounts {
  christians: number;
  friends: number;
}

interface PersonalPlan {
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
  photoPosition?: string; // CSS object-position for slider preview (e.g. "center", "50% 30%") - WhatsApp-style drag position
  photoScale?: number; // WhatsApp-style zoom 0.5..3 (تصغير + تكبير)
  email?: string; // gmail for group manager assignment (safest: validated email)
}

export interface Group {
  id: string;
  photo: string;
  title: string;
  description: string;
  governorate?: string; // one of 27 Egyptian governorates
  managerEmail?: string; // gmail of leader assigned to manage this group's map (only this leader can toggle)
}

export interface Church {
  id: string;
  name: string;
  governorate: string;
  lat: number;
  lng: number;
  address: string;
}

export interface GroupChurchStatus {
  groupId: string;
  churchId: string;
  status: 'working' | 'not_working';
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
