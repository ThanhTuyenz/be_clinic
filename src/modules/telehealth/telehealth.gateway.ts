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
    const token = this.getSocketToken(client);
    try {
      const payload = this.jwt.verify<{ id: string }>(token, {
        secret: this.config.getOrThrow<string>('auth.secret'),
      });
      client.data.userId = payload.id;
    } catch {
      client.disconnect(true);
      throw new UnauthorizedException('Phiên telehealth không hợp lệ.');
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

  /**
   * Tham gia vào phòng tư vấn của cuộc hẹn
   */
  @SubscribeMessage('join:telehealth-room')
  async handleJoinRoom(
    @MessageBody() dto: JoinTelehealthRoomDto,
    @ConnectedSocket() client: Socket,
  ) {
    const peer = await this.telehealthService.getSocketPeer(dto.appointmentId, client.data.userId, client.id);

    client.join(dto.appointmentId);

    const { room, otherPeer } = this.telehealthService.joinRoom(dto.appointmentId, peer);

    // Báo lại cho chính người vừa vào thông tin trạng thái phòng
    client.emit('telehealth:joined-success', {
      appointmentId: dto.appointmentId,
      status: room.status,
      myPeer: peer,
      otherPeer,
    });

    // Nếu đã có người kia ở sẵn trong phòng, thông báo cho người đó biết có người mới vào
    if (otherPeer?.socketId) {
      this.server.to(otherPeer.socketId).emit('telehealth:peer-joined', {
        newPeer: peer,
        status: room.status,
      });
    }

    return { success: true };
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
    if (!participant || participant.appointmentId !== payload.appointmentId) return;
    this.logger.log(
      `[Telehealth] Call ended for appointment ${payload.appointmentId} by ${payload.endedByRole}`,
    );

    // Báo cho toàn phòng biết cuộc gọi đã kết thúc
    this.server.to(payload.appointmentId).emit('telehealth:call-ended', {
      appointmentId: payload.appointmentId,
      endedByRole: participant.role,
      timestamp: new Date().toISOString(),
    });

    await this.telehealthService.endRoomSession(payload.appointmentId, {
      diagnosis: payload.diagnosis,
      prescriptionNotes: payload.prescriptionNotes,
      endedByUserId: participant.userId,
      endReason: 'SOCKET',
    }, participant.role);
  }
}
