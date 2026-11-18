import type { AuthProvider } from '@prisma/client';

export type OAuthProvider = Exclude<AuthProvider, 'EMAIL'>;

export type SocialType = {
  id: string;
  fullName?: string;
  email?: string;
  phoneNumber?: string;
  emailVerified?: boolean;
  phoneNumberVerified?: boolean;
  avatarUrl?: string;
};
