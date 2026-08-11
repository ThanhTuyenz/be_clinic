import { Injectable } from '@nestjs/common'

@Injectable()
export class HistoryService {
  create(_input: Record<string, unknown>) {
    return Promise.resolve(undefined)
  }
}