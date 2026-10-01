import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { extname, join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

export interface UploadResult {
  success: boolean;
  url: string;
  fullUrl: string;
  fileName: string;
  originalName: string;
  mimeType: string;
  size: number;
  storage: 'S3' | 'LOCAL' | 'LOCAL_FALLBACK';
}

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private s3Client: S3Client | null = null;
  private readonly bucketName: string;
  private readonly region: string;
  private readonly customCdnDomain?: string;
  private readonly isS3Enabled: boolean;

  constructor(private readonly configService: ConfigService) {
    this.bucketName = this.configService.get<string>('AWS_S3_BUCKET') || '';
    this.region = this.configService.get<string>('AWS_REGION') || 'ap-southeast-1';
    this.customCdnDomain = this.configService.get<string>('AWS_S3_CUSTOM_DOMAIN');
    
    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>('AWS_SECRET_ACCESS_KEY');
    const s3EnabledConfig = this.configService.get<string>('AWS_S3_ENABLED');

    // Chỉ bật S3 khi có đủ cấu hình Bucket và Access Key
    this.isS3Enabled =
      s3EnabledConfig !== 'false' && Boolean(this.bucketName && accessKeyId && secretAccessKey);

    if (this.isS3Enabled && accessKeyId && secretAccessKey) {
      try {
        const endpoint = this.configService.get<string>('AWS_S3_ENDPOINT');
        this.s3Client = new S3Client({
          region: this.region,
          credentials: {
            accessKeyId,
            secretAccessKey,
          },
          ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
        });
        this.logger.log(`[MediaService] AWS S3 Storage đã được cấu hình (Bucket: ${this.bucketName}, Region: ${this.region})`);
      } catch (err: any) {
        this.logger.error(`[MediaService] Lỗi khởi tạo S3Client: ${err.message}`);
        this.s3Client = null;
      }
    } else {
      this.logger.log('[MediaService] Chưa cấu hình AWS S3. Sử dụng bộ lưu trữ cục bộ (Local uploads)');
    }
  }

  /**
   * Sinh tên file ngẫu nhiên an toàn
   */
  private generateFileName(originalName: string): string {
    const randomSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = extname(originalName).toLowerCase();
    const cleanBase = originalName
      .replace(/\.[^/.]+$/, '')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 30);
    return `${cleanBase}-${randomSuffix}${ext}`;
  }

  /**
   * Lưu file cục bộ vào thư mục uploads
   */
  private saveToLocal(fileBuffer: Buffer, fileName: string, originalName: string, mimeType: string, size: number, req: any, isFallback = false): UploadResult {
    const mediaDir = this.configService.get<string>('MEDIA_LOCAL_DIR') || 'uploads';
    const uploadPath = join(process.cwd(), mediaDir);

    if (!existsSync(uploadPath)) {
      mkdirSync(uploadPath, { recursive: true });
    }

    const targetFilePath = join(uploadPath, fileName);
    writeFileSync(targetFilePath, fileBuffer);

    const relativeUrl = `/${mediaDir}/${fileName}`;
    const host = req.get('host') || 'localhost:8011';
    const protocol = req.protocol || 'http';
    const fullUrl = `${protocol}://${host}${relativeUrl}`;

    return {
      success: true,
      url: relativeUrl,
      fullUrl,
      fileName,
      originalName,
      mimeType,
      size,
      storage: isFallback ? 'LOCAL_FALLBACK' : 'LOCAL',
    };
  }

  /**
   * Upload file: Ưu tiên AWS S3 -> Fallback lưu vào thư mục uploads cục bộ
   */
  async saveFile(file: any, req: any): Promise<UploadResult> {
    const fileName = this.generateFileName(file.originalname);
    const fileBuffer: Buffer = file.buffer || (file.path ? require('node:fs').readFileSync(file.path) : null);

    if (!fileBuffer) {
      throw new Error('Dữ liệu file không hợp lệ hoặc buffer rỗng');
    }

    // 1. Nếu S3 được bật và sẵn sàng, thử tải lên S3
    if (this.isS3Enabled && this.s3Client && this.bucketName) {
      try {
        const s3Key = `uploads/${fileName}`;
        const command = new PutObjectCommand({
          Bucket: this.bucketName,
          Key: s3Key,
          Body: fileBuffer,
          ContentType: file.mimetype,
        });

        await this.s3Client.send(command);

        // Sinh URL S3 hoặc Custom CloudFront CDN URL
        const s3Url = this.customCdnDomain
          ? `${this.customCdnDomain.replace(/\/$/, '')}/${s3Key}`
          : `https://${this.bucketName}.s3.${this.region}.amazonaws.com/${s3Key}`;

        this.logger.log(`[MediaService] Tải lên S3 thành công: ${s3Url}`);

        return {
          success: true,
          url: s3Url,
          fullUrl: s3Url,
          fileName,
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          storage: 'S3',
        };
      } catch (error: any) {
        this.logger.warn(
          `[MediaService] Tải lên AWS S3 thất bại (${error.message}). Tự động fallback lưu cục bộ vào /uploads`,
        );
      }
    }

    // 2. Fallback hoặc chế độ mặc định: Lưu vào thư mục uploads cục bộ
    return this.saveToLocal(
      fileBuffer,
      fileName,
      file.originalname,
      file.mimetype,
      file.size,
      req,
      this.isS3Enabled,
    );
  }
}
