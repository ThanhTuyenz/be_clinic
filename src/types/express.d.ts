declare global {
  namespace Express {
    interface User {
      id: string
      sessionId?: string
      email?: string
      role?: string
      permissions?: string[]
    }
  }
}

export {}
