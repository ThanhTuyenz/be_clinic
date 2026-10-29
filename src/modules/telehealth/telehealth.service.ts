import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { TelehealthChatCache } from './telehealth-chat-cache.service.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { ChatMessagePayload, TelehealthPeer, TelehealthRoomState } from './types/telehealth.types.js';

@Injectable()
export class TelehealthService {
  private readonly logger = new Logger(TelehealthService.name);

  // Lưu trữ phòng đang hoạt động trong memory (được dọn dẹp khi kết thúc cuộc gọi)
  private readonly activeRooms = new Map<string, TelehealthRoomState>();

  // Map từ socketId -> { appointmentId, role } để xử lý disconnect nhanh
  private readonly socketMap = new Map<string, { appointmentId: string; role: 'DOCTOR' | 'PATIENT'; userId: string; name: string }>();

  constructor(private readonly prisma: PrismaService, private readonly chatCache: TelehealthChatCache) {}

  private async authorizeAppointment(appointmentId: string, userId: string, role?: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        id: true,
        status: true,
        bookingMethod: { select: { code: true } },
        patientProfile: { select: { accountId: true } },
        scheduleSlot: { select: { schedule: { select: { doctor: { select: { userId: true } } } } } },
      },
    });
    if (!appointment) throw new NotFoundException('Không tìm thấy lịch hẹn.');
    if (appointment.bookingMethod?.code !== 'ONLINE_CONSULTATION') {
      throw new ForbiddenException('Lịch hẹn này không phải tư vấn trực tuyến.');
    }
    const normalizedRole = String(role || '').toUpperCase();
    const allowed =
      normalizedRole === 'CHAIN_MANAGER' ||
      normalizedRole === 'BRANCH_MANAGER' ||
      (normalizedRole === 'PATIENT' && appointment.patientProfile.accountId === userId) ||
      (normalizedRole === 'DOCTOR' && appointment.scheduleSlot?.schedule.doctor.userId === userId);
    if (!allowed) throw new ForbiddenException('Bạn không có quyền truy cập phòng tư vấn này.');
    return appointment;
  }

  async getSocketPeer(appointmentId: string, userId: string, socketId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, fullName: true, avatarUrl: true, doctor: { select: { id: true } } },
    });
    if (!user) throw new ForbiddenException('Tài khoản không tồn tại.');
    const role: 'DOCTOR' | 'PATIENT' =
      user.role === 'DOCTOR' || Boolean(user.doctor) ? 'DOCTOR' : 'PATIENT';
    const appointment = await this.authorizeAppointment(appointmentId, userId, role);
    if (!['CONFIRMED', 'CHECKED_IN', 'IN_EXAMINATION'].includes(appointment.status)) {
      throw new ForbiddenException('Lịch hẹn chưa được xác nhận hoặc đã kết thúc.');
    }
    if (
      (role === 'DOCTOR' && appointment.scheduleSlot?.schedule.doctor.userId !== userId) ||
      (role === 'PATIENT' && appointment.patientProfile.accountId !== userId)
    ) {
      throw new ForbiddenException('Bạn không được phân công cho lịch hẹn này.');
    }

    return {
      socketId,
      userId: user.id,
      role,
      name: user.fullName || (role === 'DOCTOR' ? 'Bác sĩ' : 'Bệnh nhân'),
      avatarUrl: user.avatarUrl || undefined,
      joinedAt: new Date(),
    };
  }

  getPeerForSocket(socketId: string) {
    return this.socketMap.get(socketId);
  }

  isSocketInAppointment(socketId: string, appointmentId: string) {
    return this.socketMap.get(socketId)?.appointmentId === appointmentId;
  }

  /**
   * Lấy thông tin chi tiết cuộc hẹn để chuẩn bị vào phòng tư vấn
   */
  async getRoomDetails(appointmentId: string, userId: string, role?: string) {
    await this.authorizeAppointment(appointmentId, userId, role);
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        id: true,
        bookingCode: true,
        status: true,
        symptomsDescription: true,
        patientProfile: {
          select: {
            id: true,
            fullName: true,
            gender: true,
            dateOfBirth: true,
            phoneNumber: true,
          },
        },
        branch: {
          select: {
            id: true,
            name: true,
            phoneNumber: true,
            address: true,
          },
        },
        scheduleSlot: {
          select: {
            startTime: true,
            endTime: true,
            schedule: {
              select: {
                workDate: true,
                doctor: {
                  select: {
                    user: {
                      select: {
                        id: true,
                        fullName: true,
                        avatarUrl: true,
                      },
                    },
                    specialties: {
                      select: {
                        specialty: {
                          select: {
                            id: true,
                            name: true,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        servicePackage: { select: { name: true } },
      },
    });

    if (!appointment) {
      throw new NotFoundException('Không tìm thấy thông tin lịch hẹn hoặc phòng tư vấn không tồn tại.');
    }

    const doctorUser = appointment.scheduleSlot?.schedule?.doctor?.user;
    const doctorSpecialties = appointment.scheduleSlot?.schedule?.doctor?.specialties;
    const specialtyName = doctorSpecialties?.[0]?.specialty?.name || 'Bác sĩ chuyên khoa';

    return {
      appointmentId: appointment.id,
      bookingCode: appointment.bookingCode,
      status: appointment.status,
      appointmentDate: appointment.scheduleSlot?.schedule?.workDate,
      startTime: appointment.scheduleSlot?.startTime,
      endTime: appointment.scheduleSlot?.endTime,
      symptomsDescription: appointment.symptomsDescription,
      patient: {
        id: appointment.patientProfile.id,
        name: appointment.patientProfile.fullName,
        gender: appointment.patientProfile.gender,
        birthDate: appointment.patientProfile.dateOfBirth,
        phoneNumber: appointment.patientProfile.phoneNumber,
      },
      doctor: doctorUser
        ? {
            id: doctorUser.id,
            name: doctorUser.fullName || 'Bác sĩ phụ trách',
            avatarUrl: doctorUser.avatarUrl,
            specialtyName,
          }
        : null,
      branch: appointment.branch,
      serviceName: appointment.servicePackage?.name || 'Tư vấn trực tuyến',
      activeRoomState: this.activeRooms.get(appointmentId) || null,
    };
  }

  /**
   * Thêm một Peer (bác sĩ hoặc bệnh nhân) vào phòng
   */
  joinRoom(appointmentId: string, peer: TelehealthPeer): { room: TelehealthRoomState; otherPeer?: TelehealthPeer } {
    let room = this.activeRooms.get(appointmentId);

    if (!room) {
      room = {
        appointmentId,
        status: 'WAITING',
      };
      this.activeRooms.set(appointmentId, room);
    }

    if (peer.role === 'DOCTOR') {
      room.doctor = peer;
    } else {
      room.patient = peer;
    }

    this.socketMap.set(peer.socketId, { appointmentId, role: peer.role, userId: peer.userId, name: peer.name });

    // Khi cả 2 cùng có mặt, chuyển trạng thái phòng sang IN_CALL
    if (room.doctor && room.patient) {
      room.status = 'IN_CALL';
      if (!room.startedAt) {
        room.startedAt = new Date();
      }
    }

    const otherPeer = peer.role === 'DOCTOR' ? room.patient : room.doctor;

    this.logger.log(
      `[Telehealth] User ${peer.name} (${peer.role}) joined room ${appointmentId}. Room status: ${room.status}`,
    );

    return { room, otherPeer };
  }

  /**
   * Cập nhật trạng thái media (mute mic, tắt cam)
   */
  updateMediaState(socketId: string, isAudioMuted?: boolean, isVideoOff?: boolean): { appointmentId?: string; role?: string } {
    const info = this.socketMap.get(socketId);
    if (!info) return {};

    const room = this.activeRooms.get(info.appointmentId);
    if (room) {
      const peer = info.role === 'DOCTOR' ? room.doctor : room.patient;
      if (peer) {
        if (typeof isAudioMuted === 'boolean') peer.isAudioMuted = isAudioMuted;
        if (typeof isVideoOff === 'boolean') peer.isVideoOff = isVideoOff;
      }
    }

    return { appointmentId: info.appointmentId, role: info.role };
  }

  /**
   * Khi một socket ngắt kết nối
   */
  leaveRoom(socketId: string): { appointmentId?: string; leftPeer?: TelehealthPeer; otherPeer?: TelehealthPeer } {
    const info = this.socketMap.get(socketId);
    if (!info) return {};

    this.socketMap.delete(socketId);
    const room = this.activeRooms.get(info.appointmentId);
    if (!room) return {};

    let leftPeer: TelehealthPeer | undefined;
    let otherPeer: TelehealthPeer | undefined;

    if (info.role === 'DOCTOR') {
      leftPeer = room.doctor;
      room.doctor = undefined;
      otherPeer = room.patient;
    } else {
      leftPeer = room.patient;
      room.patient = undefined;
      otherPeer = room.doctor;
    }

    // Nếu không còn ai trong phòng thì dọn dẹp phòng
    if (!room.doctor && !room.patient) {
      this.activeRooms.delete(info.appointmentId);
      this.logger.log(`[Telehealth] Room ${info.appointmentId} is empty and cleaned up.`);
    } else {
      room.status = 'WAITING';
    }

    return { appointmentId: info.appointmentId, leftPeer, otherPeer };
  }

  async getChatMessages(appointmentId: string, userId: string, role: string): Promise<ChatMessagePayload[]> {
    await this.authorizeAppointment(appointmentId, userId, role);
    const cached = await this.chatCache.read(appointmentId);
    const session = await this.prisma.telehealthSession.findUnique({
      where: { appointmentId },
      select: { chatMessages: true },
    });
    const stored = Array.isArray(session?.chatMessages) ? session.chatMessages as unknown as ChatMessagePayload[] : [];
    return this.mergeChatMessages(stored, cached.messages);
  }

  private mergeChatMessages(...groups: ChatMessagePayload[][]): ChatMessagePayload[] {
    const unique = new Map<string, ChatMessagePayload>();
    for (const message of groups.flat()) {
      unique.set(message.id || JSON.stringify([message.senderId, message.timestamp, message.text]), message);
    }
    return [...unique.values()];
  }

  async recordChatMessage(appointmentId: string, message: Omit<ChatMessagePayload, 'id' | 'timestamp'>): Promise<ChatMessagePayload> {
    const text = typeof message.text === 'string' ? message.text.trim() : '';
    if (!text || text.length > 2000) throw new BadRequestException('Tin nhắn phải có từ 1 đến 2000 ký tự.');
    const appointment = await this.authorizeAppointment(appointmentId, message.senderId, message.senderRole);
    if (!['CONFIRMED', 'CHECKED_IN', 'IN_EXAMINATION'].includes(appointment.status)) {
      throw new ConflictException('Phiên tư vấn chưa bắt đầu hoặc đã kết thúc.');
    }
    const savedMessage = { ...message, id: randomUUID(), text, timestamp: new Date().toISOString() };
    await this.chatCache.append(appointmentId, savedMessage, this.activeRooms.get(appointmentId)?.startedAt || new Date());
    return savedMessage;
  }

  /**
   * Kết thúc buổi tư vấn và lưu trữ toàn bộ lịch sử cuộc gọi & tin nhắn vào DB
   */
  async endRoomSession(
    appointmentId: string,
    data?: { diagnosis?: string; prescriptionNotes?: string; endedByUserId?: string; endReason?: string },
    role?: string,
  ) {
    if (!data?.endedByUserId) throw new ForbiddenException('Thiếu người kết thúc phiên tư vấn.');
    const normalizedRole = String(role || '').toUpperCase();
    if (normalizedRole !== 'DOCTOR') {
      throw new ForbiddenException('Chỉ bác sĩ phụ trách mới được hoàn tất buổi tư vấn.');
    }
    await this.authorizeAppointment(appointmentId, data.endedByUserId, role);
    const room = this.activeRooms.get(appointmentId);
    const cached = await this.chatCache.freeze(appointmentId);
    const now = new Date();
    const startedAt = cached.startedAt ? new Date(cached.startedAt) : room?.startedAt || now;

    try {
      // 1. Lưu bản ghi phiên tư vấn vào bảng telehealth_sessions
      const session = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM appointments WHERE id = ${appointmentId}::uuid FOR UPDATE`;
        const current = await tx.appointment.findUnique({
          where: { id: appointmentId },
          select: { status: true },
        });
        if (!current) throw new NotFoundException('Không tìm thấy lịch hẹn.');
        const storedSession = await tx.telehealthSession.findUnique({
          where: { appointmentId },
          select: { startedAt: true, chatMessages: true, endedAt: true },
        });
        if (storedSession?.endedAt && current.status === 'COMPLETED') {
          return tx.telehealthSession.findUniqueOrThrow({ where: { appointmentId } });
        }
        const storedMessages = Array.isArray(storedSession?.chatMessages) ? storedSession.chatMessages as unknown as ChatMessagePayload[] : [];
        const chatMessages = this.mergeChatMessages(storedMessages, cached.messages) as unknown as Prisma.InputJsonValue;
        const sessionStartedAt = storedSession?.startedAt || startedAt;
        const sessionDurationSeconds = Math.max(0, Math.round((now.getTime() - sessionStartedAt.getTime()) / 1000));
        const session = await tx.telehealthSession.upsert({
          where: { appointmentId },
          create: {
            appointmentId,
            startedAt: sessionStartedAt,
            endedAt: now,
            durationSeconds: sessionDurationSeconds,
            diagnosis: data.diagnosis?.trim() || null,
            prescriptionNotes: data.prescriptionNotes?.trim() || null,
            chatMessages,
            endedByUserId: data.endedByUserId,
            endReason: data.endReason || 'CALL_ENDED',
          },
          update: {
            chatMessages,
            endedAt: now,
            durationSeconds: sessionDurationSeconds,
            diagnosis: data.diagnosis?.trim() || undefined,
            prescriptionNotes: data.prescriptionNotes?.trim() || undefined,
            endedByUserId: data.endedByUserId,
            endReason: data.endReason || 'CALL_ENDED',
          },
        });
        if (current.status !== 'COMPLETED') {
          await tx.appointment.update({
            where: { id: appointmentId },
            data: { status: 'COMPLETED' },
          });
          await tx.appointmentStatusHistory.create({
            data: {
              appointmentId,
              fromStatus: current.status,
              toStatus: 'COMPLETED',
              actorId: data.endedByUserId,
              reason: `Hoàn tất ca khám từ xa (${Math.round(sessionDurationSeconds / 60)} phút)`,
            },
          });
        }
        return session;
      });

      try {
        await this.chatCache.complete(appointmentId);
      } catch (error) {
        // DB is already committed; retain the frozen cache for a safe retry rather than reporting a failed consultation.
        this.logger.warn(`Chưa dọn được cache chat cho ${appointmentId}: ${error instanceof Error ? error.message : error}`);
      }

      if (room) {
        room.status = 'COMPLETED';
        room.endedAt = now;
        if (room.doctor?.socketId) this.socketMap.delete(room.doctor.socketId);
        if (room.patient?.socketId) this.socketMap.delete(room.patient.socketId);
        this.activeRooms.delete(appointmentId);
      }

      this.logger.log(
        `[Telehealth] Session saved to DB for appointment ${appointmentId}. Duration: ${session.durationSeconds}s, Messages: ${Array.isArray(session.chatMessages) ? session.chatMessages.length : 0}`,
      );

      return session;
    } catch (err) {
      this.logger.error(`[Telehealth] Failed to save session for ${appointmentId}:`, err);
      throw err;
    }
  }

  /**
   * Lấy lịch sử ca tư vấn đã hoàn thành (kết quả khám + đơn thuốc + tin nhắn chat)
   */
  async getSessionHistory(appointmentId: string, userId: string, role?: string) {
    await this.authorizeAppointment(appointmentId, userId, role);
    const session = await this.prisma.telehealthSession.findUnique({
      where: { appointmentId },
      include: {
        appointment: {
          include: {
            patientProfile: true,
            scheduleSlot: {
              include: {
                schedule: {
                  include: {
                    doctor: {
                      include: {
                        user: {
                          select: {
                            id: true,
                            fullName: true,
                            avatarUrl: true,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('Chưa có lịch sử phiên tư vấn cho cuộc hẹn này.');
    }

    const doctor = session.appointment?.scheduleSlot?.schedule?.doctor;

    return {
      id: session.id,
      appointmentId: session.appointmentId,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      durationSeconds: session.durationSeconds,
      diagnosis: session.diagnosis,
      prescriptionNotes: session.prescriptionNotes,
      chatMessages: session.chatMessages,
      doctor: doctor?.user
        ? {
            id: doctor.user.id,
            name: doctor.user.fullName,
            avatarUrl: doctor.user.avatarUrl,
          }
        : null,
      patient: session.appointment?.patientProfile
        ? {
            id: session.appointment.patientProfile.id,
            name: session.appointment.patientProfile.fullName,
          }
        : null,
    };
  }
}
