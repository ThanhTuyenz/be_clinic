export const RABBITMQ_TOPOLOGY = {
  holdExchange: 'appointments.hold',
  holdRoutingKey: 'created',
  holdWaitQueue: 'appointments.hold.wait.10m',
  expiredExchange: 'appointments.hold.expired',
  expiredRoutingKey: 'expired',
  expiredQueue: 'appointments.hold.expired.worker',
  retryExchange: 'appointments.hold.retry',
  failedRoutingKey: 'failed',
  deadLetterQueue: 'appointments.hold.expired.dlq',
} as const;
