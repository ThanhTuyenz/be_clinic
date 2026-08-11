export const RABBITMQ_TOPOLOGY = {
  holdExchange: 'appointments.hold',
  holdRoutingKey: 'created.dynamic-ttl',
  holdWaitQueue: 'appointments.hold.wait.dynamic-ttl',
  expiredExchange: 'appointments.hold.expired',
  expiredRoutingKey: 'expired',
  expiredQueue: 'appointments.hold.expired.worker',
  retryExchange: 'appointments.hold.retry',
  failedRoutingKey: 'failed',
  deadLetterQueue: 'appointments.hold.expired.dlq',
} as const;
