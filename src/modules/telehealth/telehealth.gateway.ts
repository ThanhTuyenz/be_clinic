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
import { HttpException, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { TelehealthService } from './telehealth.service.js';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import {
  JoinTelehealthRoomDto,
  WebRtcSignalDto,
  TelehealthChatMessageDto,
} from './dtos/telehealth.dto.js';

@WebSocketGateway({
  namespace: '/telehealth',
  cors: {
    origin: true,
    credentials: true,
  },
})
export class TelehealthGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(TelehealthGateway.name);

  constructor(
    private readonly telehealthService: TelehealthService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  afterInit() {
    this.logger.log('Telehealth WebRTC Signaling Gateway initialized on namespace /telehealth');
  }

  handleConnection(client: Socket) {
    try {
      const token = this.getSocketToken(client);
      const payload = this.jwt.verify<{ id: string }>(token, {
        secret: this.config.getOrThrow<string>('auth.secret'),
      });
      client.data.userId = payload.id;
    } catch {
      client.disconnect(true);
      return;
    }
    this.logger.debug(`Client connected to Telehealth namespace: ${client.id}`);
  }

  private getSocketToken(client: Socket): string {
    const authToken = client.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken) return authToken;
    const cookie = client.handshake.headers.cookie || '';
    const match = cookie.match(/(?:^|;\s*)token=([^;]+)/);
    if (match?.[1]) return decodeURIComponent(match[1]);
    throw new UnauthorizedException('Thiếu phiên đăng nhập telehealth.');
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Client disconnected from Telehealth: ${client.id}`);
    const { appointmentId, leftPeer, otherPeer } = this.telehealthService.leaveRoom(client.id);

    if (appointmentId && otherPeer?.socketId) {
      this.server.to(otherPeer.socketId).emit('telehealth:peer-left', {
        leftPeer,
        message: `${leftPeer?.name || 'Người tham gia'} đã rời khỏi phòng tư vấn.`,
      });
    }
  }

  notifyRoomEnded(appointmentId: string, endedByRole: string) {
    this.server.to(appointmentId).emit('telehealth:call-ended', {
      appointmentId,
      endedByRole,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Tham gia vào phòng tư vấn của cuộc hẹn
   */
  @SubscribeMessage('join:telehealth-room')
  async handleJoinRoom(
    @MessageBody() dto: JoinTelehealthRoomDto,
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const peer = await this.telehealthService.getSocketPeer(dto.appointmentId, client.data.userId, client.id);

      await client.join(dto.appointmentId);

      const { room, otherPeer } = this.telehealthService.joinRoom(dto.appointmentId, peer);

      client.emit('telehealth:joined-success', {
        appointmentId: dto.appointmentId,
        status: room.status,
        myPeer: peer,
        otherPeer,
      });

      if (otherPeer?.socketId) {
        this.server.to(otherPeer.socketId).emit('telehealth:peer-joined', {
          newPeer: peer,
          status: room.status,
        });
      }

      return { success: true };
    } catch (error) {
      return { success: false, message: error instanceof HttpException ? error.message : 'Không thể vào phòng tư vấn. Vui lòng thử lại.' };
    }
  }

  /**
   * Chuyển tiếp tín hiệu WebRTC (SDP Offer/Answer hoặc ICE Candidate)
   */
  @SubscribeMessage('webrtc:signal')
  handleWebRtcSignal(
    @MessageBody() dto: WebRtcSignalDto,
    @ConnectedSocket() client: Socket,
  ) {
    if (!dto.targetSocketId) {
      this.logger.warn(`Signal missing targetSocketId from ${client.id}`);
      return;
    }
    if (!this.telehealthService.isSocketInAppointment(client.id, dto.appointmentId)
      || !this.telehealthService.isSocketInAppointment(dto.targetSocketId, dto.appointmentId)) {
      this.logger.warn(`Rejected cross-room signal from ${client.id}`);
      return;
    }

    // Chuyển tiếp chính xác tới socket đích
    this.server.to(dto.targetSocketId).emit('webrtc:signal', {
      senderSocketId: client.id,
      signalData: dto.signalData,
    });
  }

  /**
   * Đồng bộ trạng thái Mic và Camera (Mute / Video off)
   */
  @SubscribeMessage('telehealth:toggle-media')
  handleToggleMedia(
    @MessageBody() payload: { appointmentId: string; isAudioMuted?: boolean; isVideoOff?: boolean },
    @ConnectedSocket() client: Socket,
  ) {
    const { appointmentId, role } = this.telehealthService.updateMediaState(
      client.id,
      payload.isAudioMuted,
      payload.isVideoOff,
    );

    if (appointmentId) {
      // Gửi cho tất cả những người khác trong phòng
      client.to(appointmentId).emit('telehealth:peer-media-toggled', {
        socketId: client.id,
        role,
        isAudioMuted: payload.isAudioMuted,
        isVideoOff: payload.isVideoOff,
      });
    }
  }

  /**
   * Tin nhắn Chat trong lúc tư vấn
   */
  @SubscribeMessage('telehealth:send-chat')
  handleSendChat(
    @MessageBody()
    dto: TelehealthChatMessageDto & { senderId?: string; senderName?: string; senderRole?: 'DOCTOR' | 'PATIENT' },
    @ConnectedSocket() client: Socket,
  ) {
    const participant = this.telehealthService.getPeerForSocket(client.id);
    if (!participant || participant.appointmentId !== dto.appointmentId) return;
    const message = {
      appointmentId: dto.appointmentId,
      senderId: participant.userId,
      senderName: participant.name,
      senderRole: participant.role,
      text: dto.text,
      fileUrl: dto.fileUrl,
      timestamp: new Date().toISOString(),
    };

    // Lưu tin nhắn vào phiên khám
    this.telehealthService.recordChatMessage(dto.appointmentId, message);

    // Broadcast tới toàn bộ người trong phòng (kể cả người gửi)
    this.server.to(dto.appointmentId).emit('telehealth:new-chat', message);
  }

  /**
   * Kết thúc cuộc gọi
   */
  @SubscribeMessage('telehealth:end-call')
  async handleEndCall(
    @MessageBody()
    payload: {
      appointmentId: string;
      endedByRole?: 'DOCTOR' | 'PATIENT';
      diagnosis?: string;
      prescriptionNotes?: string;
    },
    @ConnectedSocket() client: Socket,
  ) {
    const participant = this.telehealthService.getPeerForSocket(client.id);
    if (!participant || participant.appointmentId !== payload.appointmentId) {
      return { success: false, message: 'Bạn không ở trong phòng tư vấn này.' };
    }
    this.logger.log(
      `[Telehealth] Call ended for appointment ${payload.appointmentId} by ${payload.endedByRole}`,
    );

    try {
      await this.telehealthService.endRoomSession(payload.appointmentId, {
        diagnosis: payload.diagnosis,
        prescriptionNotes: payload.prescriptionNotes,
        endedByUserId: participant.userId,
        endReason: 'SOCKET',
      }, participant.role);
      this.notifyRoomEnded(payload.appointmentId, participant.role);
      return { success: true };
    } catch (error) {
      this.logger.error('Không thể lưu phiên tư vấn khi kết thúc cuộc gọi.', error instanceof Error ? error.stack : undefined);
      return { success: false, message: 'Không thể lưu phiên tư vấn. Vui lòng thử kết thúc lại.' };
    }
  }
}
