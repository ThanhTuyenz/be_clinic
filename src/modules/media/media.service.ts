import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(private readonly configService: ConfigService) {}

  formatUploadResult(file: any, req: any) {
    const filename = file.filename;
    const mediaDir = this.configService.get<string>('MEDIA_LOCAL_DIR') || 'uploads';
    const relativeUrl = `/${mediaDir}/${filename}`;
    
    // Tạo fullUrl nếu có host
    const host = req.get('host') || 'localhost:8011';
    const protocol = req.protocol || 'http';
    const fullUrl = `${protocol}://${host}${relativeUrl}`;

    return {
      success: true,
      url: relativeUrl,
      fullUrl,
      fileName: filename,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
    };
  }
}
