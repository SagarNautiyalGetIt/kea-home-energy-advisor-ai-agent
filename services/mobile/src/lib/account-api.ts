import { apiJson, apiPath, jsonRequest } from '@/lib/backend-client';

const registerPath = process.env.EXPO_PUBLIC_REGISTER_PATH?.trim() || '/api/auth/register';
const forgotPasswordPath = process.env.EXPO_PUBLIC_FORGOT_PASSWORD_PATH?.trim() || '/api/auth/password/forgot';
const changePasswordPath = process.env.EXPO_PUBLIC_CHANGE_PASSWORD_PATH?.trim() || '/api/auth/password/change';

export type AuthAccount = { customer_id: string; display_name: string; email?: string; access_token?: string; refresh_token?: string; token?: string };

export function registerAccount(name: string, email: string, password: string) {
  const fullName = name.trim();
  return apiJson<AuthAccount>(registerPath, jsonRequest('POST', { name: fullName, full_name: fullName, email: email.trim().toLowerCase(), password }));
}

export function requestPasswordReset(email: string) {
  return apiJson<void>(forgotPasswordPath, jsonRequest('POST', { email: email.trim().toLowerCase() }));
}

export function changeAccountPassword(customerId: string, currentPassword: string, newPassword: string) {
  return apiJson<void>(apiPath(changePasswordPath, { customer_id: customerId }), jsonRequest('POST', {
    customer_id: customerId,
    current_password: currentPassword,
    new_password: newPassword,
  }));
}
