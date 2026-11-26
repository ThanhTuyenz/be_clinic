import { BadRequestException, ForbiddenException, HttpException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { RedisService } from '../../infrastructure/redis/redis.service.js';
import { calculateEffectivePermissions } from '../auth/permissions/constants/permissions.constant.js';

type Location = { label: string; latitude: number; longitude: number };

@Injectable()
export class BranchGeocodingService {
  private readonly cache = new Map<string, { expires: number; results: Location[] }>();
  private nextRequestAt = 0;

  constructor(private readonly prisma: PrismaService, private readonly redis: RedisService) {}

  async search(userId: string, address: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true, customPermissions: true, isDeleted: true } });
    const permissions = user ? calculateEffectivePermissions(user.role, user.customPermissions) : [];
    if (!user || user.isDeleted || !['CHAIN_MANAGER', 'BRANCH_MANAGER'].includes(user.role)
      || !permissions.some(permission => ['branch:create', 'branch:update'].includes(permission))) {
      throw new ForbiddenException('Bạn không có quyền cập nhật vị trí chi nhánh.');
    }
    if (typeof address !== 'string') throw new BadRequestException('Vui lòng nhập địa chỉ chi nhánh.');
    const query = address.trim().replace(/\s+/g, ' ');
    if (query.length < 5 || query.length > 400 || /https?:\/\//i.test(query)) {
      throw new BadRequestException('Dán nội dung địa chỉ từ 5 đến 400 ký tự, không phải đường link Google Maps.');
    }
    const key = 'branch:geocoding:' + createHash('sha256').update(query.toLowerCase()).digest('hex');
    try {
      const cached = this.redis.isEnabled() ? await this.redis.get<Location[]>(key) : this.cache.get(key);
      if (Array.isArray(cached)) return { results: cached };
      if (cached && 'expires' in cached && cached.expires > Date.now()) return { results: cached.results };
      // One shared admission gate across backend replicas. No autocomplete or bulk requests.
      if (this.redis.isEnabled()) {
        const acquired = await this.redis.getClient()!.set('branch:geocoding:rate', '1', 'PX', 1100, 'NX');
        if (!acquired) throw new HttpException('Vui lòng chờ một chút rồi tìm lại địa chỉ.', 429);
      } else {
        if (Date.now() < this.nextRequestAt) throw new HttpException('Vui lòng chờ một chút rồi tìm lại địa chỉ.', 429);
        this.nextRequestAt = Date.now() + 1100;
      }
      const url = new URL(process.env.BRANCH_GEOCODING_URL || 'https://nominatim.openstreetmap.org/search');
      url.search = new URLSearchParams({ q: query, format: 'jsonv2', countrycodes: 'vn', limit: '3', 'accept-language': 'vi' }).toString();
      const response = await fetch(url, {
        headers: { 'User-Agent': 'VitaCareClinic-BranchAdmin/1.0', Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new ServiceUnavailableException('Dịch vụ tìm địa chỉ đang bận. Vui lòng thử lại sau.');
      const rows: unknown = await response.json();
      if (!Array.isArray(rows)) throw new ServiceUnavailableException('Dịch vụ tìm địa chỉ trả về dữ liệu không hợp lệ.');
      const results: Location[] = rows.flatMap(row => {
        const latitude = Number(row?.lat), longitude = Number(row?.lon);
        return typeof row?.display_name === 'string' && row.lat != null && row.lon != null
          && Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 85 && Math.abs(longitude) <= 180
          ? [{ label: row.display_name, latitude, longitude }] : [];
      });
      if (this.redis.isEnabled()) await this.redis.set(key, results, 86400);
      else {
        if (this.cache.size >= 200) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(key, { expires: Date.now() + 86400_000, results });
      }
      return { results };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('Chưa thể tìm địa chỉ. Vui lòng thử lại hoặc chọn trực tiếp trên bản đồ.');
    }
  }
}
