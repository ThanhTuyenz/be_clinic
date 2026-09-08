import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { REALTIME_EVENTS, REALTIME_ROOMS } from './realtime.constants.js';

export interface AppointmentBookedPayload {
  appointmentId: string;
  bookingCode?: string;
  queueNumber?: number | string;
  patientName?: string;
  patientPhone?: string;
  doctorName?: string;
  specialtyName?: string;
  branchId?: string;
  appointmentDate?: string;
  startTime?: string;
  endTime?: string;
  status: string;
}

export interface AppointmentStatusChangedPayload {
  appointmentId: string;
  status: string;
  previousStatus?: string;
  bookingCode?: string;
  branchId?: string;
}

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  afterInit() {
    this.logger.log('Global Realtime WebSocket Gateway initialized');
  }

  handleConnection(client: Socket) {
    this.logger.debug(`Client connected to Realtime socket: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Client disconnected from Realtime socket: ${client.id}`);
  }

  @SubscribeMessage('join:room')
  handleJoinRoom(@MessageBody() room: string, @ConnectedSocket() client: Socket) {
    if (room) {
      client.join(room);
      this.logger.debug(`Client ${client.id} joined room: ${room}`);
      return { status: 'joined', room };
    }
  }

  @SubscribeMessage('leave:room')
  handleLeaveRoom(@MessageBody() room: string, @ConnectedSocket() client: Socket) {
    if (room) {
      client.leave(room);
      this.logger.debug(`Client ${client.id} left room: ${room}`);
      return { status: 'left', room };
    }
  }

  /**
   * Phát sự kiện tới toàn bộ client đang kết nối
   */
  emitToAll(event: string, payload: any) {
    try {
      this.logger.log(`[Realtime] Emitting event "${event}" to all`);
      if (this.server) {
        this.server.emit(event, payload);
      }
    } catch (err) {
      this.logger.error(`[Realtime] Failed to emit event "${event}"`, err);
    }
  }

  /**
   * Phát sự kiện tới một room cụ thể (ví dụ: chi nhánh, bác sĩ, quầy tiếp đón)
   */
  emitToRoom(room: string, event: string, payload: any) {
    try {
      this.logger.log(`[Realtime] Emitting event "${event}" to room "${room}"`);
      if (this.server) {
        this.server.to(room).emit(event, payload);
      }
    } catch (err) {
      this.logger.error(`[Realtime] Failed to emit to room "${room}"`, err);
    }
  }

  /**
   * Nghiệp vụ: Phát sự kiện khi có lịch hẹn được đặt / xác nhận thành công
   */
  emitAppointmentBooked(payload: AppointmentBookedPayload) {
    try {
      this.logger.log(`[Realtime] Emitting ${REALTIME_EVENTS.APPOINTMENT_BOOKED} for #${payload.bookingCode || payload.appointmentId}`);
      if (this.server) {
        this.server.emit(REALTIME_EVENTS.APPOINTMENT_BOOKED, payload);
        if (payload.branchId) {
          this.server.to(REALTIME_ROOMS.BRANCH(payload.branchId)).emit(REALTIME_EVENTS.APPOINTMENT_BOOKED, payload);
        }
      }
    } catch (err) {
      this.logger.error('[Realtime] Failed to emit appointment:booked', err);
    }
  }

  /**
   * Nghiệp vụ: Phát sự kiện khi trạng thái lịch khám thay đổi
   */
  emitAppointmentStatusChanged(payload: AppointmentStatusChangedPayload) {
    try {
      this.logger.log(`[Realtime] Emitting ${REALTIME_EVENTS.APPOINTMENT_STATUS_CHANGED} for ${payload.appointmentId} -> ${payload.status}`);
      if (this.server) {
        this.server.emit(REALTIME_EVENTS.APPOINTMENT_STATUS_CHANGED, payload);
        if (payload.branchId) {
          this.server.to(REALTIME_ROOMS.BRANCH(payload.branchId)).emit(REALTIME_EVENTS.APPOINTMENT_STATUS_CHANGED, payload);
        }
      }
    } catch (err) {
      this.logger.error('[Realtime] Failed to emit appointment:status_changed', err);
    }
  }
}
