export interface IMailsService {
  confirmRegisterUser(data: Record<string, unknown>): Promise<void>
  forgotPassword(data: Record<string, unknown>): Promise<void>
  resetPassword(data: Record<string, unknown>): Promise<void>
}
